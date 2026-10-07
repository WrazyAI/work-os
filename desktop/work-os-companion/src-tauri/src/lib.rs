mod debug_window;
mod diagnostics;
mod session_guard;

use base64::Engine;
use rand::RngCore;
use tauri::menu::{Menu, MenuItem};
use tauri::path::BaseDirectory;
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
        || parsed.host_str().is_none()
        || parsed.path() != "/work-os/desktop/connect"
    {
        return Err("Only an HTTPS Work OS authorization URL can be opened.".into());
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
/// target window (avatar -> also emits the expand event; EOD -> opens review;
/// memory -> opens the memory review modal). Other platforms keep the JS
/// notification plugin, which handles clicks there.
#[tauri::command]
fn notify_focus(app: tauri::AppHandle, title: String, body: String, target: String) -> Result<(), String> {
    #[cfg(windows)]
    {
        let app_handle = app.clone();
        let window_target = if target == "eod" || target == "memory" { "main".to_string() } else { target.clone() };
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
                if target == "memory" {
                    let _ = app_handle.emit_to("main", "work-os://open-memory", ());
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

static WORKTIVITY_CONTROL_MUTEX: std::sync::Mutex<()> = std::sync::Mutex::new(());

/// Performs a user-requested Worktivity desktop action. The provider API
/// preflights and verifies the resulting attendance state; this local command
/// only controls the installed Worktivity UI through its loopback CDP target.
#[tauri::command]
async fn worktivity_control(app: tauri::AppHandle, action: String) -> serde_json::Value {
    if action != "finish" && !["clock_in", "clock_out", "pause", "resume"].contains(&action.as_str()) {
        return serde_json::json!({ "status": "error", "message": "Invalid Worktivity clock action." });
    }
    #[cfg(windows)]
    {
        let script = match app.path().resolve(
            "resources/worktivity-controller.ps1",
            BaseDirectory::Resource,
        ) {
            Ok(path) => path,
            Err(error) => {
                return serde_json::json!({ "status": "error", "message": format!("Worktivity controller resource is unavailable: {error}") })
            }
        };
        let run = tauri::async_runtime::spawn_blocking(move || {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x08000000;
            let _guard = WORKTIVITY_CONTROL_MUTEX
                .lock()
                .map_err(|_| "Worktivity control is already running.".to_string())?;
            let output = std::process::Command::new("powershell.exe")
                .arg("-NoProfile")
                .arg("-NonInteractive")
                .arg("-ExecutionPolicy")
                .arg("Bypass")
                .arg("-File")
                .arg(&script)
                .arg("-Action")
                .arg(&action)
                .creation_flags(CREATE_NO_WINDOW)
                .output()
                .map_err(|error| format!("Could not start the Worktivity controller: {error}"))?;
            if !output.status.success() {
                return Err("The Worktivity controller did not complete.".to_string());
            }
            serde_json::from_slice::<serde_json::Value>(&output.stdout)
                .map_err(|_| "The Worktivity controller returned an invalid result.".to_string())
        });
        return match run.await {
            Ok(Ok(result)) => result,
            Ok(Err(message)) => serde_json::json!({ "status": "error", "message": message }),
            Err(error) => {
                serde_json::json!({ "status": "error", "message": format!("Worktivity control failed: {error}") })
            }
        };
    }
    #[cfg(not(windows))]
    {
        let _ = (app, action);
        serde_json::json!({ "status": "not_supported", "message": "Worktivity clock controls are available from the Windows Companion." })
    }
}

#[tauri::command]
async fn finish_worktivity_control(app: tauri::AppHandle) -> Result<(), String> {
    #[cfg(windows)]
    {
        let result = worktivity_control(app, "finish".to_string()).await;
        if result.get("status").and_then(serde_json::Value::as_str) == Some("restored") {
            Ok(())
        } else {
            Err(result.get("message").and_then(serde_json::Value::as_str)
                .unwrap_or("Worktivity could not close its temporary local control connection.").to_string())
        }
    }
    #[cfg(not(windows))]
    {
        let _ = app;
        Ok(())
    }
}

#[cfg(not(windows))]
fn arm_exit_watchdog(_grace_seconds: u64) {}

/* ── Voice input: hold-to-talk ─────────────────────────────────────────────
 *
 * Ctrl + M is registered as a real global shortcut so the hold reaches the
 * companion from any application, and so the *release* ends the capture. The
 * frontend only ever receives start/stop/cancel; it owns the microphone, the
 * recording cap, and the transcription request.
 */

/// The route a press is bound to, remembered so the release cannot land on a
/// different window than the one the press opened.
struct VoiceHotkeyRoute(std::sync::Mutex<Option<&'static str>>);

/// Truthful registration state, so Settings never shows a switch that claims
/// the shortcut is live when Windows (or another app) refused it.
#[derive(serde::Serialize)]
struct VoiceHotkeyStatus {
    enabled: bool,
    shortcut: String,
    error: Option<String>,
}

struct VoiceHotkey(std::sync::Mutex<VoiceHotkeyStatus>);

const VOICE_SHORTCUT_LABEL: &str = "Ctrl + M";

/// Addressed payload for every voice event.
///
/// `emit_to` alone is not enough to reach one window: a webview listener
/// registered without an explicit target is stored as `EventTarget::Any`, and
/// Tauri's own filter short-circuits on that (`match_any_or_filter`), so every
/// window receives every targeted emit. Each window therefore checks the
/// address before acting.
fn voice_event(target: &str) -> serde_json::Value {
    serde_json::json!({ "target": target })
}

fn voice_shortcut() -> tauri_plugin_global_shortcut::Shortcut {
    use tauri_plugin_global_shortcut::{Code, Modifiers, Shortcut};
    Shortcut::new(Some(Modifiers::CONTROL), Code::KeyM)
}

/// The window the employee is actually looking at owns the capture.
///
/// Focus, not visibility: the floating companion is on screen almost always
/// (collapsed-to-orb still counts as visible), so a visibility test hands it
/// every hold — including the ones made while the employee is working in the
/// app — and steals focus from the window they were typing in. Only the
/// focused window is chosen; when the app is in the background the hold goes
/// to the small floating companion instead.
fn voice_target(app: &tauri::AppHandle) -> &'static str {
    let main_focused = app
        .get_webview_window("main")
        .and_then(|window| window.is_focused().ok())
        .unwrap_or(false);
    if main_focused {
        "main"
    } else {
        "avatar"
    }
}

/// Brings the capture surface forward without disturbing the other one. The
/// floating companion is shown and focused; the main window is deliberately
/// left alone — it already holds focus when it is the target, and raising it
/// on a background press is exactly the interruption this routing avoids.
fn focus_voice_target(app: &tauri::AppHandle, target: &str) {
    if target == "avatar" {
        show_avatar(app.clone());
    }
}

fn set_voice_shortcut(app: &tauri::AppHandle, enabled: bool) -> VoiceHotkeyStatus {
    use tauri_plugin_global_shortcut::GlobalShortcutExt;
    let manager = app.global_shortcut();
    let shortcut = voice_shortcut();
    let mut status = VoiceHotkeyStatus {
        enabled,
        shortcut: VOICE_SHORTCUT_LABEL.to_string(),
        error: None,
    };
    let result = if enabled {
        if manager.is_registered(shortcut.clone()) {
            Ok(())
        } else {
            manager.register(shortcut)
        }
    } else {
        manager.unregister(shortcut)
    };
    if let Err(_error) = result {
        status.enabled = false;
        status.error = Some(
            "Hold-to-talk is unavailable — another application may already own Ctrl + M.".to_string(),
        );
    }
    status
}

#[tauri::command]
fn voice_hotkey_status(app: tauri::AppHandle) -> VoiceHotkeyStatus {
    let state = app.state::<VoiceHotkey>();
    // The guard must be a local: a temporary in the match scrutinee would be
    // dropped after `state`, and rustc rejects the borrow outliving it (E0597).
    let locked = state.0.lock();
    match locked {
        Ok(status) => VoiceHotkeyStatus {
            enabled: status.enabled,
            shortcut: status.shortcut.clone(),
            error: status.error.clone(),
        },
        Err(_) => VoiceHotkeyStatus {
            enabled: false,
            shortcut: VOICE_SHORTCUT_LABEL.to_string(),
            error: Some("Hold-to-talk state is unavailable.".to_string()),
        },
    }
}

#[tauri::command]
fn set_voice_hotkey(app: tauri::AppHandle, enabled: bool) -> VoiceHotkeyStatus {
    let status = set_voice_shortcut(&app, enabled);
    if let Some(state) = app.try_state::<VoiceHotkey>() {
        if let Ok(mut current) = state.0.lock() {
            *current = VoiceHotkeyStatus {
                enabled: status.enabled,
                shortcut: status.shortcut.clone(),
                error: status.error.clone(),
            };
        }
    }
    status
}

/// WebView2 answers media-capture permission requests through
/// `PermissionRequested`, and with no handler registered the request is
/// denied outright — WebView2 has no permission UI of its own — so
/// `getUserMedia` rejects with NotAllowedError even when Windows already lets
/// the app record. Answer the microphone request for the app's own origin
/// only; the OS privacy setting still applies on top.
#[cfg(windows)]
fn allow_microphone_capture(window: &tauri::WebviewWindow) {
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        COREWEBVIEW2_PERMISSION_KIND_MICROPHONE, COREWEBVIEW2_PERMISSION_STATE_ALLOW,
    };
    use webview2_com::PermissionRequestedEventHandler;
    let _ = window.with_webview(|webview| unsafe {
        let Ok(core) = webview.controller().CoreWebView2() else {
            return;
        };
        let handler = PermissionRequestedEventHandler::create(Box::new(|_, args| {
            let Some(args) = args else { return Ok(()) };
            let mut kind = Default::default();
            args.PermissionKind(&mut kind)?;
            if kind != COREWEBVIEW2_PERMISSION_KIND_MICROPHONE {
                return Ok(());
            }
            let mut uri = Default::default();
            args.Uri(&mut uri)?;
            let origin = webview2_com::take_pwstr(uri);
            if !origin.starts_with("tauri://localhost")
                && !origin.starts_with("https://tauri.localhost")
                && !origin.starts_with("http://tauri.localhost")
            {
                return Ok(());
            }
            args.SetState(COREWEBVIEW2_PERMISSION_STATE_ALLOW)?;
            Ok(())
        }));
        let mut token = 0;
        let _ = core.add_PermissionRequested(&handler, &mut token);
    });
}

#[cfg(not(windows))]
fn allow_microphone_capture(_window: &tauri::WebviewWindow) {}

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
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    use tauri_plugin_global_shortcut::ShortcutState;
                    if shortcut != &voice_shortcut() {
                        return;
                    }
                    let route = app.state::<VoiceHotkeyRoute>();
                    match event.state() {
                        ShortcutState::Pressed => {
                            let target = voice_target(app);
                            if let Ok(mut current) = route.0.lock() {
                                *current = Some(target);
                            }
                            /* One capture at a time: the hold owns it, so the
                               other window gives up whatever it was doing
                               before this one starts. A press can therefore
                               never leave two recorders live. */
                            let other = if target == "avatar" { "main" } else { "avatar" };
                            let _ = app.emit_to(other, "work-os://voice/cancel", voice_event(other));
                            focus_voice_target(app, target);
                            diagnostics::host_event(
                                app,
                                "voice.hotkey",
                                &format!("Hold-to-talk start routed to the {target} window"),
                                diagnostics::DiagnosticLevel::Info,
                            );
                            let _ = app.emit_to(target, "work-os://voice/start", voice_event(target));
                        }
                        ShortcutState::Released => {
                            let target = route.0.lock().ok().and_then(|mut current| current.take());
                            match target {
                                Some(target) => {
                                    let _ = app.emit_to(target, "work-os://voice/stop", voice_event(target));
                                }
                                /* No press was recorded to bind this release
                                   to, so stop both: a capture must never
                                   outlive the hold that opened it. */
                                None => {
                                    let _ = app.emit_to("main", "work-os://voice/stop", voice_event("main"));
                                    let _ = app.emit_to("avatar", "work-os://voice/stop", voice_event("avatar"));
                                }
                            }
                        }
                    }
                })
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            get_vault_password,
            session_guard::app_heartbeat,
            arm_update_exit_watchdog,
            disarm_update_exit_watchdog,
            notify_focus,
            focus_main,
            hide_avatar,
            show_avatar,
            open_work_os_auth,
            worktivity_control,
            finish_worktivity_control,
            voice_hotkey_status,
            set_voice_hotkey,
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
            // Reap a predecessor that died without exiting — a tray app left
            // behind by a shutdown or a hung teardown would otherwise swallow
            // every later launch through the single-instance handoff — then
            // record this instance as alive.
            session_guard::start(app.handle());
            #[cfg(any(target_os = "linux", windows))]
            app.deep_link().register_all()?;

            // Voice input: answer WebView2's microphone permission request for
            // both windows, then arm the hold-to-talk shortcut. The frontend
            // corrects the registration from the stored preference on boot.
            for label in ["main", "avatar"] {
                if let Some(window) = app.get_webview_window(label) {
                    allow_microphone_capture(&window);
                }
            }
            let hotkey = set_voice_shortcut(app.handle(), true);
            app.manage(VoiceHotkeyRoute(std::sync::Mutex::new(None)));
            app.manage(VoiceHotkey(std::sync::Mutex::new(hotkey)));

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
        .run(|app, event| {
            match event {
                #[cfg(target_os = "macos")]
                tauri::RunEvent::Reopen { .. } => show_main(app),
                // Arm the terminate watchdog when the process begins exiting so
                // a hung detach (WebView2/COM) can never outlive the exit
                // request.
                tauri::RunEvent::ExitRequested { .. } => arm_exit_watchdog(4),
                // A clean exit leaves nothing for the next launch to reap.
                tauri::RunEvent::Exit => session_guard::clear(app),
                _ => {}
            }
        });
}

#[cfg(test)]
mod tests {
    use super::allowed_desktop_connect_url;

    #[test]
    fn allows_an_https_workspace_host() {
        let result = allowed_desktop_connect_url(
            "https://srv1726015.tailbf7608.ts.net/work-os/desktop/connect?state=test",
        );
        assert!(result.is_ok());
    }

    #[test]
    fn rejects_non_https_workspace_urls() {
        let result = allowed_desktop_connect_url(
            "http://srv1726015.tailbf7608.ts.net/work-os/desktop/connect?state=test",
        );
        assert!(result.is_err());
    }
}
