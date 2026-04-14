use tauri::{Manager, Emitter};
use tauri_plugin_cli::CliExt;

mod help;
pub mod models;
pub mod utils;
pub mod cli;
pub mod gui;

use help::*;

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

        if !is_cli && utils::is_launched_from_explorer() {
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
                    (Some(i), Some(o)) => utils::exit_on(cli::cmd_convert(i, o)),
                    _ => {
                        eprintln!("Error: Missing arguments.\n");
                        eprintln!("Usage: {} convert <INPUT> <OUTPUT>", BIN);
                        eprintln!("       {} convert --help", BIN);
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
                    Some(p) => utils::exit_on(cli::cmd_batch(p, output, format, verbose)),
                    None => {
                        eprintln!("Error: Missing glob pattern.\n");
                        eprintln!("Usage: {} batch <PATTERN> [OPTIONS]", BIN);
                        eprintln!("       {} batch --help", BIN);
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
                    Some(inp) => utils::exit_on(cli::cmd_info(inp, output, pretty)),
                    None => {
                        eprintln!("Error: Missing input file.\n");
                        eprintln!("Usage: {} info <INPUT> [OPTIONS]", BIN);
                        eprintln!("       {} info --help", BIN);
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
                    (Some(inp), Some(out)) => utils::exit_on(cli::cmd_thumbnail(inp, out, size)),
                    _ => {
                        eprintln!("Error: Missing arguments.\n");
                        eprintln!("Usage: {} thumbnail <INPUT> <OUTPUT> [OPTIONS]", BIN);
                        eprintln!("       {} thumbnail --help", BIN);
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
                    Some(inp) => utils::exit_on(cli::cmd_layers(inp, output, &show, &hide, list_only)),
                    None => {
                        eprintln!("Error: Missing input file.\n");
                        eprintln!("Usage: {} layers <INPUT> [OPTIONS]", BIN);
                        eprintln!("       {} layers --help", BIN);
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
                    Some(inp) => utils::exit_on(cli::cmd_export_layers(inp, output, format, visible_only, flatten)),
                    None => {
                        eprintln!("Error: Missing input file.\n");
                        eprintln!("Usage: {} export-layers <INPUT> [OPTIONS]", BIN);
                        eprintln!("       {} export-layers --help", BIN);
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
                    (Some(a), Some(b)) => utils::exit_on(cli::cmd_compare(a, b, output, threshold, highlight)),
                    _ => {
                        eprintln!("Error: Missing arguments.\n");
                        eprintln!("Usage: {} compare <INPUT_A> <INPUT_B> [OPTIONS]", BIN);
                        eprintln!("       {} compare --help", BIN);
                        std::process::exit(1);
                    }
                }
            }

            "sprite" => {
                if wants_help(&args[2..]) { help_sprite(); }
                let pattern = args.get(2).map(|s| s.as_str());
                let mut output = "sprite.png";
                let mut layout = cli::SpriteLayout::Horizontal;
                let mut cols = 4u32;
                let mut padding = 4u32;
                let mut format = "png";
                let mut json_out: Option<&str> = None;
                let mut i = 3;
                while i < args.len() {
                    match args[i].as_str() {
                        "-o" | "--output" => { i += 1; if let Some(v) = args.get(i) { output = v; } }
                        "--layout"        => { i += 1; if let Some(v) = args.get(i) { layout = match v.as_str() { "vertical" => cli::SpriteLayout::Vertical, "grid" => cli::SpriteLayout::Grid, _ => cli::SpriteLayout::Horizontal }; } }
                        "--cols"          => { i += 1; if let Some(v) = args.get(i) { cols = v.parse().unwrap_or(4); } }
                        "--padding"       => { i += 1; if let Some(v) = args.get(i) { padding = v.parse().unwrap_or(4); } }
                        "-f" | "--format" => { i += 1; if let Some(v) = args.get(i) { format = v; } }
                        "--json"          => { i += 1; json_out = args.get(i).map(|s| s.as_str()); }
                        _ => {}
                    }
                    i += 1;
                }
                match pattern {
                    Some(p) => utils::exit_on(cli::cmd_sprite(p, output, layout, cols, padding, format, json_out)),
                    None => {
                        eprintln!("Error: Missing glob pattern.\n");
                        eprintln!("Usage: {} sprite <PATTERN> [OPTIONS]", BIN);
                        eprintln!("       {} sprite --help", BIN);
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
                utils::exit_on(cli::cmd_watch(dir, output, format, debounce));
            }

            // PSD file path passed directly → GUI opens it
            s if s.ends_with(".psd") || s.ends_with(".PSD") => {
                // fall through to Tauri GUI
            }

            _ => {
                eprintln!("Error: Unknown command '{}'.\n", subcmd);
                eprintln!("Run '{} --help' to see available commands.", BIN);
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
        .invoke_handler(tauri::generate_handler![
            gui::greet,
            gui::get_launch_args,
            gui::parse_psd_metadata,
            gui::open_default_app_settings,
            gui::run_batch,
            gui::run_export_layers,
            gui::run_compare,
            gui::run_sprite,
        ])
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
