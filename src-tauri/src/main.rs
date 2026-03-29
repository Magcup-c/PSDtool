// Prevents additional console window on Windows in release, DO NOT REMOVE!!
//#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // [FIX] Bug #1: main.rs で独自に Builder を組み立てていたため
    // lib.rs と二重にプラグインが登録されパニックの原因になっていた。
    // Tauri v2 の標準構成に従い lib::run() に委譲する。
    psd_tool_lib::run();
}
