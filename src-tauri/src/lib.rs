use tauri::{Manager, Emitter};
use tauri_plugin_cli::CliExt;
use std::path::Path;

// ─────────────────────────────────────────────────────────────
//  CLI Help System
// ─────────────────────────────────────────────────────────────

const VERSION: &str = "0.1.0";
const BIN: &str = "psdStudio";

/// Prints the top-level help message and exits with code 0.
fn print_help() -> ! {
    println!(
r#"psdStudio v{VERSION}  —  PSD viewer & headless processing tool

USAGE:
    {BIN} [OPTIONS]
    {BIN} <COMMAND> [ARGS...]
    {BIN} <file.psd>              Open a PSD file in the GUI editor

OPTIONS:
    -h, --help       Show this help message
    -V, --version    Show version information

COMMANDS:
    convert          Convert a single PSD → image file
    batch            Batch-convert PSD files matching a glob pattern
    info             Extract PSD metadata as JSON
    thumbnail        Generate a thumbnail from a PSD file
    layers           List or manipulate layer visibility
    export-layers    Export each layer as an individual image file
    compare          Generate a diff image highlighting changes between two PSDs
    sprite           Combine multiple PSDs into a single sprite sheet
    watch            Watch a directory and auto-convert PSD files on save

Run '{BIN} <COMMAND> --help' for detailed usage of each command.

EXAMPLES:
    {BIN} design.psd
    {BIN} convert design.psd output.png
    {BIN} batch "assets/*.psd" -o ./out -f webp
    {BIN} info design.psd
    {BIN} watch ./src -o ./out -f png"#
    );
    std::process::exit(0);
}

fn print_version() -> ! {
    println!("{BIN} {VERSION}");
    std::process::exit(0);
}

// ── Per-command help ─────────────────────────────────────────

fn help_convert() -> ! {
    println!(
r#"psdStudio convert — Convert a single PSD file to an image

USAGE:
    {BIN} convert <INPUT> <OUTPUT>

ARGS:
    <INPUT>     Path to the source .psd file
    <OUTPUT>    Path to the output image file

OPTIONS:
    -h, --help  Show this help message

OUTPUT FORMAT is inferred from the file extension:
    .png          PNG  (lossless, alpha supported)
    .jpg / .jpeg  JPEG (lossy, no alpha)
    .webp         WebP (lossy, alpha supported)

EXAMPLES:
    {BIN} convert design.psd output.png
    {BIN} convert design.psd preview.jpg
    {BIN} convert design.psd compressed.webp"#
    );
    std::process::exit(0);
}

fn help_batch() -> ! {
    println!(
r#"psdStudio batch — Batch-convert PSD files matching a glob pattern

USAGE:
    {BIN} batch <PATTERN> [OPTIONS]

ARGS:
    <PATTERN>    Glob pattern for PSD files (e.g. "assets/*.psd")
                 Quote the pattern to prevent shell expansion.

OPTIONS:
    -o, --output <DIR>     Output directory  [default: ./output]
    -f, --format <FMT>     Output format: png | jpeg | webp  [default: png]
    -v, --verbose          Print each converted file path
    -h, --help             Show this help message

EXAMPLES:
    {BIN} batch "*.psd"
    {BIN} batch "src/**/*.psd" -o ./dist -f webp -v
    {BIN} batch "sprites/*.psd" -o ./out -f jpeg"#
    );
    std::process::exit(0);
}

fn help_info() -> ! {
    println!(
r#"psdStudio info — Extract metadata from a PSD file as JSON

USAGE:
    {BIN} info <INPUT> [OPTIONS]

ARGS:
    <INPUT>    Path to the source .psd file

OPTIONS:
    -o, --output <FILE>    Write JSON to a file instead of stdout
    -p, --pretty           Pretty-print JSON output  [default: on]
    -h, --help             Show this help message

OUTPUT FIELDS:
    file, width, height, layer_count, layers[]
      layers[]: name, visible, left, top, right, bottom, width, height

EXAMPLES:
    {BIN} info design.psd
    {BIN} info design.psd -o meta.json
    {BIN} info design.psd | jq '.layer_count'"#
    );
    std::process::exit(0);
}

