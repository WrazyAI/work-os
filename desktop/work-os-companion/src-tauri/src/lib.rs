mod debug_window;
mod diagnostics;

use base64::Engine;
use rand::RngCore;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{Emitter, Manager};
#[cfg(any(target_os = "linux", windows))]
use tauri_plugin_deep_link::DeepLinkExt;
use tauri_plugin_opener::OpenerExt;

// Zig's MinGW libc omits this symbol, while Stronghold's libsodium build uses it.
#[cfg(all(target_os = "windows", target_env = "gnu"))]
#[no_mangle]
pub unsafe extern "C" fn memset_explicit(
    destination: *mut core::ffi::c_void,
    value: core::ffi::c_int,
    count: usize,
) -> *mut core::ffi::c_void {
    let bytes = destination.cast::<u8>();
    for index in 0..count {
        bytes.add(index).write_volatile(value as u8);
    }
    core::sync::atomic::compiler_fence(core::sync::atomic::Ordering::SeqCst);
    destination
}

#[tauri::command]
fn get_vault_password() -> Result<String, String> {
    let entry = keyring::Entry::new("com.wrazy.workos", "stronghold-vault")
        .map_err(|error| error.to_string())?;
    match entry.get_password() {
        Ok(password) => Ok(password),
        Err(keyring::Error::NoEntry) => {
            let mut value = [0_u8; 32];
            rand::rng().fill_bytes(&mut value);
            let password = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(value);
            entry
                .set_password(&password)
                .map_err(|error| error.to_string())?;
            Ok(password)
        }
        Err(error) => Err(error.to_string()),
    }
}

fn allowed_desktop_connect_url(url: &str) -> Result<tauri::Url, String> {
    let parsed = tauri::Url::parse(url).map_err(|error| error.to_string())?;
    if parsed.scheme() != "https"
        || parsed.host_str() != Some("app.wrazyos.com")
        || parsed.path() != "/work-os/desktop/connect"
    {
        return Err("Only the WrazyOS desktop authorization URL can be opened.".into());
    }
    Ok(parsed)
}

#[cfg(windows)]
fn open_https_url_windows(url: &str) -> Result<(), String> {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x08000000;
    // Pass the URL through an env var so cmd/PowerShell cannot split on `&` in the query string.
    let status = std::process::Command::new("powershell.exe")
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            "Start-Process -FilePath $env:WORK_OS_AUTH_URL",
        ])
        .env("WORK_OS_AUTH_URL", url)
        .creation_flags(CREATE_NO_WINDOW)
        .status()
        .map_err(|error| error.to_string())?;
    if status.success() {
        Ok(())
    } else {
        Err(format!("browser launch exited with {status}"))
    }
}


/// Windows toast with click-to-focus: activating the notification focuses the
/// target window (avatar -> also emits the expand event; main -> show+focus).
/// Other platforms keep the JS notification plugin, which handles clicks there.
#[tauri::command]
fn notify_focus(app: tauri::AppHandle, title: String, body: String, target: String) -> Result<(), String> {
    #[cfg(windows)]
    {
        let app_handle = app.clone();
        let window_target = target.clone();
        tauri_winrt_notification::Toast::new()
            .title(&title)
            .text1(&body)
            .on_activated(move || {
                if let Some(window) = app_handle.get_webview_window(&window_target) {
                    let _ = window.unminimize();
                    let _ = window.show();
                    let _ = window.set_focus();
                }
                if window_target == "avatar" {
                    let _ = app_handle.emit_to("avatar", "avatar://expand", ());
                }
                Ok(())
            })
            .show()
            .map_err(|error| error.to_string())
    }
    #[cfg(not(windows))]
    {
        let _ = (app, title, body, target);
        Err("click-to-focus notifications are only implemented for Windows".into())
    }
}
#[tauri::command]
fn open_work_os_auth(app: tauri::AppHandle, url: String) -> Result<(), String> {
    let parsed = allowed_desktop_connect_url(&url)?;
    let href = parsed.as_str();
    if app.opener().open_url(href, None::<&str>).is_ok() {
        return Ok(());
    }
    #[cfg(windows)]
    {
        return open_https_url_windows(href);
    }
    #[cfg(not(windows))]
    {
        app.opener()
            .open_url(href, None::<&str>)
            .map_err(|error| error.to_string())
    }
}

fn show_main(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, args, _| {
            show_main(app);
            if args.iter().any(|arg| arg.starts_with("wrazy-workos://")) {
                let _ = app.emit("work-os://deep-link-instance", args);
            }
        }))
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .invoke_handler(tauri::generate_handler![
            get_vault_password,
            notify_focus,
            open_work_os_auth,
            debug_window::open_debug_window,
            diagnostics::diagnostics_emit,
            diagnostics::diagnostics_snapshot,
            diagnostics::diagnostics_export,
            diagnostics::open_logs_dir
        ])
        .setup(|app| {
            let salt_path = app.path().app_local_data_dir()?.join("stronghold-salt");
            app.handle()
                .plugin(tauri_plugin_stronghold::Builder::with_argon2(&salt_path).build())?;
            diagnostics::init(app.handle())
                .map_err(|error| Box::<dyn std::error::Error>::from(error))?;
            #[cfg(any(target_os = "linux", windows))]
            app.deep_link().register_all()?;

            let show = MenuItem::with_id(app, "show", "Open My Day", true, None::<&str>)?;
            let capture = MenuItem::with_id(app, "capture", "Quick update", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &capture, &quit])?;
            let mut tray = TrayIconBuilder::new()
                .menu(&menu)
                .tooltip("Work OS Companion");
            if let Some(icon) = app.default_window_icon() {
                tray = tray.icon(icon.clone());
            }
            tray.on_menu_event(|app, event| match event.id.as_ref() {
                "show" => show_main(app),
                "capture" => {
                    show_main(app);
                    let _ = app.emit("work-os://capture", ());
                }
                "quit" => app.exit(0),
                _ => {}
            })
            .on_tray_icon_event(|tray, event| {
                if let TrayIconEvent::Click {
                    button: MouseButton::Left,
                    button_state: MouseButtonState::Up,
                    ..
                } = event
                {
                    show_main(tray.app_handle());
                }
            })
            .build(app)?;

            if let Some(window) = app.get_webview_window("main") {
                let handle = app.handle().clone();
                window.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        if let Some(window) = handle.get_webview_window("main") {
                            let _ = window.hide();
                        }
                    }
                });
                diagnostics::host_event(app.handle(), "window.main.ready", "Main window ready", diagnostics::DiagnosticLevel::Info);
            } else {
                diagnostics::host_event(app.handle(), "window.main.missing", "Main window was not created", diagnostics::DiagnosticLevel::Error);
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Work OS Companion");
}
