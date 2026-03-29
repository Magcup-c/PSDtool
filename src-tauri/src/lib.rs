use tauri::{Manager, Emitter};
use tauri_plugin_cli::CliExt;
use std::path::Path;

// ─────────────────────────────────────────────────────────────
//  Tauri invoke commands
// ─────────────────────────────────────────────────────────────

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[tauri::command]
fn get_launch_args() -> Vec<String> {
    std::env::args().collect()
}

#[tauri::command]
fn open_default_app_settings() -> Result<(), String> {
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

#[cfg(target_os = "windows")]
fn is_launched_from_explorer() -> bool {
    use windows::Win32::System::Threading::{
        OpenProcess, GetCurrentProcessId, PROCESS_QUERY_LIMITED_INFORMATION,
    };
    use windows::Win32::System::ProcessStatus::GetModuleFileNameExW;
    use windows::Win32::System::Console::GetConsoleWindow;
    use windows::Win32::Foundation::CloseHandle;

    unsafe {
        // コンソールウィンドウが存在しない = windows_subsystem="windows"ビルド
        // 存在する場合、親プロセス名で判断
        if GetConsoleWindow().0 == 0 {
            return true;
        }

        // 親プロセスIDを取得
        let snapshot = windows::Win32::System::Diagnostics::ToolHelp::CreateToolhelp32Snapshot(
            windows::Win32::System::Diagnostics::ToolHelp::TH32CS_SNAPPROCESS,
            0,
        );
        let Ok(snapshot) = snapshot else { return false };

        let current_pid = GetCurrentProcessId();
        let mut entry = windows::Win32::System::Diagnostics::ToolHelp::PROCESSENTRY32W {
            dwSize: std::mem::size_of::<windows::Win32::System::Diagnostics::ToolHelp::PROCESSENTRY32W>() as u32,
            ..Default::default()
        };

        let mut parent_pid = 0u32;
        if windows::Win32::System::Diagnostics::ToolHelp::Process32FirstW(snapshot, &mut entry).is_ok() {
            loop {
                if entry.th32ProcessID == current_pid {
                    parent_pid = entry.th32ParentProcessID;
                    break;
                }
                if windows::Win32::System::Diagnostics::ToolHelp::Process32NextW(snapshot, &mut entry).is_err() {
                    break;
                }
            }
        }
        let _ = CloseHandle(snapshot);

        if parent_pid == 0 { return false; }

        // 親プロセスの実行ファイル名を取得
        let Ok(handle) = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, parent_pid) else {
            return false;
        };
        let mut buf = [0u16; 260];
        let len = GetModuleFileNameExW(handle, None, &mut buf);
        let _ = CloseHandle(handle);

        if len == 0 { return false; }

        let name = String::from_utf16_lossy(&buf[..len as usize]);
        let lower = name.to_lowercase();

        // explorer.exe から起動された場合のみGUIモード扱い
        lower.ends_with("explorer.exe")
    }
}

// ─────────────────────────────────────────────────────────────
//  Shared PSD helpers
// ─────────────────────────────────────────────────────────────

fn load_psd(input: &str) -> Result<psd::Psd, String> {
    let data = std::fs::read(input)
        .map_err(|e| format!("Failed to read '{}': {}", input, e))?;
    psd::Psd::from_bytes(&data)
        .map_err(|e| format!("Failed to parse PSD '{}': {}", input, e))
}

fn psd_to_rgba_image(psd_file: &psd::Psd) -> Result<image::RgbaImage, String> {
    let width  = psd_file.width();
    let height = psd_file.height();
    let rgba   = psd_file.rgba();
    image::RgbaImage::from_raw(width, height, rgba)
        .ok_or_else(|| "Failed to create image from raw bytes".to_string())
}

fn psd_to_png_bytes(psd_file: &psd::Psd) -> Result<Vec<u8>, String> {
    let img = psd_to_rgba_image(psd_file)?;
    encode_image_rgba(&img, "png")
}

