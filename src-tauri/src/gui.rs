use crate::models::{PsdMetadata, PsdLayerInfo};
use crate::utils::*;
use crate::cli::{cmd_sprite, SpriteLayout};
use rayon::prelude::*;
use tauri::{AppHandle, Emitter};

// ── 進捗イベント ──────────────────────────────────────────────────────────────

#[derive(serde::Serialize, Clone)]
struct ProgressEvent {
    /// "info" | "success" | "error" | "warn"
    level: &'static str,
    message: String,
}

fn emit_log(app: &AppHandle, level: &'static str, message: impl Into<String>) {
    let _ = app.emit("tool-progress", ProgressEvent { level, message: message.into() });
}

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

// ── バッチ変換（Rayon並列化 + 進捗ログ） ─────────────────────────────────────

#[derive(serde::Serialize, serde::Deserialize, Clone)]
pub struct BatchResult {
    pub ok: usize,
    pub err: usize,
    pub total: usize,
    pub errors: Vec<String>,
}

#[tauri::command]
pub fn run_batch(
    app: AppHandle,
    pattern: String,
    output_dir: String,
    format: String,
) -> Result<BatchResult, String> {
    if pattern.is_empty() {
        return Err("Glob pattern must not be empty".to_string());
    }
    let allowed = ["png", "jpeg", "jpg", "webp"];
    if !allowed.contains(&format.as_str()) {
        return Err(format!(
            "Unsupported format '{}'. Allowed: png, jpeg, webp", format
        ));
    }

    emit_log(&app, "info", format!("Scanning: {}", pattern));

    let paths: Vec<_> = glob::glob(&pattern)
        .map_err(|e| format!("Invalid glob pattern '{}': {}", pattern, e))?
        .filter_map(|e| match e {
            Ok(p) => Some(p),
            Err(e) => { eprintln!("Glob entry error: {}", e); None }
        })
        .filter(|p| p.extension().map(|ext| ext.eq_ignore_ascii_case("psd")).unwrap_or(false))
        .collect();

    if paths.is_empty() {
        emit_log(&app, "warn", "No PSD files matched the pattern.");
        return Ok(BatchResult { ok: 0, err: 0, total: 0, errors: vec![] });
    }

    emit_log(&app, "info", format!("Found {} PSD file(s). Starting conversion…", paths.len()));

    std::fs::create_dir_all(&output_dir)
        .map_err(|e| format!("Failed to create output dir '{}': {}", output_dir, e))?;

    // Rayon 並列処理
    let results: Vec<(String, Result<(), String>)> = paths.par_iter().map(|path| {
        let stem = path.file_stem()
            .map(|s| s.to_string_lossy().into_owned())
            .unwrap_or_else(|| "unnamed".to_string());
        let out_path = std::path::Path::new(&output_dir)
            .join(format!("{}.{}", stem, image_ext(&format)));
        let out_str = out_path.to_string_lossy().into_owned();

        let result = (|| {
            let psd   = load_psd(path.to_string_lossy().as_ref())?;
            let img   = psd_to_rgba_image(&psd)?;
            let bytes = encode_image_rgba(&img, &format)?;
            save_bytes(&out_str, &bytes)?;
            Ok(())
        })();
        (stem, result)
    }).collect();

    let mut ok = 0usize;
    let mut errors = Vec::new();

    for (stem, result) in results {
        match result {
            Ok(_) => {
                ok += 1;
                emit_log(&app, "success", format!("✓ {}.{}", stem, image_ext(&format)));
            }
            Err(e) => {
                let msg = format!("{}: {}", stem, e);
                errors.push(msg.clone());
                emit_log(&app, "error", format!("✗ {}", msg));
            }
        }
    }

    let total = ok + errors.len();
    emit_log(&app, "info", format!(
        "Done — {} converted, {} failed (total: {})", ok, errors.len(), total
    ));

    Ok(BatchResult { ok, err: errors.len(), total, errors })
}

// ── レイヤー個別エクスポート（Rayon並列化 + 進捗ログ） ───────────────────────

#[derive(serde::Serialize, serde::Deserialize, Clone)]
pub struct ExportLayersResult {
    pub count: usize,
    pub skipped: usize,
    pub errors: Vec<String>,
}

