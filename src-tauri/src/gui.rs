use crate::models::{PsdMetadata, PsdLayerInfo};
use crate::utils::*;
use crate::cli::{cmd_sprite, SpriteLayout};
use rayon::prelude::*;

// ── 基本コマンド ──────────────────────────────────────────────────────────────

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
            .map_err(|e| format!("Failed to open OS settings: {}", e))?;
        Ok(())
    }
    #[cfg(not(target_os = "windows"))]
    {
        Err("Default app settings are only supported on Windows in this version.".to_string())
    }
}

// ── バッチ変換（Rayon並列化） ─────────────────────────────────────────────────

#[derive(serde::Serialize, serde::Deserialize, Clone)]
pub struct BatchResult {
    pub ok: usize,
    pub err: usize,
    pub total: usize,
    pub errors: Vec<String>,
}

#[tauri::command]
pub fn run_batch(pattern: String, output_dir: String, format: String) -> Result<BatchResult, String> {
    // 入力バリデーション
    if pattern.is_empty() {
        return Err("Glob pattern must not be empty".to_string());
    }
    let allowed = ["png", "jpeg", "jpg", "webp"];
    if !allowed.contains(&format.as_str()) {
        return Err(format!(
            "Unsupported format '{}'. Allowed: png, jpeg, webp", format
        ));
    }

    let paths: Vec<_> = glob::glob(&pattern)
        .map_err(|e| format!("Invalid glob pattern '{}': {}", pattern, e))?
        .filter_map(|e| match e {
            Ok(p) => Some(p),
            Err(e) => { eprintln!("Glob entry error: {}", e); None }
        })
        .filter(|p| p.extension().map(|ext| ext.eq_ignore_ascii_case("psd")).unwrap_or(false))
        .collect();

    if paths.is_empty() {
        return Ok(BatchResult { ok: 0, err: 0, total: 0, errors: vec![] });
    }

    std::fs::create_dir_all(&output_dir)
        .map_err(|e| format!("Failed to create output dir '{}': {}", output_dir, e))?;

    // Rayon 並列処理
    let results: Vec<Result<(), String>> = paths.par_iter().map(|path| {
        let stem = path.file_stem()
            .map(|s| s.to_string_lossy().into_owned())
            .unwrap_or_else(|| "unnamed".to_string());
        let out_path = std::path::Path::new(&output_dir)
            .join(format!("{}.{}", stem, image_ext(&format)));
        let out_str = out_path.to_string_lossy().into_owned();

        let psd   = load_psd(path.to_string_lossy().as_ref())?;
        let img   = psd_to_rgba_image(&psd)?;
        let bytes = encode_image_rgba(&img, &format)?;
        save_bytes(&out_str, &bytes)?;
        Ok(())
    }).collect();

    let mut ok = 0usize;
    let mut errors = Vec::new();
    for (path, result) in paths.iter().zip(results.into_iter()) {
        match result {
            Ok(_)  => ok += 1,
            Err(e) => {
                let stem = path.file_stem()
                    .map(|s| s.to_string_lossy().into_owned())
                    .unwrap_or_else(|| path.display().to_string());
                errors.push(format!("{}: {}", stem, e));
            }
        }
    }
    let total = ok + errors.len();
    Ok(BatchResult { ok, err: errors.len(), total, errors })
}

// ── レイヤー個別エクスポート（Rayon並列化） ───────────────────────────────────

#[derive(serde::Serialize, serde::Deserialize, Clone)]
pub struct ExportLayersResult {
    pub count: usize,
    pub skipped: usize,
    pub errors: Vec<String>,
}

#[tauri::command]
pub fn run_export_layers(
    input: String,
    output_dir: String,
    format: String,
    visible_only: bool,
) -> Result<ExportLayersResult, String> {
    // 入力バリデーション
    let allowed = ["png", "jpeg", "jpg", "webp"];
    if !allowed.contains(&format.as_str()) {
        return Err(format!("Unsupported format '{}'. Allowed: png, jpeg, webp", format));
    }

    let psd = load_psd(&input)?;

    std::fs::create_dir_all(&output_dir)
        .map_err(|e| format!("Failed to create output dir: {}", e))?;

    let ext = image_ext(&format);

    // レイヤーデータを収集（psd::PsdLayer は Send でないため parallel 前に収集）
    struct LayerEntry {
        name: String,
        pixel_data: Vec<u8>,
        w: u32,
        h: u32,
    }

    let mut entries: Vec<LayerEntry> = Vec::new();
    let mut skipped = 0usize;

    for layer in psd.layers() {
        if visible_only && !layer.visible() { skipped += 1; continue; }
        let (w, h) = (layer.width() as u32, layer.height() as u32);
        if w == 0 || h == 0 { skipped += 1; continue; }
        entries.push(LayerEntry {
            name: sanitize_name(layer.name()),
            pixel_data: layer.rgba(),
            w, h,
        });
    }

    // ── 出力ファイル名の重複回避（シリアル） ─────────────────────────────────
    // 並列で名前衝突チェックすると race condition になるため先にパスを確定させる
    let mut named_entries: Vec<(LayerEntry, String)> = Vec::with_capacity(entries.len());
    for entry in entries {
        let mut out_path = std::path::Path::new(&output_dir)
            .join(format!("{}.{}", entry.name, ext));
        let mut idx = 1u32;
        while out_path.exists() {
            out_path = std::path::Path::new(&output_dir)
                .join(format!("{}_{}.{}", entry.name, idx, ext));
            idx += 1;
        }
        let out_str = out_path.to_string_lossy().into_owned();
        named_entries.push((entry, out_str));
    }

    // ── Rayon でエンコード＋書き込みを並列実行 ───────────────────────────────
    let results: Vec<Result<(), String>> = named_entries.par_iter().map(|(entry, out_str)| {
        let img = image::RgbaImage::from_raw(entry.w, entry.h, entry.pixel_data.clone())
            .ok_or_else(|| format!(
                "Failed to create image for layer '{}' ({}×{})",
                entry.name, entry.w, entry.h
            ))?;
        let bytes = encode_image_rgba(&img, &format)?;
        save_bytes(out_str, &bytes)
    }).collect();

    let mut count = 0usize;
    let mut errors: Vec<String> = Vec::new();
    for ((entry, _), result) in named_entries.iter().zip(results.into_iter()) {
        match result {
            Ok(_)  => count += 1,
            Err(e) => errors.push(format!("{}: {}", entry.name, e)),
        }
    }

    Ok(ExportLayersResult { count, skipped, errors })
}