fn encode_image_rgba(img: &image::RgbaImage, format: &str) -> Result<Vec<u8>, String> {
    let mut buf = std::io::Cursor::new(Vec::new());
    let fmt = image_format(format);
    if matches!(fmt, image::ImageFormat::Jpeg) {
        let rgb = image::DynamicImage::ImageRgba8(img.clone()).to_rgb8();
        rgb.write_to(&mut buf, fmt)
            .map_err(|e| format!("Encode error: {}", e))?;
    } else {
        img.write_to(&mut buf, fmt)
            .map_err(|e| format!("Encode error: {}", e))?;
    }
    Ok(buf.into_inner())
}

fn image_format(s: &str) -> image::ImageFormat {
    match s {
        "jpeg" | "jpg" => image::ImageFormat::Jpeg,
        "webp"         => image::ImageFormat::WebP,
        _              => image::ImageFormat::Png,
    }
}

fn image_ext(s: &str) -> &str {
    match s { "jpeg" | "jpg" => "jpg", "webp" => "webp", _ => "png" }
}

fn save_bytes(path: &str, bytes: &[u8]) -> Result<(), String> {
    if let Some(parent) = Path::new(path).parent() {
        if !parent.as_os_str().is_empty() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create directory '{}': {}", parent.display(), e))?;
        }
    }
    std::fs::write(path, bytes)
        .map_err(|e| format!("Failed to write '{}': {}", path, e))
}

fn exit_on(result: Result<(), String>) -> ! {
    match result {
        Ok(_)  => std::process::exit(0),
        Err(e) => { eprintln!("Error: {}", e); std::process::exit(1); }
    }
}

// ─────────────────────────────────────────────────────────────
//  convert  (single PSD → image)
// ─────────────────────────────────────────────────────────────

fn cmd_convert(input: &str, output: &str) -> Result<(), String> {
    let psd   = load_psd(input)?;
    let bytes = psd_to_png_bytes(&psd)?;
    save_bytes(output, &bytes)?;
    println!("✓ Converted: {} → {}", input, output);
    Ok(())
}

// ─────────────────────────────────────────────────────────────
//  batch  (glob pattern → output directory)
// ─────────────────────────────────────────────────────────────

fn cmd_batch(pattern: &str, output_dir: &str, format: &str, verbose: bool) -> Result<(), String> {
    let paths: Vec<_> = glob::glob(pattern)
        .map_err(|e| format!("Invalid glob pattern '{}': {}", pattern, e))?
        .filter_map(|e| e.ok())
        .filter(|p| p.extension().map(|ext| ext.eq_ignore_ascii_case("psd")).unwrap_or(false))
        .collect();

    if paths.is_empty() {
        eprintln!("⚠  No PSD files matched: {}", pattern);
        return Ok(());
    }
    std::fs::create_dir_all(output_dir)
        .map_err(|e| format!("Failed to create output dir '{}': {}", output_dir, e))?;

    let (mut ok, mut err) = (0usize, 0usize);
    for path in &paths {
        let stem     = path.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
        let out_path = Path::new(output_dir).join(format!("{}.{}", stem, image_ext(format)));
        let out_str  = out_path.to_string_lossy().into_owned();
        match (|| -> Result<(), String> {
            let psd   = load_psd(path.to_string_lossy().as_ref())?;
            let img   = psd_to_rgba_image(&psd)?;
            let bytes = encode_image_rgba(&img, format)?;
            save_bytes(&out_str, &bytes)
        })() {
            Ok(_)  => { ok += 1; if verbose { println!("✓ {}", out_str); } }
            Err(e) => { err += 1; eprintln!("✗ {}: {}", path.display(), e); }
        }
    }
    println!("\nBatch done — {} converted, {} failed (total: {})", ok, err, paths.len());
    if err > 0 { std::process::exit(1); }
    Ok(())
}

// ─────────────────────────────────────────────────────────────
//  info  (PSD metadata → JSON)
// ─────────────────────────────────────────────────────────────

