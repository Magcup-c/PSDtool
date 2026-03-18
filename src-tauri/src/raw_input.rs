use serde::Serialize;
use std::sync::OnceLock;

#[cfg(target_os = "windows")]
mod windows_raw_input {
    use super::*;
    use std::mem::size_of;
    use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, WPARAM};
    use windows::Win32::UI::Input::KeyboardAndMouse::{GetKeyState, VK_CONTROL, VK_MENU, VK_SHIFT, VK_LWIN, VK_RWIN};
    use windows::Win32::UI::Input::RawInput::{
        GetRawInputData, RegisterRawInputDevices, HRAWINPUT, RAWINPUT, RAWINPUTDEVICE,
        RAWINPUTHEADER, RIDEV_INPUTSINK, RID_INPUT, RIM_TYPEMOUSE, RI_MOUSE_HWHEEL,
        RI_MOUSE_WHEEL,
    };
    use windows::Win32::UI::Controls::{DefSubclassProc, SetWindowSubclass};
    use windows::Win32::UI::WindowsAndMessaging::WM_INPUT;

    use tauri::platform::windows::WindowExtWindows;

    static APP_HANDLE: OnceLock<tauri::AppHandle> = OnceLock::new();
    static WINDOW_LABEL: OnceLock<String> = OnceLock::new();

    #[derive(Serialize, Clone)]
    struct RawWheelPayload {
        dx: i32,
        dy: i32,
        ctrl: bool,
        shift: bool,
        alt: bool,
        meta: bool,
    }

    fn is_key_down(vk: i32) -> bool {
        unsafe { (GetKeyState(vk) as u16 & 0x8000) != 0 }
    }

    unsafe fn emit_wheel(dx: i32, dy: i32) {
        if dx == 0 && dy == 0 {
            return;
        }
        let ctrl = is_key_down(VK_CONTROL.0);
        let shift = is_key_down(VK_SHIFT.0);
        let alt = is_key_down(VK_MENU.0);
        let meta = is_key_down(VK_LWIN.0) || is_key_down(VK_RWIN.0);

        let payload = RawWheelPayload {
            dx,
            dy,
            ctrl,
            shift,
            alt,
            meta,
        };

        if let (Some(app), Some(label)) = (APP_HANDLE.get(), WINDOW_LABEL.get()) {
            if let Some(window) = app.get_webview_window(label) {
                let _ = window.emit("raw-wheel", payload);
            }
        }
    }

    unsafe extern "system" fn subclass_proc(
        hwnd: HWND,
        msg: u32,
        wparam: WPARAM,
        lparam: LPARAM,
        _uid: usize,
        _ref: usize,
    ) -> LRESULT {
        if msg == WM_INPUT {
            let hraw: HRAWINPUT = HRAWINPUT(lparam.0);
            let mut size: u32 = 0;
            let header_size = size_of::<RAWINPUTHEADER>() as u32;
            let _ = GetRawInputData(hraw, RID_INPUT, None, &mut size, header_size);
            if size > 0 {
                let mut buffer = vec![0u8; size as usize];
                let _ = GetRawInputData(
                    hraw,
                    RID_INPUT,
                    Some(buffer.as_mut_ptr() as *mut _),
                    &mut size,
                    header_size,
                );
                if size >= size_of::<RAWINPUT>() as u32 {
                    let raw = *(buffer.as_ptr() as *const RAWINPUT);
                    if raw.header.dwType == RIM_TYPEMOUSE {
                        let flags = raw.data.mouse.usButtonFlags;
                        if (flags & RI_MOUSE_WHEEL as u16) != 0 {
                            let delta = raw.data.mouse.usButtonData as i16 as i32;
                            emit_wheel(0, delta);
                        }
                        if (flags & RI_MOUSE_HWHEEL as u16) != 0 {
                            let delta = raw.data.mouse.usButtonData as i16 as i32;
                            emit_wheel(delta, 0);
                        }
                    }
                }
            }
        }
        DefSubclassProc(hwnd, msg, wparam, lparam)
    }

    pub fn install(window: &tauri::WebviewWindow, app: &tauri::AppHandle) -> tauri::Result<()> {
        let Ok(hwnd) = window.hwnd() else {
            return Ok(());
        };
        let _ = APP_HANDLE.set(app.clone());
        let _ = WINDOW_LABEL.set(window.label().to_string());

        unsafe {
            let rid = RAWINPUTDEVICE {
                usUsagePage: 0x01,
                usUsage: 0x02,
                dwFlags: RIDEV_INPUTSINK,
                hwndTarget: hwnd,
            };
            let _ = RegisterRawInputDevices(
                &[rid],
                size_of::<RAWINPUTDEVICE>() as u32,
            );

            let _ = SetWindowSubclass(hwnd, Some(subclass_proc), 1, 0);
        }
        Ok(())
    }
}

#[cfg(target_os = "windows")]
pub fn install(window: &tauri::WebviewWindow, app: &tauri::AppHandle) -> tauri::Result<()> {
    windows_raw_input::install(window, app)
}

#[cfg(not(target_os = "windows"))]
pub fn install(_window: &tauri::WebviewWindow, _app: &tauri::AppHandle) -> tauri::Result<()> {
    Ok(())
}
