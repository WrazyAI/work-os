//! Informational metadata generated from the running binary, never read as config.
use serde::Serialize;
use std::{
    fs, io,
    path::Path,
    sync::atomic::{AtomicU64, Ordering},
};

static NEXT_WRITE: AtomicU64 = AtomicU64::new(0);

pub const APP_INFO_FILE: &str = "app-info.json";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo<'a> {
    schema_version: u8,
    app: &'static str,
    version: &'a str,
    build: Build<'a>,
    platform: Platform<'a>,
}

#[derive(Serialize)]
struct Build<'a> {
    commit: Option<&'a str>,
    profile: &'a str,
}

#[derive(Serialize)]
struct Platform<'a> {
    os: &'a str,
    arch: &'a str,
}

impl<'a> AppInfo<'a> {
    pub fn new(
        version: &'a str,
        commit: Option<&'a str>,
        profile: &'a str,
        os: &'a str,
        arch: &'a str,
    ) -> Self {
        Self {
            schema_version: 1,
            app: "work-os-companion",
            version,
            build: Build { commit, profile },
            platform: Platform { os, arch },
        }
    }

    /// Replace stale metadata on every launch; never consult user-edited contents.
    pub fn write_to(&self, directory: &Path) -> io::Result<()> {
        fs::create_dir_all(directory)?;
        let mut bytes = serde_json::to_vec_pretty(self)?;
        bytes.push(b'\n');
        let temporary = directory.join(format!(
            "app-info.{}.{}.tmp",
            std::process::id(),
            NEXT_WRITE.fetch_add(1, Ordering::Relaxed)
        ));
        let result = fs::write(&temporary, bytes)
            .and_then(|()| fs::rename(&temporary, directory.join(APP_INFO_FILE)));
        if result.is_err() {
            let _ = fs::remove_file(temporary);
        }
        result
    }
}