fn help_thumbnail() -> ! {
    println!(
r#"psdStudio thumbnail — Generate a thumbnail from a PSD file

USAGE:
    {BIN} thumbnail <INPUT> <OUTPUT> [OPTIONS]

ARGS:
    <INPUT>     Path to the source .psd file
    <OUTPUT>    Path to the output thumbnail file (.png or .jpg)

OPTIONS:
    -s, --size <PX>    Max width/height in pixels (aspect preserved)  [default: 256]
    -h, --help         Show this help message

EXAMPLES:
    {BIN} thumbnail design.psd thumb.png
    {BIN} thumbnail design.psd thumb.jpg -s 128
    {BIN} thumbnail design.psd preview.png -s 512"#
    );
    std::process::exit(0);
}

fn help_layers() -> ! {
    println!(
r#"psdStudio layers — List or manipulate layer visibility in a PSD

USAGE:
    {BIN} layers <INPUT> [OPTIONS]

ARGS:
    <INPUT>    Path to the source .psd file

OPTIONS:
    -l, --list              List all layers and exit (no output written)
    --show <NAMES>          Comma-separated layer name patterns to show
    --hide <NAMES>          Comma-separated layer name patterns to hide
    -o, --output <FILE>     Output PNG file path  [default: output.png]
    -h, --help              Show this help message

NOTES:
    Name matching is case-insensitive substring search.
    --show / --hide can be combined.

EXAMPLES:
    {BIN} layers design.psd --list
    {BIN} layers design.psd --show "Background,Shadow" -o visible.png
    {BIN} layers design.psd --hide "Draft" --show "Final" -o result.png"#
    );
    std::process::exit(0);
}

fn help_export_layers() -> ! {
    println!(
r#"psdStudio export-layers — Export each layer as an individual image file

USAGE:
    {BIN} export-layers <INPUT> [OPTIONS]

ARGS:
    <INPUT>    Path to the source .psd file

OPTIONS:
    -o, --output <DIR>     Output directory  [default: ./layers]
    -f, --format <FMT>     Output format: png | jpeg | webp  [default: png]
    --visible-only         Skip hidden layers
    --flatten              Flatten group layers before export
    -h, --help             Show this help message

NOTES:
    Output filenames are derived from layer names.
    Special characters are replaced with underscores.
    Duplicate names get a numeric suffix (_1, _2, …).

EXAMPLES:
    {BIN} export-layers design.psd
    {BIN} export-layers design.psd -o ./parts -f webp
    {BIN} export-layers design.psd --visible-only -o ./export"#
    );
    std::process::exit(0);
}

fn help_compare() -> ! {
    println!(
r#"psdStudio compare — Diff two PSD files and generate a highlight image

USAGE:
    {BIN} compare <INPUT_A> <INPUT_B> [OPTIONS]

ARGS:
    <INPUT_A>    Path to the first .psd file
    <INPUT_B>    Path to the second .psd file

OPTIONS:
    -o, --output <FILE>       Output diff image path  [default: diff.png]
    -t, --threshold <0-255>   Pixel delta to count as changed  [default: 10]
    --highlight <MODE>        Highlight color mode  [default: red]
                              red | magenta | heat
    -h, --help                Show this help message

HIGHLIGHT MODES:
    red       Changed pixels → solid red
    magenta   Changed pixels → solid magenta
    heat      Changed pixels → gradient from yellow (low) to red (high)

EXAMPLES:
    {BIN} compare v1.psd v2.psd
    {BIN} compare v1.psd v2.psd -o changes.png -t 5
    {BIN} compare v1.psd v2.psd --highlight heat -o heatmap.png"#
    );
    std::process::exit(0);
}