fn cmd_info(input: &str, output: Option<&str>, pretty: bool) -> Result<(), String> {
    let psd = load_psd(input)?;

    fn collect_layers(layers: &[psd::PsdLayer]) -> Vec<serde_json::Value> {
        layers.iter().map(|l: &psd::PsdLayer| {
            serde_json::json!({
                "name": l.name(), "visible": l.visible(),
                "left": l.layer_left(), "top": l.layer_top(),
                "right": l.layer_right(), "bottom": l.layer_bottom(),
                "width": l.width() as u32, "height": l.height() as u32,
            })
        }).collect()
    }
    fn count_layers(layers: &[serde_json::Value]) -> usize {
        layers.iter().fold(0, |acc, l| {
            acc + 1 + l.get("children").and_then(|c| c.as_array()).map(|a| count_layers(a)).unwrap_or(0)
        })
    }

    let layers = collect_layers(psd.layers());
    let info = serde_json::json!({
        "file": input, "width": psd.width(), "height": psd.height(),
        "layer_count": count_layers(&layers), "layers": layers,
    });
    let json_str = if pretty { serde_json::to_string_pretty(&info) } else { serde_json::to_string(&info) }
        .map_err(|e| format!("JSON error: {}", e))?;
    match output {
        Some(p) => { save_bytes(p, json_str.as_bytes())?; println!("✓ Info written to: {}", p); }
        None    => println!("{}", json_str),
    }
    Ok(())
}

// ─────────────────────────────────────────────────────────────
//  thumbnail
// ─────────────────────────────────────────────────────────────

fn cmd_thumbnail(input: &str, output: &str, size: u32) -> Result<(), String> {
    let psd   = load_psd(input)?;
    let img   = psd_to_rgba_image(&psd)?;
    let thumb = image::imageops::thumbnail(&img, size, size);
    let fmt   = if output.to_lowercase().ends_with(".jpg") || output.to_lowercase().ends_with(".jpeg") { "jpeg" } else { "png" };
    let bytes = encode_image_rgba(&image::RgbaImage::from(thumb), fmt)?;
    save_bytes(output, &bytes)?;
    println!("✓ Thumbnail ({}px): {} → {}", size, input, output);
    Ok(())
}

// ─────────────────────────────────────────────────────────────
//  layers  (list / show / hide)
// ─────────────────────────────────────────────────────────────

fn name_matches(name: &str, pattern: &str) -> bool {
    name.to_lowercase().contains(&pattern.to_lowercase())
}

fn cmd_layers(input: &str, output: &str, show: &[&str], hide: &[&str], list_only: bool) -> Result<(), String> {
    let psd = load_psd(input)?;
    if list_only {
        fn print_layers(layers: &[psd::PsdLayer]) {
            for l in layers {
                println!("{}  {} ({}×{}+{}+{})",
                    if l.visible() { "●" } else { "○" },
                    l.name(), l.width() as u32, l.height() as u32,
                    l.layer_left(), l.layer_top());
            }
        }
        println!("Layers in '{}':\n", input);
        print_layers(psd.layers());
        println!("\n● = visible  ○ = hidden");
        return Ok(());
    }
    let mut changed = 0usize;
    for l in psd.layers() {
        let name = l.name();
        if !show.is_empty() && show.iter().any(|p| name_matches(name, p)) { changed += 1; println!("  → Show: {}", name); }
        else if !hide.is_empty() && hide.iter().any(|p| name_matches(name, p)) { changed += 1; println!("  → Hide: {}", name); }
    }
    if show.is_empty() && hide.is_empty() { eprintln!("⚠  No --show or --hide specified."); }
    else { println!("  {} change(s) noted.", changed); }
    let bytes = psd_to_png_bytes(&psd)?;
    save_bytes(output, &bytes)?;
    println!("✓ Exported: {} → {}", input, output);
    Ok(())
}

// ─────────────────────────────────────────────────────────────
//  export-layers  (each layer → individual file)
// ─────────────────────────────────────────────────────────────

fn sanitize_name(name: &str) -> String {
    name.chars()
        .map(|c| if c.is_alphanumeric() || c == '-' || c == '_' || c == ' ' { c } else { '_' })
        .collect::<String>().trim().replace(' ', "_")
}