// ── PSD 比較 ──────────────────────────────────────────────────────────────────

#[derive(serde::Serialize, serde::Deserialize, Clone)]
pub struct CompareResult {
    pub changed_px: u64,
    pub total_px: u64,
    pub changed_pct: f64,
    pub width: u32,
    pub height: u32,
}

#[tauri::command]
pub fn run_compare(
    input_a: String,
    input_b: String,
    output: String,
    threshold: u8,
    highlight: String,
) -> Result<CompareResult, String> {
    // 入力バリデーション
    if input_a == input_b {
        return Err("input_a and input_b must be different files".to_string());
    }
    let allowed_hl = ["red", "magenta", "heat"];
    if !allowed_hl.contains(&highlight.as_str()) {
        return Err(format!(
            "Unsupported highlight mode '{}'. Allowed: red, magenta, heat", highlight
        ));
    }

    // 2ファイルを並列読み込み
    let (res_a, res_b) = rayon::join(
        || load_psd(&input_a).and_then(|p| psd_to_rgba_image(&p)),
        || load_psd(&input_b).and_then(|p| psd_to_rgba_image(&p)),
    );
    let img_a = res_a?;
    let img_b = res_b?;

    let (wa, ha) = img_a.dimensions();
    let (wb, hb) = img_b.dimensions();
    let (w, h) = (wa.max(wb), ha.max(hb));

    if w == 0 || h == 0 {
        return Err("One or both PSD files have zero dimensions".to_string());
    }

    // ピクセル比較は逐次処理して中間Vecのメモリ増加を避ける
    let mut diff = image::RgbaImage::new(w, h);
    let mut changed = 0u64;
    for y in 0..h {
        for x in 0..w {
            let pa = if x < wa && y < ha { *img_a.get_pixel(x, y) } else { image::Rgba([0,0,0,0]) };
            let pb = if x < wb && y < hb { *img_b.get_pixel(x, y) } else { image::Rgba([0,0,0,0]) };
            let delta = (0..4)
                .map(|i| (pa[i] as i32 - pb[i] as i32).unsigned_abs() as u8)
                .max()
                .unwrap_or(0);
            let is_changed = delta > threshold;
            let pixel = if is_changed {
                match highlight.as_str() {
                    "magenta" => image::Rgba([255, 0, 255, 255]),
                    "heat" => {
                        let t = (delta as f32 / 255.0).clamp(0.0, 1.0);
                        image::Rgba([(255.0 * t) as u8, (255.0 * (1.0 - t * 0.8)) as u8, 0, 255])
                    }
                    _ => image::Rgba([255, 0, 0, 255]),
                }
            } else {
                let r = ((pa[0] as u16 + pb[0] as u16) / 2) as u8 / 2;
                let g = ((pa[1] as u16 + pb[1] as u16) / 2) as u8 / 2;
                let b = ((pa[2] as u16 + pb[2] as u16) / 2) as u8 / 2;
                image::Rgba([r, g, b, 200])
            };
            diff.put_pixel(x, y, pixel);
            if is_changed { changed += 1; }
        }
    }

    let pct = changed as f64 / (w * h) as f64 * 100.0;
    save_bytes(&output, &encode_image_rgba(&diff, "png")?)?;

    Ok(CompareResult {
        changed_px: changed,
        total_px: (w * h) as u64,
        changed_pct: pct,
        width: w,
        height: h,
    })
}

// ── スプライトシート ──────────────────────────────────────────────────────────

#[derive(serde::Serialize, serde::Deserialize, Clone)]
pub struct SpriteResult {
    pub width: u32,
    pub height: u32,
    pub frame_count: usize,
}

#[tauri::command]
pub fn run_sprite(
    pattern: String,
    output: String,
    layout: String,
    cols: u32,
    padding: u32,
    format: String,
    json_out: Option<String>,
) -> Result<SpriteResult, String> {
    // 入力バリデーション
    if pattern.is_empty() {
        return Err("Glob pattern must not be empty".to_string());
    }
    let allowed = ["png", "jpeg", "jpg", "webp"];
    if !allowed.contains(&format.as_str()) {
        return Err(format!("Unsupported format '{}'. Allowed: png, jpeg, webp", format));
    }

    let sprite_layout = match layout.as_str() {
        "vertical" => SpriteLayout::Vertical,
        "grid"     => SpriteLayout::Grid,
        _          => SpriteLayout::Horizontal,
    };
    cmd_sprite(&pattern, &output, sprite_layout, cols, padding, &format, json_out.as_deref())?;

    // サイズを出力画像から取得
    let meta = image::image_dimensions(&output)
        .map_err(|e| format!("Failed to read output image dimensions: {}", e))?;
    let n = glob::glob(&pattern)
        .map(|g| g.filter_map(|e| e.ok()).count())
        .unwrap_or(0);

    Ok(SpriteResult { width: meta.0, height: meta.1, frame_count: n })
}
