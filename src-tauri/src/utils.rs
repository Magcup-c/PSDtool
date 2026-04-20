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

/// PSD を合成して RgbaImage を生成する。
///
/// 【設計】
/// psd クレートの flatten_layers_rgba() は内部で全レイヤーの rgba() をキャッシュするため、
/// 「レイヤー数 × PSD全体サイズ × 4 バイト」のメモリを消費する。
/// 3000×3000 PSD × 20レイヤーなら約 720MB になり、OOM でクラッシュする。
///
/// そのため自前で1レイヤーずつ Porter-Duff source-over 合成を行う。
/// 同時に保持するメモリは「出力バッファ + 1レイヤー分」= 2 × PSD全体サイズ × 4 バイトのみ。
///
/// 【layer.rgba() の正しい動作】
/// layer.rgba() は psd_width × psd_height × 4 バイトを返す（PSD全体キャンバスサイズ）。
/// ピクセルはすでに layer_left/layer_top のオフセットで配置済み。
/// psd.layers() のインデックス 0 が最下層。
pub fn psd_to_rgba_image(psd_file: &psd::Psd) -> Result<image::RgbaImage, String> {
    let width  = psd_file.width();
    let height = psd_file.height();

    if width == 0 || height == 0 {
        return Err(format!("PSD has zero dimension: {}×{}", width, height));
    }

    let pixel_count = (width * height) as usize;
    // 出力バッファ: 完全透明で初期化
    let mut canvas = vec![0u8; pixel_count * 4];

    let layers = psd_file.layers();

    if layers.is_empty() {
        // レイヤーなし → psd.rgba()（埋め込み合成済み画像）を試みる
        let raw = psd_file.rgba();
        if raw.len() == pixel_count * 4 {
            return image::RgbaImage::from_raw(width, height, raw)
                .ok_or_else(|| "Failed to create image from psd.rgba()".to_string());
        }
        // 埋め込みも無効なら透明画像を返す
        return image::RgbaImage::from_raw(width, height, canvas)
            .ok_or_else(|| "Failed to create blank image".to_string());
    }

    // index 0 = 最下層 → そのまま順番に source-over で重ねる
    for layer in layers.iter() {
        if !layer.visible() {
            continue;
        }
        if layer.opacity() == 0 {
            continue;
        }

        // layer.rgba() は psd_width × psd_height × 4 バイト
        // ピクセルはすでにキャンバス座標系に配置済み
        let layer_rgba = layer.rgba();

        if layer_rgba.len() != pixel_count * 4 {
            // サイズが合わない場合はスキップ（壊れたレイヤー）
            eprintln!(
                "Warning: layer '{}' rgba() size mismatch: {} vs {}, skipping",
                layer.name(), layer_rgba.len(), pixel_count * 4
            );
            continue;
        }

        let opacity = layer.opacity() as f32 / 255.0;

        // Porter-Duff source-over: 1ピクセルずつ合成
        // canvas = src over dst
        for i in 0..pixel_count {
            let base = i * 4;

            let sr = layer_rgba[base    ] as f32 / 255.0;
            let sg = layer_rgba[base + 1] as f32 / 255.0;
            let sb = layer_rgba[base + 2] as f32 / 255.0;
            let sa = layer_rgba[base + 3] as f32 / 255.0 * opacity;

            if sa <= 0.0 {
                continue;
            }

            let dr = canvas[base    ] as f32 / 255.0;
            let dg = canvas[base + 1] as f32 / 255.0;
            let db = canvas[base + 2] as f32 / 255.0;
            let da = canvas[base + 3] as f32 / 255.0;

            // out_a = sa + da * (1 - sa)
            let out_a = sa + da * (1.0 - sa);
            if out_a <= 0.0 {
                continue;
            }

            canvas[base    ] = ((sr * sa + dr * da * (1.0 - sa)) / out_a * 255.0).round() as u8;
            canvas[base + 1] = ((sg * sa + dg * da * (1.0 - sa)) / out_a * 255.0).round() as u8;
            canvas[base + 2] = ((sb * sa + db * da * (1.0 - sa)) / out_a * 255.0).round() as u8;
            canvas[base + 3] = (out_a * 255.0).round() as u8;
        }
    }

    image::RgbaImage::from_raw(width, height, canvas)
        .ok_or_else(|| "Failed to create RgbaImage from composited pixels".to_string())
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
                .map_err(|e| format!("Failed to create directory '{}': {}", parent.display(), e))?;
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