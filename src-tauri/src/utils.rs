use std::path::Path;

// ── PSD 読み込み ─────────────────────────────────────────────────────────────

pub fn load_psd(input: &str) -> Result<psd::Psd, String> {
    let path = Path::new(input);
    if !path.exists() {
        return Err(format!("File not found: '{}'", input));
    }
    if !path.is_file() {
        return Err(format!("Path is not a file: '{}'", input));
    }
    match path.extension().and_then(|e| e.to_str()) {
        Some(ext) if ext.eq_ignore_ascii_case("psd") => {}
        Some(ext) => eprintln!("Warning: unexpected extension '.{}' for '{}'", ext, input),
        None => eprintln!("Warning: no extension for '{}'", input),
    }

    let data = std::fs::read(input)
        .map_err(|e| format!("Failed to read '{}': {}", input, e))?;

    if data.len() < 26 {
        return Err(format!("File too small to be a valid PSD: '{}' ({} bytes)", input, data.len()));
    }
    if &data[..4] != b"8BPS" {
        return Err(format!(
            "Invalid PSD signature in '{}' (got {:?}, expected \"8BPS\")",
            input,
            &data[..4.min(data.len())]
        ));
    }

    psd::Psd::from_bytes(&data)
        .map_err(|e| format!("Failed to parse PSD '{}': {}", input, e))
}

// ── 画像変換 ─────────────────────────────────────────────────────────────────

pub fn psd_to_rgba_image(psd_file: &psd::Psd) -> Result<image::RgbaImage, String> {
    let width  = psd_file.width();
    let height = psd_file.height();

    if width == 0 || height == 0 {
        return Err(format!("PSD has zero dimension: {}×{}", width, height));
    }

    let megapixels = (width as u64 * height as u64) as f64 / 1_000_000.0;
    if megapixels > 200.0 {
        eprintln!("Warning: Large PSD ({:.1}MP) — this may use significant memory", megapixels);
    }

    let rgba = psd_file.rgba();
    let expected = (width * height * 4) as usize;
    if rgba.len() != expected {
        return Err(format!(
            "Unexpected RGBA data length: got {} bytes, expected {} ({}×{}×4)",
            rgba.len(), expected, width, height
        ));
    }

    image::RgbaImage::from_raw(width, height, rgba)
        .ok_or_else(|| format!("Failed to create image from raw bytes ({}×{})", width, height))
}

/// psd crate の PsdLayer から RGBA 画像を安全に生成する。
///
/// psd crate v0.3.x の `layer.rgba()` はレイヤーの生ピクセルデータを
/// インターリーブ RGBA (R,G,B,A,R,G,B,A,...) で返す。
/// ただし一部のレイヤー（調整レイヤー、空レイヤー）は
/// ゼロ次元またはゼロバイトのデータを返す場合がある。
pub fn layer_to_rgba_image(layer: &psd::PsdLayer) -> Option<image::RgbaImage> {
    let w = layer.width() as u32;
    let h = layer.height() as u32;

    if w == 0 || h == 0 {
        return None;
    }

    let pixel_data = layer.rgba();
    let expected = (w * h * 4) as usize;

    if pixel_data.len() != expected {
        eprintln!(
            "Warning: layer '{}' rgba data mismatch: got {} bytes, expected {} ({}×{}×4). Skipping.",
            layer.name(), pixel_data.len(), expected, w, h
        );
        return None;
    }

    image::RgbaImage::from_raw(w, h, pixel_data)
}

pub fn psd_to_png_bytes(psd_file: &psd::Psd) -> Result<Vec<u8>, String> {
    let img = psd_to_rgba_image(psd_file)?;
    encode_image_rgba(&img, "png")
}

pub fn encode_image_rgba(img: &image::RgbaImage, format: &str) -> Result<Vec<u8>, String> {
    let mut buf = std::io::Cursor::new(Vec::new());
    let fmt = image_format(format);
    if matches!(fmt, image::ImageFormat::Jpeg) {
        let rgb = image::DynamicImage::ImageRgba8(img.clone()).to_rgb8();
        rgb.write_to(&mut buf, fmt)
            .map_err(|e| format!("JPEG encode error: {}", e))?;
    } else {
        img.write_to(&mut buf, fmt)
            .map_err(|e| format!("{} encode error: {}", format.to_uppercase(), e))?;
    }
    let bytes = buf.into_inner();
    if bytes.is_empty() {
        return Err(format!("Encoded {} output is empty", format));
    }
    Ok(bytes)
}

// ── ファイル保存 ──────────────────────────────────────────────────────────────

pub fn save_bytes(path: &str, bytes: &[u8]) -> Result<(), String> {
    if bytes.is_empty() {
        return Err(format!("Refusing to write empty content to '{}'", path));
    }
    if let Some(parent) = Path::new(path).parent() {
        if !parent.as_os_str().is_empty() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!(
                    "Failed to create directory '{}': {}", parent.display(), e
                ))?;
        }
    }
    std::fs::write(path, bytes)
        .map_err(|e| format!("Failed to write '{}': {}", path, e))
}

// ── フォーマットヘルパー ──────────────────────────────────────────────────────

pub fn image_format(s: &str) -> image::ImageFormat {
    match s.to_lowercase().as_str() {
        "jpeg" | "jpg" => image::ImageFormat::Jpeg,
        "webp"         => image::ImageFormat::WebP,
        _              => image::ImageFormat::Png,
    }
}

pub fn image_ext(s: &str) -> &str {
    match s { "jpeg" | "jpg" => "jpg", "webp" => "webp", _ => "png" }
}

// ── プロセス終了 ──────────────────────────────────────────────────────────────

pub fn exit_on(result: Result<(), String>) -> ! {
    match result {
        Ok(_)  => std::process::exit(0),
        Err(e) => { eprintln!("Error: {}", e); std::process::exit(1); }
    }
}

// ── 名前サニタイズ ────────────────────────────────────────────────────────────

pub fn sanitize_name(name: &str) -> String {
    let sanitized: String = name.chars()
        .map(|c| if c.is_alphanumeric() || c == '-' || c == '_' || c == ' ' { c } else { '_' })
        .collect::<String>()
        .trim()
        .replace(' ', "_");

    if sanitized.is_empty() {
        "unnamed_layer".to_string()
    } else {
        sanitized
    }
}

// ── Windows: エクスプローラー起動判定 ────────────────────────────────────────

#[cfg(target_os = "windows")]
pub fn is_launched_from_explorer() -> bool {
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