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
/// target window (avatar -> also emits the expand event; EOD -> opens review).
/// Other platforms keep the JS notification plugin, which handles clicks there.
#[tauri::command]
fn notify_focus(app: tauri::AppHandle, title: String, body: String, target: String) -> Result<(), String> {
    #[cfg(windows)]
    {
        let app_handle = app.clone();
        let window_target = if target == "eod" { "main".to_string() } else { target.clone() };
        tauri_winrt_notification::Toast::new("com.wrazy.workos.pilot")
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
                    sync_companion_item(&app_handle, true);
                }
                if target == "eod" {
                    let _ = app_handle.emit_to("main", "work-os://avatar-open-eod", ());
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

#[tauri::command]
fn focus_main(app: tauri::AppHandle) {
    show_main(&app);
}

/// The floating companion's tray item, held in managed state so every show/hide
/// path can keep its label truthful about the window's real visibility.
struct CompanionTrayItem(std::sync::Mutex<Option<MenuItem<tauri::Wry>>>);

/// Keeps the tray label in step with the avatar window. Collapsed-to-orb still
/// counts as visible; only a full hide reads "Show companion".
fn sync_companion_item(app: &tauri::AppHandle, visible: bool) {
    if let Some(state) = app.try_state::<CompanionTrayItem>() {
        if let Ok(guard) = state.0.lock() {
            if let Some(item) = guard.as_ref() {
                let _ = item.set_text(if visible { "Hide companion" } else { "Show companion" });
            }
        }
    }
}

/// Hides the floating companion without quitting the app. Recover it from the
/// tray's "Show companion" item.
#[tauri::command]
fn hide_avatar(app: tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("avatar") {
        let _ = window.hide();
        sync_companion_item(&app, false);
    }
}

#[tauri::command]
fn show_avatar(app: tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("avatar") {
        let _ = window.show();
        let _ = window.set_focus();
        sync_companion_item(&app, true);
    }
}

fn toggle_companion(app: &tauri::AppHandle) {
    let Some(window) = app.get_webview_window("avatar") else {
        return;
    };
    match window.is_visible() {
        Ok(true) => {
            let _ = window.hide();
            sync_companion_item(app, false);
        }
        _ => {
            let _ = window.show();
            let _ = window.set_focus();
            sync_companion_item(app, true);
        }
    }
}

/// Counter-invalidated whenever a watchdog is armed again or disarmed: at
/// most the latest armed watchdog can stay dangerous.
static EXIT_WATCHDOG_GENERATION: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

/// Guarantees the process dies once an exit has been requested. A graceful
/// shutdown can deadlock inside DLL detach (WebView2/COM teardown), leaving a
/// half-dead "Not Responding" process that then holds the executable locked
/// and blocks the installer. Once armed, a detached watchdog force-terminates
/// the process if the graceful exit has not completed after the grace window.
/// On a normal fast exit the process is gone long before the timer fires, so
/// the watchdog simply dies with it.
#[cfg(windows)]
fn arm_exit_watchdog(grace_seconds: u64) {
    use std::sync::atomic::Ordering;
    let generation = EXIT_WATCHDOG_GENERATION.fetch_add(1, Ordering::SeqCst);
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_secs(grace_seconds));
        if EXIT_WATCHDOG_GENERATION.load(Ordering::SeqCst) != generation + 1 {
            return;
        }
        // SAFETY: terminating the current process; the handle is a static
        // pseudo-handle and the call only fails if the process is already
        // exiting, which is exactly the outcome we want.
        let _ = unsafe {
            windows_sys::Win32::System::Threading::TerminateProcess(
                windows_sys::Win32::System::Threading::GetCurrentProcess(),
                0,
            )
        };
    });
}

/// Armed from the frontend a beat before the updater's Windows install step
/// (which ends in `std::process::exit(0)`), so a hung detach during that exit
/// cannot leave a zombie process holding the executable lock. Disarmed again
/// by the frontend whenever the install step rejects, so the still-running
/// application is never terminated after a failed launch.
///
/// The grace is deliberately generous: antivirus holds on the unsigned
/// installer spawn have been observed past 50s, and the NSIS hooks tolerate
/// a lingering executable (kill ladder, then rename-then-continue), so a
/// slow exit costs nothing while a short fuse kills the app mid-spawn.
#[cfg(windows)]
const UPDATE_EXIT_WATCHDOG_GRACE_SECS: u64 = 120;

#[tauri::command]
fn arm_update_exit_watchdog() {
    #[cfg(windows)]
    arm_exit_watchdog(UPDATE_EXIT_WATCHDOG_GRACE_SECS);
}

/// Cancels every currently armed exit watchdog.
#[tauri::command]
fn disarm_update_exit_watchdog() {
    use std::sync::atomic::Ordering;
    EXIT_WATCHDOG_GENERATION.fetch_add(1, Ordering::SeqCst);
}

#[cfg(not(windows))]
fn arm_exit_watchdog(_grace_seconds: u64) {}

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
            arm_update_exit_watchdog,
            disarm_update_exit_watchdog,
            notify_focus,
            focus_main,
            hide_avatar,
            show_avatar,
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
            let companion = MenuItem::with_id(app, "companion", "Hide companion", true, None::<&str>)?;
            let capture = MenuItem::with_id(app, "capture", "Quick update", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &companion, &capture, &quit])?;
            app.manage(CompanionTrayItem(std::sync::Mutex::new(Some(companion.clone()))));
            let mut tray = TrayIconBuilder::new()
                .menu(&menu)
                .tooltip("Work OS Companion");
            if let Some(icon) = app.default_window_icon() {
                tray = tray.icon(icon.clone());
            }
            tray.on_menu_event(move |app, event| match event.id.as_ref() {
                "show" => show_main(app),
                "companion" => toggle_companion(app),
                "capture" => {
                    show_main(app);
                    let _ = app.emit("work-os://capture", ());
                }
                "quit" => {
                    arm_exit_watchdog(4);
                    app.exit(0);
                }
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
                        diagnostics::host_event(&handle, "window.main.close_hidden", "Close requested; hid to tray instead of exiting", diagnostics::DiagnosticLevel::Info);
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
        .build(tauri::generate_context!())
        .expect("error while building Work OS Companion")
        .run(|_app, event| {
            // Arm the terminate watchdog when the process begins exiting so a
            // hung detach (WebView2/COM) can never outlive the exit request.
            if let tauri::RunEvent::ExitRequested { .. } = event {
                arm_exit_watchdog(4);
            }
        });
}
