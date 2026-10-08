//! The installed app's own config file.
//!
//! An employee can change their check-in cadence for one machine by editing this
//! file. It is created on first run from the cadence the workspace reports for
//! them, so a fresh install starts from the deployment's policy; a local edit
//! then wins on that machine only. Values are re-validated when they are read
//! and sent, so a bad hand edit cannot storm or silence a workday.

use crate::diagnostics::{self, DiagnosticLevel};
use std::path::PathBuf;
use tauri::Manager;

const FILE_NAME: &str = "work-os.local.json";

/// Beside the vault in the app data directory, which is where an operator
/// already looks for Work OS state.
fn settings_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|dir| dir.join(FILE_NAME))
        .map_err(|error| error.to_string())
}

/// Returns the file's contents, creating it from `seed` the first time. An
/// existing file is never overwritten: the employee's own edit always wins.
#[tauri::command]
pub fn ensure_local_settings(app: tauri::AppHandle, seed: String) -> Result<String, String> {
    let path = settings_path(&app)?;
    if let Ok(existing) = std::fs::read_to_string(&path) {
        return Ok(existing);
    }
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    std::fs::write(&path, &seed).map_err(|error| error.to_string())?;
    diagnostics::host_event(
        &app,
        "settings.local.created",
        "Created the local config file from the workspace cadence",
        DiagnosticLevel::Info,
    );
    Ok(seed)
}