#[tauri::command]
pub fn run_export_layers(
    app: AppHandle,
    input: String,
    output_dir: String,
    format: String,
    visible_only: bool,
) -> Result<ExportLayersResult, String> {
    let allowed = ["png", "jpeg", "jpg", "webp"];
    if !allowed.contains(&format.as_str()) {
        return Err(format!("Unsupported format '{}'. Allowed: png, jpeg, webp", format));
    }

    emit_log(&app, "info", format!("Loading: {}", input));
    let psd = load_psd(&input)?;

    std::fs::create_dir_all(&output_dir)
        .map_err(|e| format!("Failed to create output dir: {}", e))?;

    let ext = image_ext(&format);

    struct LayerEntry {
        name: String,
        pixel_data: Vec<u8>,
        w: u32,
        h: u32,
    }

    let mut entries: Vec<LayerEntry> = Vec::new();
    let mut skipped = 0usize;

    for layer in psd.layers() {
        if visible_only && !layer.visible() {
            emit_log(&app, "warn", format!("  skip (hidden): {}", layer.name()));
            skipped += 1;
            continue;
        }
        let (w, h) = (layer.width() as u32, layer.height() as u32);
        if w == 0 || h == 0 {
            emit_log(&app, "warn", format!("  skip (zero-size): {}", layer.name()));
            skipped += 1;
            continue;
        }
        // psd crate 0.3.5 の PsdLayer::rgba() を取得
        let mut pixels = layer.rgba();

        // 【重要】psd crate 0.3.x の一部のバグにより、layer.rgba() がインターリーブ形式ではなく
        // 平面形式 (RRR...GGG...BBB...AAA...) でデータを返してしまうことがある。
        // これが原因で出力が「ノイズ」に見えるため、正しい順番に並べ替える（インターリーブ処理）。
        if pixels.len() == (w * h * 4) as usize {
            let width = w as usize;
            let height = h as usize;
            let planar = pixels.clone();
            for i in 0..(width * height) {
                pixels[i * 4]     = planar[i];
                pixels[i * 4 + 1] = planar[i + width * height];
                pixels[i * 4 + 2] = planar[i + 2 * width * height];
                pixels[i * 4 + 3] = planar[i + 3 * width * height];
            }
        }

        entries.push(LayerEntry {
            name: sanitize_name(layer.name()),
            pixel_data: pixels,
            w, h,
        });
    }

    emit_log(&app, "info", format!(
        "{} layer(s) to export, {} skipped.", entries.len(), skipped
    ));

    // 出力パスの確定（シリアル）
    // 同じ名前のレイヤーが複数ある場合に上書きされないよう、セッション内でもパスを管理する
    let mut named_entries: Vec<(LayerEntry, String)> = Vec::with_capacity(entries.len());
    let mut session_used_paths = std::collections::HashSet::new();

    for entry in entries {
        let mut out_path = std::path::Path::new(&output_dir)
            .join(format!("{}.{}", entry.name, ext));
        let mut idx = 1u32;
        
        while out_path.exists() || session_used_paths.contains(&out_path) {
            out_path = std::path::Path::new(&output_dir)
                .join(format!("{}_{}.{}", entry.name, idx, ext));
            idx += 1;
        }
        
        session_used_paths.insert(out_path.clone());
        let out_str = out_path.to_string_lossy().into_owned();
        named_entries.push((entry, out_str));
    }

    // 並列エンコード・書き込み
    let results: Vec<(String, String, Result<(), String>)> = named_entries.into_par_iter().map(|(entry, out_str)| {
        let result = (|| {
            // entry.pixel_data を ownership ごと渡して clone を避ける
            let img = image::RgbaImage::from_raw(entry.w, entry.h, entry.pixel_data)
                .ok_or_else(|| format!(
                    "Failed to create image for layer '{}' ({}×{})",
                    entry.name, entry.w, entry.h
                ))?;
            let bytes = encode_image_rgba(&img, &format)?;
            save_bytes(&out_str, &bytes)
        })();
        (entry.name, out_str, result)
    }).collect();

    let mut count = 0usize;
    let mut errors: Vec<String> = Vec::new();

    for (name, out_str, result) in results {
        let filename = std::path::Path::new(&out_str)
            .file_name()
            .map(|f| f.to_string_lossy().into_owned())
            .unwrap_or_else(|| name.clone());
        match result {
            Ok(_) => {
                count += 1;
                emit_log(&app, "success", format!("✓ {}", filename));
            }
            Err(e) => {
                let msg = format!("{}: {}", name, e);
                errors.push(msg.clone());
                emit_log(&app, "error", format!("✗ {}", msg));
            }
        }
    }

    emit_log(&app, "info", format!(
        "Done — {} exported, {} skipped, {} errors.", count, skipped, errors.len()
    ));

    Ok(ExportLayersResult { count, skipped, errors })
}

