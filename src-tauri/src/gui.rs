use crate::models::{PsdMetadata, PsdLayerInfo};
use crate::utils::*;
use crate::cli::{cmd_sprite, SpriteLayout};

#[tauri::command]
pub fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[tauri::command]
pub fn get_launch_args() -> Vec<String> {
    std::env::args().collect()
}

#[tauri::command]
pub fn parse_psd_metadata(file_path: String) -> Result<PsdMetadata, String> {
    let psd = load_psd(&file_path)?;
    let width = psd.width();
    let height = psd.height();
    let mut layers = Vec::new();
    
    for layer in psd.layers() {
        let layer_info = PsdLayerInfo {
            name: layer.name().to_string(),
            visible: layer.visible(),
            opacity: layer.opacity(),
            left: layer.layer_left() as i32,
            top: layer.layer_top() as i32,
            width: layer.width() as u32,
            height: layer.height() as u32,
            children: None,
        };
        layers.push(layer_info);
    }
    
    Ok(PsdMetadata { width, height, layers })
}

#[tauri::command]
pub fn open_default_app_settings() -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        use std::process::Command;
        Command::new("cmd")
            .args(["/C", "start", "ms-settings:defaultapps"])
            .spawn()
            .map_err(|e| e.to_string())?;
        Ok(())
    }
    #[cfg(not(target_os = "windows"))]
    {
        Err("Default app settings are only supported on Windows in this version.".to_string())
    }
}

#[derive(serde::Serialize, serde::Deserialize, Clone)]
pub struct BatchResult {
    pub ok: usize,
    pub err: usize,
    pub total: usize,
    pub errors: Vec<String>,
}

#[tauri::command]
pub fn run_batch(pattern: String, output_dir: String, format: String) -> Result<BatchResult, String> {
    let paths: Vec<_> = glob::glob(&pattern)
        .map_err(|e| format!("Invalid glob pattern '{}': {}", pattern, e))?
        .filter_map(|e| e.ok())
        .filter(|p| p.extension().map(|ext| ext.eq_ignore_ascii_case("psd")).unwrap_or(false))
        .collect();

    if paths.is_empty() {
        return Ok(BatchResult { ok: 0, err: 0, total: 0, errors: vec![] });
    }
    std::fs::create_dir_all(&output_dir)
        .map_err(|e| format!("Failed to create output dir '{}': {}", output_dir, e))?;

    let (mut ok, mut err) = (0usize, 0usize);
    let mut errors = Vec::new();
    for path in &paths {
        let stem = path.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
        let out_path = std::path::Path::new(&output_dir).join(format!("{}.{}", stem, image_ext(&format)));
        let out_str = out_path.to_string_lossy().into_owned();
        match (|| -> Result<(), String> {
            let psd   = load_psd(path.to_string_lossy().as_ref())?;
            let img   = psd_to_rgba_image(&psd)?;
            let bytes = encode_image_rgba(&img, &format)?;
            save_bytes(&out_str, &bytes)
        })() {
            Ok(_)  => { ok += 1; }
            Err(e) => { err += 1; errors.push(format!("{}: {}", stem, e)); }
        }
    }
    Ok(BatchResult { ok, err, total: paths.len(), errors })
}

#[derive(serde::Serialize, serde::Deserialize, Clone)]
pub struct ExportLayersResult {
    pub count: usize,
    pub skipped: usize,
    pub errors: Vec<String>,
}

#[tauri::command]
pub fn run_export_layers(input: String, output_dir: String, format: String, visible_only: bool) -> Result<ExportLayersResult, String> {
    let psd = load_psd(&input)?;
    std::fs::create_dir_all(&output_dir)
        .map_err(|e| format!("Failed to create output dir: {}", e))?;

    let ext = image_ext(&format);
    let (mut count, mut skipped) = (0usize, 0usize);
    let mut errors = Vec::new();

    for layer in psd.layers() {
        if visible_only && !layer.visible() { skipped += 1; continue; }
        let name = sanitize_name(layer.name());
        let pixel_data: Vec<u8> = layer.rgba();
        let (w, h) = (layer.width() as u32, layer.height() as u32);
        if w == 0 || h == 0 { skipped += 1; continue; }
        let img = match image::RgbaImage::from_raw(w, h, pixel_data) {
            Some(i) => i,
            None    => { skipped += 1; continue; }
        };
        let mut out_path = std::path::Path::new(&output_dir).join(format!("{}.{}", name, ext));
        let mut idx = 1u32;
        while out_path.exists() {
            out_path = std::path::Path::new(&output_dir).join(format!("{}_{}.{}", name, idx, ext));
            idx += 1;
        }
        match encode_image_rgba(&img, &format).and_then(|b| save_bytes(&out_path.to_string_lossy(), &b)) {
            Ok(_)  => count += 1,
            Err(e) => { errors.push(format!("{}: {}", name, e)); }
        }
    }
    Ok(ExportLayersResult { count, skipped, errors })
}