fn help_sprite() -> ! {
    println!(
r#"psdStudio sprite — Combine multiple PSDs into a single sprite sheet

USAGE:
    {BIN} sprite <PATTERN> [OPTIONS]

ARGS:
    <PATTERN>    Glob pattern for PSD files (e.g. "frames/*.psd")
                 Files are sorted alphabetically before packing.

OPTIONS:
    -o, --output <FILE>     Output sprite sheet path  [default: sprite.png]
    --layout <MODE>         Packing layout  [default: horizontal]
                            horizontal | vertical | grid
    --cols <N>              Columns for grid layout  [default: 4]
    --padding <PX>          Padding between sprites in pixels  [default: 4]
    -f, --format <FMT>      Output format: png | jpeg | webp  [default: png]
    --json <FILE>           Write a JSON frame map to this file
    -h, --help              Show this help message

JSON MAP FIELDS (per frame):
    name, x, y, width, height

EXAMPLES:
    {BIN} sprite "frames/*.psd" -o sheet.png
    {BIN} sprite "icons/*.psd" --layout grid --cols 8 --padding 2
    {BIN} sprite "frames/*.psd" -o sheet.png --json frames.json
    {BIN} sprite "assets/*.psd" --layout vertical -f webp -o sheet.webp"#
    );
    std::process::exit(0);
}

fn help_watch() -> ! {
    println!(
r#"psdStudio watch — Watch a directory and auto-convert PSD files on save

USAGE:
    {BIN} watch [DIR] [OPTIONS]

ARGS:
    [DIR]    Directory to watch recursively  [default: current directory]

OPTIONS:
    -o, --output <DIR>       Output directory for converted files  [default: ./output]
    -f, --format <FMT>       Output format: png | jpeg | webp  [default: png]
    --debounce <MS>          Debounce delay in milliseconds  [default: 300]
    -h, --help               Show this help message

NOTES:
    Press Ctrl+C to stop watching.
    Output filenames mirror the input PSD stem (e.g. design.psd → design.png).
    Multiple rapid saves are coalesced using the debounce window.

EXAMPLES:
    {BIN} watch
    {BIN} watch ./src -o ./dist -f webp
    {BIN} watch ./assets -o ./out --debounce 500"#
    );
    std::process::exit(0);
}

// ── Argument helpers ─────────────────────────────────────────

/// Returns true if any arg in `args` is `-h` or `--help`.
fn wants_help(args: &[String]) -> bool {
    args.iter().any(|a| a == "-h" || a == "--help")
}

// ─────────────────────────────────────────────────────────────
//  PSD Metadata Structures
// ─────────────────────────────────────────────────────────────

#[derive(serde::Serialize, serde::Deserialize, Clone)]
pub struct PsdLayerInfo {
    pub name: String,
    pub visible: bool,
    pub opacity: u8,
    pub left: i32,
    pub top: i32,
    pub width: u32,
    pub height: u32,
    pub children: Option<Vec<PsdLayerInfo>>,
}

#[derive(serde::Serialize, serde::Deserialize, Clone)]
pub struct PsdMetadata {
    pub width: u32,
    pub height: u32,
    pub layers: Vec<PsdLayerInfo>,
}

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
fn parse_psd_metadata(file_path: String) -> Result<PsdMetadata, String> {
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
        if GetConsoleWindow().0 == 0 {
            return true;
        }

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

        let Ok(handle) = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, parent_pid) else {
            return false;
        };
        let mut buf = [0u16; 260];
        let len = GetModuleFileNameExW(handle, None, &mut buf);
        let _ = CloseHandle(handle);

        if len == 0 { return false; }

        let name = String::from_utf16_lossy(&buf[..len as usize]);
        let lower = name.to_lowercase();
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
//  convert
// ─────────────────────────────────────────────────────────────

fn cmd_convert(input: &str, output: &str) -> Result<(), String> {
    let psd   = load_psd(input)?;
    let bytes = psd_to_png_bytes(&psd)?;
    save_bytes(output, &bytes)?;
    println!("✓ Converted: {} → {}", input, output);
    Ok(())
}

// ─────────────────────────────────────────────────────────────
//  batch
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
//  info
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
//  layers
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
//  export-layers
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
        let name = sanitize_name(layer.name());

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
//  compare
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
//  sprite
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
//  watch
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
//  GUI invoke commands — CLIコマンドをTauriコマンドとして公開
// ─────────────────────────────────────────────────────────────