fn cmd_export_layers(input: &str, output_dir: &str, format: &str, visible_only: bool, _flatten_groups: bool) -> Result<(), String> {
    let psd = load_psd(input)?;
    std::fs::create_dir_all(output_dir)
        .map_err(|e| format!("Failed to create output dir: {}", e))?;

    let ext = image_ext(format);
    let (mut count, mut skipped) = (0usize, 0usize);

    println!("Exporting layers from '{}' → '{}'\n", input, output_dir);

    for layer in psd.layers() {
        let name      = sanitize_name(layer.name());

        if visible_only && !layer.visible() { skipped += 1; continue; }

        let pixel_data: Vec<u8> = layer.rgba();
        let (w, h) = (layer.width() as u32, layer.height() as u32);
        if w == 0 || h == 0 { skipped += 1; continue; }

        let img = match image::RgbaImage::from_raw(w, h, pixel_data) {
            Some(i) => i,
            None    => { skipped += 1; continue; }
        };

        let mut out_path = Path::new(output_dir).join(format!("{}.{}", name, ext));
        let mut idx = 1u32;
        while out_path.exists() {
            out_path = Path::new(output_dir).join(format!("{}_{}.{}", name, idx, ext));
            idx += 1;
        }

        let bytes = encode_image_rgba(&img, format)?;
        save_bytes(&out_path.to_string_lossy(), &bytes)?;
        count += 1;
        println!("  ✓ {}  ({}×{})", out_path.file_name().unwrap_or_default().to_string_lossy(), w, h);
    }
    println!("\nDone — {} exported, {} skipped", count, skipped);
    Ok(())
}

// ─────────────────────────────────────────────────────────────
//  compare  (diff two PSD composites → highlighted diff image)
// ─────────────────────────────────────────────────────────────