#[derive(serde::Serialize, serde::Deserialize, Clone)]
pub struct CompareResult {
    pub changed_px: u64,
    pub total_px: u64,
    pub changed_pct: f64,
    pub width: u32,
    pub height: u32,
}

#[tauri::command]
pub fn run_compare(input_a: String, input_b: String, output: String, threshold: u8, highlight: String) -> Result<CompareResult, String> {
    let img_a = psd_to_rgba_image(&load_psd(&input_a)?)?;
    let img_b = psd_to_rgba_image(&load_psd(&input_b)?)?;
    let (wa, ha) = img_a.dimensions();
    let (wb, hb) = img_b.dimensions();
    let (w, h) = (wa.max(wb), ha.max(hb));

    let mut diff = image::RgbaImage::new(w, h);
    let mut changed = 0u64;

    for y in 0..h {
        for x in 0..w {
            let pa = if x < wa && y < ha { *img_a.get_pixel(x, y) } else { image::Rgba([0,0,0,0]) };
            let pb = if x < wb && y < hb { *img_b.get_pixel(x, y) } else { image::Rgba([0,0,0,0]) };
            let delta = (0..4).map(|i| (pa[i] as i32 - pb[i] as i32).unsigned_abs() as u8).max().unwrap_or(0);
            if delta > threshold {
                changed += 1;
                let pixel = match highlight.as_str() {
                    "magenta" => image::Rgba([255, 0, 255, 255]),
                    "heat" => {
                        let t = (delta as f32 / 255.0).clamp(0.0, 1.0);
                        image::Rgba([(255.0 * t) as u8, (255.0 * (1.0 - t * 0.8)) as u8, 0, 255])
                    }
                    _ => image::Rgba([255, 0, 0, 255]),
                };
                diff.put_pixel(x, y, pixel);
            } else {
                let r = ((pa[0] as u16 + pb[0] as u16) / 2) as u8 / 2;
                let g = ((pa[1] as u16 + pb[1] as u16) / 2) as u8 / 2;
                let b = ((pa[2] as u16 + pb[2] as u16) / 2) as u8 / 2;
                diff.put_pixel(x, y, image::Rgba([r, g, b, 200]));
            }
        }
    }
    let pct = changed as f64 / (w * h) as f64 * 100.0;
    save_bytes(&output, &encode_image_rgba(&diff, "png")?)?;
    Ok(CompareResult { changed_px: changed, total_px: (w * h) as u64, changed_pct: pct, width: w, height: h })
}

#[derive(serde::Serialize, serde::Deserialize, Clone)]
pub struct SpriteResult {
    pub width: u32,
    pub height: u32,
    pub frame_count: usize,
}

#[tauri::command]
pub fn run_sprite(pattern: String, output: String, layout: String, cols: u32, padding: u32, format: String, json_out: Option<String>) -> Result<SpriteResult, String> {
    let sprite_layout = match layout.as_str() {
        "vertical" => SpriteLayout::Vertical,
        "grid"     => SpriteLayout::Grid,
        _          => SpriteLayout::Horizontal,
    };
    cmd_sprite(&pattern, &output, sprite_layout, cols, padding, &format, json_out.as_deref())?;

    // サイズを返すためにPSDを再読みする代わりに出力画像から取得
    let meta = image::image_dimensions(&output)
        .unwrap_or((0, 0));
    let n = glob::glob(&pattern)
        .map(|g| g.filter_map(|e| e.ok()).count())
        .unwrap_or(0);
    Ok(SpriteResult { width: meta.0, height: meta.1, frame_count: n })
}
