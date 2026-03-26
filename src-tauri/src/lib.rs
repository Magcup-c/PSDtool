// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
use tauri::{Manager, Emitter};
use tauri_plugin_cli::CliExt;

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

fn convert_psd_to_png(input: &str, output: &str) -> Result<(), String> {
    let psd_data = std::fs::read(input).map_err(|e| format!("Failed to read file: {}", e))?;
    let psd_file = psd::Psd::from_bytes(&psd_data).map_err(|e| format!("Failed to parse PSD: {}", e))?;
    
    let width = psd_file.width();
    let height = psd_file.height();
    let rgba = psd_file.rgba();
    
    let img = image::RgbaImage::from_raw(width, height, rgba)
        .ok_or_else(|| "Failed to create image from raw bytes".to_string())?;
        
    img.save_with_format(output, image::ImageFormat::Png)
        .map_err(|e| format!("Failed to save PNG: {}", e))?;
        
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
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
            match app.cli().matches() {
                Ok(matches) => {
                    // Check subcommands
                    if let Some(sub) = matches.subcommand {
                        match sub.name.as_str() {
                            "convert" => {
                                let input = sub.matches.args.get("input").and_then(|v| v.value.as_str());
                                let output = sub.matches.args.get("output").and_then(|v| v.value.as_str());
                                if let (Some(i), Some(o)) = (input, output) {
                                    match convert_psd_to_png(i, o) {
                                        Ok(_) => {
                                            println!("Successfully converted {} to {}", i, o);
                                            std::process::exit(0);
                                        }
                                        Err(e) => {
                                            eprintln!("Conversion error: {}", e);
                                            std::process::exit(1);
                                        }
                                    }
                                }
                            }
                            "open" => {
                                let path = sub.matches.args.get("path").and_then(|v| v.value.as_str());
                                if let Some(p) = path {
                                    // We'll handle this by emitting open-file or similar
                                    let args: Vec<String> = vec!["psd-tool".to_string(), p.to_string()];
                                    let _ = app.emit("open-file", args);
                                }
                            }
                            _ => {}
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