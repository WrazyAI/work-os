use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

use crate::diagnostics::{self, DiagnosticLevel};

pub const DEBUG_LABEL: &str = "debug";

#[tauri::command]
pub fn open_debug_window(app: AppHandle) -> Result<(), String> {
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
        Ok(_) => {
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