#[derive(serde::Serialize, serde::Deserialize, Clone)]
pub struct BatchResult {
    pub ok: usize,
    pub err: usize,
    pub total: usize,
    pub errors: Vec<String>,
}

#[tauri::command]
fn run_batch(pattern: String, output_dir: String, format: String) -> Result<BatchResult, String> {
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
fn run_export_layers(input: String, output_dir: String, format: String, visible_only: bool) -> Result<ExportLayersResult, String> {
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
fn run_compare(input_a: String, input_b: String, output: String, threshold: u8, highlight: String) -> Result<CompareResult, String> {
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
fn run_sprite(pattern: String, output: String, layout: String, cols: u32, padding: u32, format: String, json_out: Option<String>) -> Result<SpriteResult, String> {
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

// ─────────────────────────────────────────────────────────────
//  Tauri app entry point
// ─────────────────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(target_os = "windows")]
    {
        let args: Vec<String> = std::env::args().collect();
        let is_cli = args.get(1).map(|s| {
            matches!(s.as_str(),
                "convert" | "batch" | "info" | "thumbnail" |
                "layers" | "export-layers" | "compare" | "sprite" | "watch"
            )
        }).unwrap_or(false);

        if !is_cli && is_launched_from_explorer() {
            unsafe {
                let _ = windows::Win32::System::Console::FreeConsole();
            }
        }
    }

    let args: Vec<String> = std::env::args().collect();

    // ── Global flags: --help / -h / --version / -V ──────────
    if let Some(flag) = args.get(1).map(|s| s.as_str()) {
        match flag {
            "-h" | "--help"    => print_help(),
            "-V" | "--version" => print_version(),
            _ => {}
        }
    }
    // No arguments at all → launch GUI
    if args.len() == 1 {
        // fall through to Tauri below
    }

    // ── Subcommand dispatch ───────────────────────────────────
    if let Some(subcmd) = args.get(1).map(|s| s.as_str()) {
        match subcmd {

            "convert" => {
                if wants_help(&args[2..]) { help_convert(); }
                match (args.get(2), args.get(3)) {
                    (Some(i), Some(o)) => exit_on(cmd_convert(i, o)),
                    _ => {
                        eprintln!("Error: Missing arguments.\n");
                        eprintln!("Usage: {BIN} convert <INPUT> <OUTPUT>");
                        eprintln!("       {BIN} convert --help");
                        std::process::exit(1);
                    }
                }
            }

            "batch" => {
                if wants_help(&args[2..]) { help_batch(); }
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
                    None => {
                        eprintln!("Error: Missing glob pattern.\n");
                        eprintln!("Usage: {BIN} batch <PATTERN> [OPTIONS]");
                        eprintln!("       {BIN} batch --help");
                        std::process::exit(1);
                    }
                }
            }

            "info" => {
                if wants_help(&args[2..]) { help_info(); }
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
                    None => {
                        eprintln!("Error: Missing input file.\n");
                        eprintln!("Usage: {BIN} info <INPUT> [OPTIONS]");
                        eprintln!("       {BIN} info --help");
                        std::process::exit(1);
                    }
                }
            }

            "thumbnail" => {
                if wants_help(&args[2..]) { help_thumbnail(); }
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
                    (Some(inp), Some(out)) => exit_on(cmd_thumbnail(inp, out, size)),
                    _ => {
                        eprintln!("Error: Missing arguments.\n");
                        eprintln!("Usage: {BIN} thumbnail <INPUT> <OUTPUT> [OPTIONS]");
                        eprintln!("       {BIN} thumbnail --help");
                        std::process::exit(1);
                    }
                }
            }

            "layers" => {
                if wants_help(&args[2..]) { help_layers(); }
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
                    None => {
                        eprintln!("Error: Missing input file.\n");
                        eprintln!("Usage: {BIN} layers <INPUT> [OPTIONS]");
                        eprintln!("       {BIN} layers --help");
                        std::process::exit(1);
                    }
                }
            }

            "export-layers" => {
                if wants_help(&args[2..]) { help_export_layers(); }
                let input = args.get(2).map(|s| s.as_str());
                let mut output = "./layers";
                let mut format = "png";
                let mut visible_only = false;
                let mut flatten = false;
                let mut i = 3;
                while i < args.len() {
                    match args[i].as_str() {
                        "-o" | "--output" => { i += 1; if let Some(v) = args.get(i) { output = v; } }
                        "-f" | "--format" => { i += 1; if let Some(v) = args.get(i) { format = v; } }
                        "--visible-only"  => { visible_only = true; }
                        "--flatten"       => { flatten = true; }
                        _ => {}
                    }
                    i += 1;
                }
                match input {
                    Some(inp) => exit_on(cmd_export_layers(inp, output, format, visible_only, flatten)),
                    None => {
                        eprintln!("Error: Missing input file.\n");
                        eprintln!("Usage: {BIN} export-layers <INPUT> [OPTIONS]");
                        eprintln!("       {BIN} export-layers --help");
                        std::process::exit(1);
                    }
                }
            }

            "compare" => {
                if wants_help(&args[2..]) { help_compare(); }
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
                    _ => {
                        eprintln!("Error: Missing arguments.\n");
                        eprintln!("Usage: {BIN} compare <INPUT_A> <INPUT_B> [OPTIONS]");
                        eprintln!("       {BIN} compare --help");
                        std::process::exit(1);
                    }
                }
            }

            "sprite" => {
                if wants_help(&args[2..]) { help_sprite(); }
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
                        "-o" | "--output" => { i += 1; if let Some(v) = args.get(i) { output = v; } }
                        "--layout"        => { i += 1; if let Some(v) = args.get(i) { layout = match v.as_str() { "vertical" => SpriteLayout::Vertical, "grid" => SpriteLayout::Grid, _ => SpriteLayout::Horizontal }; } }
                        "--cols"          => { i += 1; if let Some(v) = args.get(i) { cols = v.parse().unwrap_or(4); } }
                        "--padding"       => { i += 1; if let Some(v) = args.get(i) { padding = v.parse().unwrap_or(4); } }
                        "-f" | "--format" => { i += 1; if let Some(v) = args.get(i) { format = v; } }
                        "--json"          => { i += 1; json_out = args.get(i).map(|s| s.as_str()); }
                        _ => {}
                    }
                    i += 1;
                }
                match pattern {
                    Some(p) => exit_on(cmd_sprite(p, output, layout, cols, padding, format, json_out)),
                    None => {
                        eprintln!("Error: Missing glob pattern.\n");
                        eprintln!("Usage: {BIN} sprite <PATTERN> [OPTIONS]");
                        eprintln!("       {BIN} sprite --help");
                        std::process::exit(1);
                    }
                }
            }

            "watch" => {
                if wants_help(&args[2..]) { help_watch(); }
                let dir = args.get(2).map(|s| s.as_str()).unwrap_or(".");
                let mut output = "./output";
                let mut format = "png";
                let mut debounce = 300u64;
                let mut i = 3;
                while i < args.len() {
                    match args[i].as_str() {
                        "-o" | "--output" => { i += 1; if let Some(v) = args.get(i) { output = v; } }
                        "-f" | "--format" => { i += 1; if let Some(v) = args.get(i) { format = v; } }
                        "--debounce"      => { i += 1; if let Some(v) = args.get(i) { debounce = v.parse().unwrap_or(300); } }
                        _ => {}
                    }
                    i += 1;
                }
                exit_on(cmd_watch(dir, output, format, debounce));
            }

            // PSD file path passed directly → GUI opens it
            s if s.ends_with(".psd") || s.ends_with(".PSD") => {
                // fall through to Tauri GUI
            }

            _ => {
                eprintln!("Error: Unknown command '{}'.\n", subcmd);
                eprintln!("Run '{BIN} --help' to see available commands.");
                std::process::exit(1);
            }
        }
    }

    // ── Tauri GUI ────────────────────────────────────────────
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_cli::init())
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            let _ = app.emit("open-file", args);
        }))
        .invoke_handler(tauri::generate_handler![greet, get_launch_args, parse_psd_metadata, open_default_app_settings,run_batch, run_export_layers, run_compare, run_sprite,])
        .setup(|app| {
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
