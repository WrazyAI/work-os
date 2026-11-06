use crate::day_monitor_core::DayMonitor;
use std::{sync::Mutex, time::Instant};
use tauri::{AppHandle, Emitter, State, WebviewWindow};

pub struct DayMonitorState {
    pub monitor: Mutex<DayMonitor>,
    pub started: Instant,
}
impl Default for DayMonitorState {
    fn default() -> Self {
        Self {
            monitor: Mutex::new(DayMonitor::default()),
            started: Instant::now(),
        }
    }
}
fn allowed(window: &WebviewWindow) -> Result<&str, String> {
    match window.label() {
        "main" => Ok("main"),
        "avatar" => Ok("avatar"),
        _ => Err("This window cannot monitor the workday.".into()),
    }
}
fn valid_scope(scope: &str) -> Result<(), String> {
    if scope.len() == 64 && scope.bytes().all(|value| value.is_ascii_hexdigit()) {
        Ok(())
    } else {
        Err("Invalid workday monitor scope.".into())
    }
}

#[tauri::command]
pub fn claim_day_monitor(
    window: WebviewWindow,
    state: State<'_, DayMonitorState>,
    scope: String,
    active_page: bool,
    visible: bool,
) -> Result<bool, String> {
    let label = allowed(&window)?;
    valid_scope(&scope)?;
    let priority = if label == "main" {
        if active_page && visible {
            30
        } else {
            10
        }
    } else if visible {
        20
    } else {
        0
    };
    let mut monitor = state
        .monitor
        .lock()
        .map_err(|_| "Workday monitor unavailable.")?;
    Ok(monitor.claim(
        &scope,
        label,
        priority,
        state.started.elapsed().as_millis() as u64,
    ))
}

#[tauri::command]
pub fn publish_day_monitor(
    app: AppHandle,
    window: WebviewWindow,
    state: State<'_, DayMonitorState>,
    scope: String,
    snapshot: String,
) -> Result<bool, String> {
    let label = allowed(&window)?;
    valid_scope(&scope)?;
    if snapshot.len() > 262_144 {
        return Err("Workday status exceeds its sharing budget.".into());
    }
    let accepted = state
        .monitor
        .lock()
        .map_err(|_| "Workday monitor unavailable.")?
        .publish(
            &scope,
            label,
            &snapshot,
            state.started.elapsed().as_millis() as u64,
        );
    if accepted {
        let peer = if label == "main" { "avatar" } else { "main" };
        let _ = app.emit_to(peer, "work-os://day-monitor-changed", &scope);
    }
    Ok(accepted)
}

#[tauri::command]
pub fn read_day_monitor(
    window: WebviewWindow,
    state: State<'_, DayMonitorState>,
    scope: String,
) -> Result<Option<String>, String> {
    let label = allowed(&window)?;
    valid_scope(&scope)?;
    Ok(state
        .monitor
        .lock()
        .map_err(|_| "Workday monitor unavailable.")?
        .snapshot(&scope, label, state.started.elapsed().as_millis() as u64))
}

#[tauri::command]
pub fn release_day_monitor(
    window: WebviewWindow,
    state: State<'_, DayMonitorState>,
    scope: String,
) -> Result<(), String> {
    let label = allowed(&window)?;
    valid_scope(&scope)?;
    state
        .monitor
        .lock()
        .map_err(|_| "Workday monitor unavailable.")?
        .release(&scope, label);
    Ok(())
}
