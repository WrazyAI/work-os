fn main() {
    // Embed source identity at build time, not from the machine running the app.
    println!("cargo:rerun-if-changed=build.rs");
    if let Ok(output) = std::process::Command::new("git")
        .args(["rev-parse", "HEAD"])
        .output()
    {
        let commit = String::from_utf8_lossy(&output.stdout).trim().to_owned();
        if output.status.success()
            && commit.len() == 40
            && commit.bytes().all(|b| b.is_ascii_hexdigit())
        {
            println!("cargo:rustc-env=WORK_OS_BUILD_COMMIT={commit}");
        }
    }
    // Worktrees store HEAD and branch refs outside the checkout. Track both so
    // incremental local builds cannot retain the previous commit's identity.
    for reference in ["HEAD", "refs/heads"] {
        if let Ok(output) = std::process::Command::new("git")
            .args(["rev-parse", "--git-path", reference])
            .output()
        {
            if output.status.success() {
                println!(
                    "cargo:rerun-if-changed={}",
                    String::from_utf8_lossy(&output.stdout).trim()
                );
            }
        }
    }
    // Commands listed here participate in capability ACL checks instead of
    // inheriting Tauri's default "all windows may invoke custom commands".
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "claim_day_monitor",
            "publish_day_monitor",
            "read_day_monitor",
            "release_day_monitor",
            "ensure_local_settings",
            "app_heartbeat",
            "arm_update_exit_watchdog",
            "disarm_update_exit_watchdog",
            "quit_app",
            "sync_app_menu",
            "notify_focus",
            "focus_main",
            "hide_avatar",
            "show_avatar",
            "open_work_os_auth",
            "worktivity_control",
            "finish_worktivity_control",
            "voice_hotkey_status",
            "set_voice_hotkey",
            "open_debug_window",
            "diagnostics_emit",
            "diagnostics_page",
            "diagnostics_export",
            "open_logs_dir",
            "open_local_vault",
            "read_local_vault",
            "write_local_vault",
            "remove_local_vault",
            "reset_local_vault",
            "get_vault_password",
            "vault_open_trouble",
        ]),
    ))
    .expect("could not build companion permissions")
}
