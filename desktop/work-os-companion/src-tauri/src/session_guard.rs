//! Keeps at most one live companion, and reaps the ones that died without
//! exiting.
//!
//! The companion is a tray app, so it is rarely closed on purpose: a shutdown, a
//! forced kill, or a hung WebView2 teardown can leave a half-dead process
//! behind. Because the single-instance plugin hands a new launch over to the
//! existing process, every later launch then shows the splash and exits with
//! nothing on screen — which reads as a crash, and Task Manager fills up with
//! leftovers.
//!
//! The main window proves it is alive with a heartbeat. A launch that finds an
//! older heartbeat, whose process is still around, ends that process before
//! starting, so a stale instance can never strand the next launch.

use crate::diagnostics::{self, DiagnosticLevel};
use std::path::PathBuf;
use tauri::Manager;

/// A live window pings every few seconds; anything older than this means the
/// process that wrote it no longer has a working UI.
const STALE_AFTER_MS: u128 = 20_000;

fn heartbeat_path(app: &tauri::AppHandle) -> Option<PathBuf> {
    app.path().app_local_data_dir().ok().map(|dir| dir.join("instance.state"))
}

fn now_ms() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis())
        .unwrap_or(0)
}

/// The state file is deliberately trivial — one pid line and one timestamp
/// line — so this cannot fail on a parse edge or need another dependency.
fn read_state(path: &PathBuf) -> Option<(u32, u128)> {
    let text = std::fs::read_to_string(path).ok()?;
    let mut lines = text.lines();
    let pid = lines.next()?.trim().parse::<u32>().ok()?;
    let stamp = lines.next()?.trim().parse::<u128>().ok()?;
    Some((pid, stamp))
}

/// Called once at startup, before the window is created.
pub fn start(app: &tauri::AppHandle) {
    if heartbeat_path(app).is_none() {
        return;
    }
    if let Some((pid, stamp)) = heartbeat_path(app).and_then(|path| read_state(&path)) {
        let ours = pid == std::process::id();
        let fresh = stamp.saturating_add(STALE_AFTER_MS) >= now_ms();
        if !ours && !fresh && terminate_foreign_process(pid) {
            diagnostics::host_event(
                app,
                "app.launch.reaped_stale_instance",
                "Ended a companion process left behind by an earlier run; it had stopped responding and was holding the single-instance lock.",
                DiagnosticLevel::Warn,
            );
        }
    }
    write(app);
}

/// Records this instance as alive. Called at startup and then by the main
/// window's heartbeat.
pub fn write(app: &tauri::AppHandle) {
    if let Some(path) = heartbeat_path(app) {
        let _ = std::fs::write(path, format!("{}\n{}\n", std::process::id(), now_ms()));
    }
}

/// Removes the record so the next launch has nothing to clean up.
pub fn clear(app: &tauri::AppHandle) {
    if let Some(path) = heartbeat_path(app) {
        let _ = std::fs::remove_file(path);
    }
}

#[tauri::command]
pub fn app_heartbeat(app: tauri::AppHandle) {
    write(&app);
}

/// Ends a process this launch believes is a dead predecessor. Windows reuses
/// pids, so the target is confirmed by image name before anything is killed;
/// `taskkill` is used rather than the raw process APIs so no extra capability is
/// needed beyond the threading feature already in use.
#[cfg(windows)]
fn terminate_foreign_process(pid: u32) -> bool {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;

    let Ok(listing) = std::process::Command::new("tasklist")
        .args(["/FI", &format!("PID eq {pid}"), "/FO", "CSV", "/NH"])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
    else {
        return false;
    };
    let image = String::from_utf8_lossy(&listing.stdout).to_ascii_lowercase();
    if !image.contains("work-os-companion") {
        return false;
    }
    std::process::Command::new("taskkill")
        .args(["/PID", &pid.to_string(), "/F"])
        .creation_flags(CREATE_NO_WINDOW)
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
}

#[cfg(not(windows))]
fn terminate_foreign_process(_pid: u32) -> bool {
    false
}
