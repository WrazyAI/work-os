use std::sync::Mutex;

use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

use crate::diagnostics::{self, DiagnosticLevel};
use crate::window_fit;

pub const DEBUG_LABEL: &str = "debug";

/// Async commands run concurrently on a worker thread, so two quick invokes
/// could both miss the "already open" lookup and race to build the same window
/// label, which fails the second one. Serialize the whole open path; the
/// critical section never awaits, so the guard cannot stall the runtime.
static OPEN_LOCK: Mutex<()> = Mutex::new(());

#[tauri::command]
pub async fn open_debug_window(app: AppHandle) -> Result<(), String> {
    open_debug_window_locked(app)
}

/// Kept as a synchronous helper so the open-lock guard never becomes part of
/// the command's future; `MutexGuard` is not `Send`.
fn open_debug_window_locked(app: AppHandle) -> Result<(), String> {
    let _open = OPEN_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());

    if let Some(existing) = app.get_webview_window(DEBUG_LABEL) {
        let _ = existing.show();
        let _ = existing.unminimize();
        let _ = existing.set_focus();
        diagnostics::host_event(&app, "window.debug.focused", "Debug window focused", DiagnosticLevel::Info);
        return Ok(());
    }

    let result = WebviewWindowBuilder::new(&app, DEBUG_LABEL, WebviewUrl::App("debug.html".into()))
        .title("Work OS Debugger")
        .inner_size(760.0, 860.0)
        .min_inner_size(520.0, 560.0)
        .resizable(true)
        .visible(true)
        .use_https_scheme(true)
        .build();

    match result {
        Ok(window) => {
            // The debugger's configured 860-point height also overflows a
            // 13-inch MacBook's work area, so it gets the same fit. This
            // command is async, so it runs on a worker thread, while the
            // fit's monitor read reaches NSScreen::screens on macOS, which is
            // main-thread only; queue the fit back onto the main thread.
            let fit_window = window.clone();
            let fit_app = app.clone();
            if let Err(error) = app.run_on_main_thread(move || {
                window_fit::fit_to_work_area(&fit_window, &fit_app);
            }) {
                diagnostics::host_event(
                    &app,
                    "window.debug.fit",
                    &format!("Debug window fit not scheduled: {error}"),
                    DiagnosticLevel::Warn,
                );
            }
            diagnostics::host_event(&app, "window.debug.created", "Debug window created", DiagnosticLevel::Info);
            Ok(())
        }
        Err(error) => {
            let message = error.to_string();
            diagnostics::host_event(
                &app,
                "window.debug.failed",
                &format!("Debug window failed: {message}"),
                DiagnosticLevel::Error,
            );
            let _ = app.emit("work-os://debug-window-failed", message.clone());
            Err(message)
        }
    }
}