fn cmd_compare(input_a: &str, input_b: &str, output: &str, threshold: u8, highlight: &str) -> Result<(), String> {
    let img_a = psd_to_rgba_image(&load_psd(input_a)?)?;
    let img_b = psd_to_rgba_image(&load_psd(input_b)?)?;
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
                let pixel = match highlight {
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
    save_bytes(output, &encode_image_rgba(&diff, "png")?)?;
    println!("✓ Diff: {} ↔ {}", input_a, input_b);
    println!("  Canvas: {}×{}  Changed: {} px ({:.2}%)  Threshold: {}  Mode: {}", w, h, changed, pct, threshold, highlight);
    println!("  Output: {}", output);
    Ok(())
}

// ─────────────────────────────────────────────────────────────
//  sprite  (multiple PSDs → sprite sheet + JSON map)
// ─────────────────────────────────────────────────────────────

#[derive(Clone, Copy, PartialEq)]
enum SpriteLayout { Horizontal, Vertical, Grid }

fn cmd_sprite(pattern: &str, output: &str, layout: SpriteLayout, cols: u32, padding: u32, format: &str, json_out: Option<&str>) -> Result<(), String> {
    let mut paths: Vec<_> = glob::glob(pattern)
        .map_err(|e| format!("Invalid glob pattern: {}", e))?
        .filter_map(|e| e.ok())
        .filter(|p| p.extension().map(|e| e.eq_ignore_ascii_case("psd")).unwrap_or(false))
        .collect();
    if paths.is_empty() { return Err(format!("No PSD files matched: {}", pattern)); }
    paths.sort();
    println!("Sprite: {} files\n", paths.len());

    struct Entry { name: String, img: image::RgbaImage, w: u32, h: u32 }
    let mut entries: Vec<Entry> = Vec::new();
    for path in &paths {
        let name = path.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
        let img  = psd_to_rgba_image(&load_psd(path.to_string_lossy().as_ref())?)?;
        let (w, h) = img.dimensions();
        println!("  + {} ({}×{})", name, w, h);
        entries.push(Entry { name, img, w, h });
    }

    let n   = entries.len() as u32;
    let pad = padding;

    let (sheet_w, sheet_h, positions): (u32, u32, Vec<(u32, u32)>) = match layout {
        SpriteLayout::Horizontal => {
            let tw = entries.iter().map(|e| e.w + pad).sum::<u32>() + pad;
            let mh = entries.iter().map(|e| e.h).max().unwrap_or(0) + pad * 2;
            let mut x = pad;
            let pos = entries.iter().map(|e| { let p = (x, pad); x += e.w + pad; p }).collect();
            (tw, mh, pos)
        }
        SpriteLayout::Vertical => {
            let mw = entries.iter().map(|e| e.w).max().unwrap_or(0) + pad * 2;
            let th = entries.iter().map(|e| e.h + pad).sum::<u32>() + pad;
            let mut y = pad;
            let pos = entries.iter().map(|e| { let p = (pad, y); y += e.h + pad; p }).collect();
            (mw, th, pos)
        }
        SpriteLayout::Grid => {
            let cols = cols.max(1);
            let rows = (n + cols - 1) / cols;
            let cw = entries.iter().map(|e| e.w).max().unwrap_or(0);
            let ch = entries.iter().map(|e| e.h).max().unwrap_or(0);
            let sw = cols * (cw + pad) + pad;
            let sh = rows * (ch + pad) + pad;
            let pos = (0..n).map(|i| (pad + (i % cols) * (cw + pad), pad + (i / cols) * (ch + pad))).collect();
            (sw, sh, pos)
        }
    };

    let mut sheet = image::RgbaImage::new(sheet_w, sheet_h);
    let mut sprite_map: Vec<serde_json::Value> = Vec::new();
    for (i, e) in entries.iter().enumerate() {
        let (x, y) = positions[i];
        image::imageops::overlay(&mut sheet, &e.img, x as i64, y as i64);
        sprite_map.push(serde_json::json!({"name": e.name, "x": x, "y": y, "width": e.w, "height": e.h}));
    }

    save_bytes(output, &encode_image_rgba(&sheet, format)?)?;
    println!("\n✓ Sprite: {}×{} → {}  ({} frames, {}px padding)", sheet_w, sheet_h, output, n, pad);

    if let Some(jp) = json_out {
        let map = serde_json::json!({"file": output, "width": sheet_w, "height": sheet_h, "frames": sprite_map});
        save_bytes(jp, serde_json::to_string_pretty(&map).map_err(|e| e.to_string())?.as_bytes())?;
        println!("  Map: {}", jp);
    }
    Ok(())
}

// ─────────────────────────────────────────────────────────────
//  watch  (directory watcher → auto-convert on save)
// ─────────────────────────────────────────────────────────────

fn cmd_watch(watch_dir: &str, output_dir: &str, format: &str, debounce_ms: u64) -> Result<(), String> {
    use notify::{Watcher, RecursiveMode, EventKind, event::ModifyKind};
    use std::sync::mpsc;
    use std::time::{Duration, Instant};
    use std::collections::HashMap;

    let abs_watch = std::fs::canonicalize(watch_dir)
        .map_err(|e| format!("Cannot resolve '{}': {}", watch_dir, e))?;
    std::fs::create_dir_all(output_dir)
        .map_err(|e| format!("Failed to create output dir: {}", e))?;

    println!("👁  Watching: {}", abs_watch.display());
    println!("   Output:   {}", output_dir);
    println!("   Format:   {}   Debounce: {}ms", format, debounce_ms);
    println!("   Ctrl+C to stop.\n");

    let (tx, rx) = mpsc::channel();
    let mut watcher = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
        if let Ok(ev) = res { let _ = tx.send(ev); }
    }).map_err(|e| format!("Watcher error: {}", e))?;

    watcher.watch(&abs_watch, RecursiveMode::Recursive)
        .map_err(|e| format!("Watch error: {}", e))?;

    let debounce = Duration::from_millis(debounce_ms);
    let mut pending: HashMap<std::path::PathBuf, Instant> = HashMap::new();

    loop {
        while let Ok(ev) = rx.recv_timeout(Duration::from_millis(50)) {
            if matches!(ev.kind, EventKind::Create(_) | EventKind::Modify(ModifyKind::Data(_))) {
                for p in ev.paths {
                    if p.extension().map(|e| e.eq_ignore_ascii_case("psd")).unwrap_or(false) {
                        pending.insert(p, Instant::now());
                    }
                }
            }
        }
        let now = Instant::now();
        let ready: Vec<_> = pending.iter()
            .filter(|(_, t)| now.duration_since(**t) >= debounce)
            .map(|(p, _)| p.clone()).collect();

        for path in ready {
            pending.remove(&path);
            let stem    = path.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
            let out_str = Path::new(output_dir).join(format!("{}.{}", stem, image_ext(format))).to_string_lossy().into_owned();
            let ts      = chrono::Local::now().format("%H:%M:%S");
            match (|| -> Result<(), String> {
                let psd   = load_psd(path.to_string_lossy().as_ref())?;
                let img   = psd_to_rgba_image(&psd)?;
                let bytes = encode_image_rgba(&img, format)?;
                save_bytes(&out_str, &bytes)
            })() {
                Ok(_)  => println!("[{}] ✓ {}", ts, out_str),
                Err(e) => eprintln!("[{}] ✗ {}: {}", ts, stem, e),
            }
        }
    }
}

