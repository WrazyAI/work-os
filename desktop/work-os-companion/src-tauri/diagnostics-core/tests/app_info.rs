use serde_json::json;
use std::fs;
use work_os_diagnostics_core::app_info::{AppInfo, APP_INFO_FILE};

#[test]
fn snapshot_reports_the_running_build_and_replaces_stale_disk_metadata() {
    let dir = std::env::temp_dir().join(format!("work-os-app-info-{}", std::process::id()));
    fs::create_dir_all(&dir).unwrap();
    fs::write(dir.join(APP_INFO_FILE), r#"{"version":"outdated"}"#).unwrap();
    let info = AppInfo::new("0.5.27", Some("abc123"), "release", "windows", "x86_64");
    info.write_to(&dir).unwrap();
    let actual: serde_json::Value =
        serde_json::from_slice(&fs::read(dir.join(APP_INFO_FILE)).unwrap()).unwrap();
    assert_eq!(
        actual,
        json!({
            "schemaVersion": 1, "app": "work-os-companion", "version": "0.5.27",
            "build": {"commit": "abc123", "profile": "release"},
            "platform": {"os": "windows", "arch": "x86_64"}
        })
    );
    assert_eq!(
        serde_json::to_value(&info).unwrap(),
        actual,
        "startup and export use the same snapshot as disk"
    );
    fs::remove_dir_all(dir).unwrap();
}

#[test]
fn unavailable_build_identity_is_explicit_and_write_errors_are_returned() {
    let info = AppInfo::new("0.5.27", None, "debug", "linux", "aarch64");
    assert_eq!(
        serde_json::to_value(&info).unwrap()["build"]["commit"],
        serde_json::Value::Null
    );
    let file = std::env::temp_dir().join(format!("work-os-app-info-file-{}", std::process::id()));
    fs::write(&file, "not a directory").unwrap();
    assert!(info.write_to(&file).is_err());
    fs::remove_file(file).unwrap();
}

#[test]
fn failed_replacement_cleans_up_temporary_metadata() {
    let dir = std::env::temp_dir().join(format!("work-os-app-info-rename-{}", std::process::id()));
    fs::create_dir_all(dir.join(APP_INFO_FILE)).unwrap();
    let info = AppInfo::new("0.5.27", None, "release", "windows", "x86_64");
    assert!(info.write_to(&dir).is_err());
    assert_eq!(
        fs::read_dir(&dir).unwrap().count(),
        1,
        "only the obstructing directory should remain"
    );
    fs::remove_dir_all(dir).unwrap();
}
