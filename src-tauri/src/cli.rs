use crate::utils::*;
use std::path::Path;

pub fn cmd_convert(input: &str, output: &str) -> Result<(), String> {
    let psd   = load_psd(input)?;
    let bytes = psd_to_png_bytes(&psd)?;
    save_bytes(output, &bytes)?;
    println!("✓ Converted: {} → {}", input, output);
    Ok(())
}

pub fn cmd_batch(pattern: &str, output_dir: &str, format: &str, verbose: bool) -> Result<(), String> {
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

pub fn cmd_info(input: &str, output: Option<&str>, pretty: bool) -> Result<(), String> {
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

pub fn cmd_thumbnail(input: &str, output: &str, size: u32) -> Result<(), String> {
    let psd   = load_psd(input)?;
    let img   = psd_to_rgba_image(&psd)?;
    let thumb = image::imageops::thumbnail(&img, size, size);
    let fmt   = if output.to_lowercase().ends_with(".jpg") || output.to_lowercase().ends_with(".jpeg") { "jpeg" } else { "png" };
    let bytes = encode_image_rgba(&image::RgbaImage::from(thumb), fmt)?;
    save_bytes(output, &bytes)?;
    println!("✓ Thumbnail ({}px): {} → {}", size, input, output);
    Ok(())
}

fn name_matches(name: &str, pattern: &str) -> bool {
    name.to_lowercase().contains(&pattern.to_lowercase())
}

pub fn cmd_layers(input: &str, output: &str, show: &[&str], hide: &[&str], list_only: bool) -> Result<(), String> {
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

pub fn cmd_export_layers(input: &str, output_dir: &str, format: &str, visible_only: bool, _flatten_groups: bool) -> Result<(), String> {
    let psd = load_psd(input)?;
    std::fs::create_dir_all(output_dir)
        .map_err(|e| format!("Failed to create output dir: {}", e))?;

    let ext = image_ext(format);
    let (mut count, mut skipped) = (0usize, 0usize);

    println!("Exporting layers from '{}' → '{}'\n", input, output_dir);

    for layer in psd.layers() {
        if visible_only && !layer.visible() { skipped += 1; continue; }

        let layer_name = sanitize_name(layer.name());
        let (w, h) = (layer.width() as u32, layer.height() as u32);
        if w == 0 || h == 0 {
            println!("  ⚠ skip zero-size: {}", layer.name());
            skipped += 1;
            continue;
        }

        // psd クレート 0.3.5 の rgba() はインターリーブ RGBA を返す
        let pixel_data = layer.rgba();
        let expected = (w * h * 4) as usize;

        if pixel_data.len() != expected {
            eprintln!("  ⚠ size mismatch for '{}': got {} bytes, expected {} ({}x{}x4)",
                layer.name(), pixel_data.len(), expected, w, h);
            skipped += 1;
            continue;
        }

        let img = match image::RgbaImage::from_raw(w, h, pixel_data) {
            Some(i) => i,
            None    => {
                eprintln!("  ⚠ from_raw failed for '{}'", layer.name());
                skipped += 1;
                continue;
            }
        };

        let mut out_path = Path::new(output_dir).join(format!("{}.{}", layer_name, ext));
        let mut idx = 1u32;
        while out_path.exists() {
            out_path = Path::new(output_dir).join(format!("{}_{}.{}", layer_name, idx, ext));
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

pub fn cmd_compare(input_a: &str, input_b: &str, output: &str, threshold: u8, highlight: &str) -> Result<(), String> {
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

#[derive(Clone, Copy, PartialEq)]
pub enum SpriteLayout { Horizontal, Vertical, Grid }

pub fn cmd_sprite(pattern: &str, output: &str, layout: SpriteLayout, cols: u32, padding: u32, format: &str, json_out: Option<&str>) -> Result<(), String> {
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

pub fn cmd_watch(watch_dir: &str, output_dir: &str, format: &str, debounce_ms: u64) -> Result<(), String> {
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