// ── PSD 比較 + 進捗ログ ───────────────────────────────────────────────────────

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
    app: AppHandle,
    input_a: String,
    input_b: String,
    output: String,
    threshold: u8,
    highlight: String,
) -> Result<CompareResult, String> {
    if input_a == input_b {
        return Err("input_a and input_b must be different files".to_string());
    }
    let allowed_hl = ["red", "magenta", "heat"];
    if !allowed_hl.contains(&highlight.as_str()) {
        return Err(format!(
            "Unsupported highlight mode '{}'. Allowed: red, magenta, heat", highlight
        ));
    }

    let basename = |p: &str| {
        p.replace('\\', "/")
            .split('/')
            .last()
            .unwrap_or(p)
            .to_string()
    };

    emit_log(&app, "info", format!("Loading A: {}", basename(&input_a)));
    emit_log(&app, "info", format!("Loading B: {}", basename(&input_b)));

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

    emit_log(&app, "info", format!(
        "Canvas: {}×{} (A: {}×{}, B: {}×{}). Threshold: {}. Mode: {}.",
        w, h, wa, ha, wb, hb, threshold, highlight
    ));
    emit_log(&app, "info", "Comparing pixels…");

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

    emit_log(&app, "info", format!("Writing diff image…"));
    save_bytes(&output, &encode_image_rgba(&diff, "png")?)?;

    let level = if pct < 1.0 { "success" } else if pct < 10.0 { "warn" } else { "error" };
    emit_log(&app, level, format!(
        "Changed: {:.2}% ({} px) — saved to {}", pct, changed, basename(&output)
    ));

    Ok(CompareResult {
        changed_px: changed,
        total_px: (w * h) as u64,
        changed_pct: pct,
        width: w,
        height: h,
    })
}

// ── スプライトシート + 進捗ログ ───────────────────────────────────────────────

#[derive(serde::Serialize, serde::Deserialize, Clone)]
pub struct SpriteResult {
    pub width: u32,
    pub height: u32,
    pub frame_count: usize,
}

#[tauri::command]
pub fn run_sprite(
    app: AppHandle,
    pattern: String,
    output: String,
    layout: String,
    cols: u32,
    padding: u32,
    format: String,
    json_out: Option<String>,
) -> Result<SpriteResult, String> {
    if pattern.is_empty() {
        return Err("Glob pattern must not be empty".to_string());
    }
    let allowed = ["png", "jpeg", "jpg", "webp"];
    if !allowed.contains(&format.as_str()) {
        return Err(format!("Unsupported format '{}'. Allowed: png, jpeg, webp", format));
    }

    emit_log(&app, "info", format!("Scanning: {}", pattern));

    // ファイル数を先にカウントしてログに出す
    let file_count = glob::glob(&pattern)
        .map(|g| g.filter_map(|e| e.ok())
            .filter(|p| p.extension().map(|e| e.eq_ignore_ascii_case("psd")).unwrap_or(false))
            .count())
        .unwrap_or(0);

    if file_count == 0 {
        emit_log(&app, "warn", "No PSD files matched the pattern.");
    } else {
        emit_log(&app, "info", format!(
            "Found {} PSD file(s). Layout: {}, Padding: {}px.", file_count, layout, padding
        ));
    }

    let sprite_layout = match layout.as_str() {
        "vertical" => SpriteLayout::Vertical,
        "grid"     => {
            emit_log(&app, "info", format!("Grid columns: {}", cols));
            SpriteLayout::Grid
        }
        _          => SpriteLayout::Horizontal,
    };

    emit_log(&app, "info", "Compositing sprite sheet…");

    cmd_sprite(&pattern, &output, sprite_layout, cols, padding, &format, json_out.as_deref())?;

    let meta = image::image_dimensions(&output)
        .map_err(|e| format!("Failed to read output image dimensions: {}", e))?;

    let basename_out = std::path::Path::new(&output)
        .file_name()
        .map(|f| f.to_string_lossy().into_owned())
        .unwrap_or_else(|| output.clone());

    emit_log(&app, "success", format!(
        "✓ {} — {}×{}px, {} frame(s).", basename_out, meta.0, meta.1, file_count
    ));

    if let Some(ref j) = json_out {
        let jname = std::path::Path::new(j)
            .file_name()
            .map(|f| f.to_string_lossy().into_owned())
            .unwrap_or_else(|| j.clone());
        emit_log(&app, "info", format!("JSON map: {}", jname));
    }

    Ok(SpriteResult { width: meta.0, height: meta.1, frame_count: file_count })
}