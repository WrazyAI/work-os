//! The macOS menu bar echoes the in-window Work OS menu.
//!
//! The companion already has one menu inside its caption bar. macOS always
//! shows a system menu bar, so leaving the framework default there would put
//! "View" and "Window" next to nothing the employee can navigate to. The
//! frontend sends its current groups (Workspace, Go, View, Help) and this
//! module rebuilds the native menu in that order, keeping the standard app and
//! edit menus around them.

use serde::Deserialize;
use tauri::menu::{AboutMetadata, CheckMenuItemBuilder, MenuBuilder, MenuItemBuilder, SubmenuBuilder};
use tauri::{AppHandle, Emitter};
#[cfg(target_os = "macos")]
use tauri::Manager;

/// Must match `NATIVE_MENU_EVENT` in `src/nativeMenuModel.ts`.
const MENU_EVENT: &str = "work-os:menu-select";

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppMenuItem {
    pub id: String,
    pub label: String,
    pub accelerator: Option<String>,
    #[serde(default)]
    pub checked: bool,
    #[serde(default = "enabled_by_default")]
    pub enabled: bool,
}

fn enabled_by_default() -> bool {
    true
}

#[derive(Debug, Clone, Deserialize)]
pub struct AppMenuGroup {
    pub label: String,
    pub items: Vec<AppMenuItem>,
}

/// Rebuilds the macOS menu bar from the groups the caption bar is showing.
/// The command is registered on every platform so the frontend has one code
/// path; it is a no-op where there is no system menu bar.
#[tauri::command]
pub fn sync_app_menu(app: AppHandle, groups: Vec<AppMenuGroup>) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let handle = app.clone();
        app.run_on_main_thread(move || {
            if let Err(error) = install(&handle, groups) {
                crate::diagnostics::host_event(
                    &handle,
                    "menu.native.sync_failed",
                    &format!("Could not build the macOS menu bar: {error}"),
                    crate::diagnostics::DiagnosticLevel::Warn,
                );
            }
        })
        .map_err(|error| error.to_string())
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (app, groups);
        Ok(())
    }
}

#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub(crate) fn install(app: &AppHandle, groups: Vec<AppMenuGroup>) -> tauri::Result<()> {
    let app_menu = SubmenuBuilder::new(app, "Work OS")
        .about(Some(AboutMetadata {
            name: Some("Work OS".into()),
            version: Some(env!("CARGO_PKG_VERSION").into()),
            ..Default::default()
        }))
        .separator()
        .hide()
        .hide_others()
        .show_all()
        .separator()
        // A predefined quit keeps the system Cmd+Q equivalent and still reaches
        // the clean-exit path through RunEvent::ExitRequested.
        .quit_with_text("Quit Work OS")
        .build()?;

    // Text fields keep the platform's editing commands even though the app
    // menu is ours.
    let edit_menu = SubmenuBuilder::new(app, "Edit")
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .build()?;

    let mut menu = MenuBuilder::new(app).item(&app_menu).item(&edit_menu);

    for group in groups {
        let mut submenu = SubmenuBuilder::new(app, &group.label);
        for item in group.items {
            if item.checked {
                let mut builder = CheckMenuItemBuilder::with_id(item.id, item.label)
                    .checked(true)
                    .enabled(item.enabled);
                if let Some(accelerator) = item.accelerator {
                    builder = builder.accelerator(accelerator);
                }
                let entry = builder.build(app)?;
                submenu = submenu.item(&entry);
            } else {
                let mut builder = MenuItemBuilder::with_id(item.id, item.label).enabled(item.enabled);
                if let Some(accelerator) = item.accelerator {
                    builder = builder.accelerator(accelerator);
                }
                let entry = builder.build(app)?;
                submenu = submenu.item(&entry);
            }
        }
        // Window commands belong beside the view commands on macOS; the
        // traffic lights keep working without them, but the menu should not
        // silently lose the standard destinations.
        if group.label == "View" {
            submenu = submenu.separator().minimize().maximize();
        }
        let built = submenu.build()?;
        menu = menu.item(&built);
    }

    let menu = menu.build()?;
    app.set_menu(menu)?;
    Ok(())
}

/// Routes native menu clicks back to the window that owns the actions.
pub fn handle_menu_event(app: &AppHandle, id: &str) {
    if id.starts_with("menu:") {
        let _ = app.emit(MENU_EVENT, id.to_string());
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_payload_the_caption_bar_sends() {
        let json = r#"[
            {"label":"Go","items":[
                {"id":"menu:1:0","label":"My Day","checked":true,"enabled":false},
                {"id":"menu:1:1","label":"Settings","accelerator":"CmdOrCtrl+,","checked":false,"enabled":true}
            ]}
        ]"#;
        let groups: Vec<AppMenuGroup> = serde_json::from_str(json).expect("menu payload should parse");
        assert_eq!(groups[0].items[1].accelerator.as_deref(), Some("CmdOrCtrl+,"));
        assert!(groups[0].items[0].checked);
        assert!(!groups[0].items[0].enabled);
    }

    #[test]
    fn defaults_an_item_to_enabled_and_unchecked() {
        let json = r#"[{"label":"Help","items":[{"id":"menu:3:0","label":"What’s new"}]}]"#;
        let groups: Vec<AppMenuGroup> = serde_json::from_str(json).expect("menu payload should parse");
        assert!(groups[0].items[0].enabled);
        assert!(!groups[0].items[0].checked);
    }
}