// ─────────────────────────────────────────────────────────────
//  Tauri app entry point
// ─────────────────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
        // Windowsでコンソール窓を非表示にする（CLIモード以外の場合）
    #[cfg(target_os = "windows")]
    {
        let args: Vec<String> = std::env::args().collect();
        let is_cli = args.get(1).map(|s| {
            matches!(s.as_str(),
                "convert" | "batch" | "info" | "thumbnail" |
                "layers" | "export-layers" | "compare" | "sprite" | "watch"
            )
        }).unwrap_or(false);

        // CLIコマンド指定なし かつ エクスプローラーから起動 → コンソールを切り離す
        if !is_cli && is_launched_from_explorer() {
            unsafe {
                windows::Win32::System::Console::FreeConsole();
            }
        }
    }

    // 以降は既存のCLI判定・Tauri起動処理...

    // ① Tauri を起動する前に引数を見てCLIか判定
    let args: Vec<String> = std::env::args().collect();
    
    if let Some(subcmd) = args.get(1).map(|s| s.as_str()) {
        match subcmd {
            "convert" => {
                match (args.get(2), args.get(3)) {
                    (Some(i), Some(o)) => exit_on(cmd_convert(i, o)),
                    _ => { eprintln!("Usage: psdStudio convert <input.psd> <output.png>"); std::process::exit(1); }
                }
            }
            "batch" => {
                // args から自前でパース
                let pattern = args.get(2).map(|s| s.as_str());
                let mut output = "./output";
                let mut format = "png";
                let mut verbose = false;
                let mut i = 3;
                while i < args.len() {
                    match args[i].as_str() {
                        "-o" | "--output"  => { i += 1; if let Some(v) = args.get(i) { output = v; } }
                        "-f" | "--format"  => { i += 1; if let Some(v) = args.get(i) { format = v; } }
                        "-v" | "--verbose" => { verbose = true; }
                        _ => {}
                    }
                    i += 1;
                }
                match pattern {
                    Some(p) => exit_on(cmd_batch(p, output, format, verbose)),
                    None => { eprintln!("Usage: psdStudio batch <\"*.psd\"> [-o DIR] [-f png|jpeg|webp] [-v]"); std::process::exit(1); }
                }
            }
            "info" => {
                let input = args.get(2).map(|s| s.as_str());
                let mut output: Option<&str> = None;
                let mut pretty = true;
                let mut i = 3;
                while i < args.len() {
                    match args[i].as_str() {
                        "-o" | "--output" => { i += 1; output = args.get(i).map(|s| s.as_str()); }
                        "-p" | "--pretty" => { pretty = true; }
                        _ => {}
                    }
                    i += 1;
                }
                match input {
                    Some(inp) => exit_on(cmd_info(inp, output, pretty)),
                    None => { eprintln!("Usage: psdStudio info <input.psd> [-o out.json]"); std::process::exit(1); }
                }
            }
            "thumbnail" => {
                let input  = args.get(2).map(|s| s.as_str());
                let output = args.get(3).map(|s| s.as_str());
                let mut size = 256u32;
                let mut i = 4;
                while i < args.len() {
                    match args[i].as_str() {
                        "-s" | "--size" => { i += 1; if let Some(v) = args.get(i) { size = v.parse().unwrap_or(256); } }
                        _ => {}
                    }
                    i += 1;
                }
                match (input, output) {
                    (Some(i), Some(o)) => exit_on(cmd_thumbnail(i, o, size)),
                    _ => { eprintln!("Usage: psdStudio thumbnail <input.psd> <output.png> [-s 256]"); std::process::exit(1); }
                }
            }
            "layers" => {
                let input = args.get(2).map(|s| s.as_str());
                let mut output = "output.png";
                let mut list_only = false;
                let mut show_pat = String::new();
                let mut hide_pat = String::new();
                let mut i = 3;
                while i < args.len() {
                    match args[i].as_str() {
                        "-l" | "--list"   => { list_only = true; }
                        "-o" | "--output" => { i += 1; if let Some(v) = args.get(i) { output = v; } }
                        "--show"          => { i += 1; if let Some(v) = args.get(i) { show_pat = v.clone(); } }
                        "--hide"          => { i += 1; if let Some(v) = args.get(i) { hide_pat = v.clone(); } }
                        _ => {}
                    }
                    i += 1;
                }
                let show: Vec<&str> = show_pat.split(',').map(|s| s.trim()).filter(|s| !s.is_empty()).collect();
                let hide: Vec<&str> = hide_pat.split(',').map(|s| s.trim()).filter(|s| !s.is_empty()).collect();
                match input {
                    Some(inp) => exit_on(cmd_layers(inp, output, &show, &hide, list_only)),
                    None => { eprintln!("Usage: psdStudio layers <input.psd> [--list] [--show A,B] [--hide C] [-o out.png]"); std::process::exit(1); }
                }
            }
            "export-layers" => {
                let input = args.get(2).map(|s| s.as_str());
                let mut output = "./layers";
                let mut format = "png";
                let mut visible_only = false;
                let mut flatten = false;
                let mut i = 3;
                while i < args.len() {
                    match args[i].as_str() {
                        "-o" | "--output"       => { i += 1; if let Some(v) = args.get(i) { output = v; } }
                        "-f" | "--format"       => { i += 1; if let Some(v) = args.get(i) { format = v; } }
                        "--visible-only"        => { visible_only = true; }
                        "--flatten"             => { flatten = true; }
                        _ => {}
                    }
                    i += 1;
                }
                match input {
                    Some(inp) => exit_on(cmd_export_layers(inp, output, format, visible_only, flatten)),
                    None => { eprintln!("Usage: psdStudio export-layers <input.psd> [-o DIR] [-f png|jpeg|webp] [--visible-only] [--flatten]"); std::process::exit(1); }
                }
            }
            "compare" => {
                let a = args.get(2).map(|s| s.as_str());
                let b = args.get(3).map(|s| s.as_str());
                let mut output = "diff.png";
                let mut threshold = 10u8;
                let mut highlight = "red";
                let mut i = 4;
                while i < args.len() {
                    match args[i].as_str() {
                        "-o" | "--output"    => { i += 1; if let Some(v) = args.get(i) { output = v; } }
                        "-t" | "--threshold" => { i += 1; if let Some(v) = args.get(i) { threshold = v.parse().unwrap_or(10); } }
                        "--highlight"        => { i += 1; if let Some(v) = args.get(i) { highlight = v; } }
                        _ => {}
                    }
                    i += 1;
                }
                match (a, b) {
                    (Some(a), Some(b)) => exit_on(cmd_compare(a, b, output, threshold, highlight)),
                    _ => { eprintln!("Usage: psdStudio compare <a.psd> <b.psd> [-o diff.png] [-t 10] [--highlight red|magenta|heat]"); std::process::exit(1); }
                }
            }
            "sprite" => {
                let pattern = args.get(2).map(|s| s.as_str());
                let mut output = "sprite.png";
                let mut layout = SpriteLayout::Horizontal;
                let mut cols = 4u32;
                let mut padding = 4u32;
                let mut format = "png";
                let mut json_out: Option<&str> = None;
                let mut i = 3;
                while i < args.len() {
                    match args[i].as_str() {
                        "-o" | "--output"  => { i += 1; if let Some(v) = args.get(i) { output = v; } }
                        "--layout"         => { i += 1; if let Some(v) = args.get(i) { layout = match v.as_str() { "vertical" => SpriteLayout::Vertical, "grid" => SpriteLayout::Grid, _ => SpriteLayout::Horizontal }; } }
                        "--cols"           => { i += 1; if let Some(v) = args.get(i) { cols = v.parse().unwrap_or(4); } }
                        "--padding"        => { i += 1; if let Some(v) = args.get(i) { padding = v.parse().unwrap_or(4); } }
                        "-f" | "--format"  => { i += 1; if let Some(v) = args.get(i) { format = v; } }
                        "--json"           => { i += 1; json_out = args.get(i).map(|s| s.as_str()); }
                        _ => {}
                    }
                    i += 1;
                }
                match pattern {
                    Some(p) => exit_on(cmd_sprite(p, output, layout, cols, padding, format, json_out)),
                    None => { eprintln!("Usage: psdStudio sprite <\"*.psd\"> [-o sprite.png] [--layout horizontal|vertical|grid] [--cols 4] [--padding 4] [--json map.json]"); std::process::exit(1); }
                }
            }
            "watch" => {
                let dir = args.get(2).map(|s| s.as_str()).unwrap_or(".");
                let mut output = "./output";
                let mut format = "png";
                let mut debounce = 300u64;
                let mut i = 3;
                while i < args.len() {
                    match args[i].as_str() {
                        "-o" | "--output"   => { i += 1; if let Some(v) = args.get(i) { output = v; } }
                        "-f" | "--format"   => { i += 1; if let Some(v) = args.get(i) { format = v; } }
                        "--debounce"        => { i += 1; if let Some(v) = args.get(i) { debounce = v.parse().unwrap_or(300); } }
                        _ => {}
                    }
                    i += 1;
                }
                exit_on(cmd_watch(dir, output, format, debounce));
            }
            // PSDファイルパスが直接渡された場合はGUIで開く（後述）
            s if s.ends_with(".psd") || s.ends_with(".PSD") => {
                // GUIに渡すのでここではスルー → Tauriを起動
            }
            _ => {
                // 不明なサブコマンドはヘルプ表示して終了
                eprintln!("Unknown command: {}", subcmd);
                eprintln!("Commands: convert, batch, info, thumbnail, layers, export-layers, compare, sprite, watch");
                std::process::exit(1);
            }
        }
    }

    // ② CLIに該当しなかった場合のみ Tauri GUI を起動
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_cli::init())
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            let _ = app.emit("open-file", args);
        }))
        .invoke_handler(tauri::generate_handler![greet, get_launch_args, open_default_app_settings])
        .setup(|app| {
            // CLIプラグインはGUI起動時のオプション引数（PSDファイル直接渡し等）に使う
            match app.cli().matches() {
                Ok(matches) => {
                    if let Some(sub) = matches.subcommand {
                        if sub.name == "open" {
                            if let Some(p) = sub.matches.args.get("path").and_then(|v| v.value.as_str()) {
                                let _ = app.emit("open-file", vec!["psdStudio".to_string(), p.to_string()]);
                            }
                        }
                    }
                }
                Err(e) => eprintln!("CLI Error: {}", e),
            }
            let window = app.get_webview_window("main").unwrap();
            window.show().unwrap();
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}