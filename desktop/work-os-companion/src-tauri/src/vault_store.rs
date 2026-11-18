//! Thin async IPC boundary over the one blocking, process-owned vault worker.
use crate::{
    vault_backend::{Credentials, SnapshotBackend, VaultStoreError},
    vault_password,
};
use serde::Serialize;
use std::sync::mpsc::Receiver;
use tauri::{Manager, WebviewWindow};
use work_os_vault_runtime_core::{RuntimeError, VaultRuntime};

impl From<work_os_vault_password_core::VaultPasswordError> for VaultStoreError {
    fn from(error: work_os_vault_password_core::VaultPasswordError) -> Self {
        Self {
            code: serde_json::to_value(error.code)
                .unwrap()
                .as_str()
                .unwrap()
                .into(),
            message: error.message,
            requires_reset: error.requires_reset,
        }
    }
}
struct HostCredentials(tauri::AppHandle);
impl Credentials for HostCredentials {
    fn read(&self) -> Result<String, VaultStoreError> {
        vault_password::read_blocking(&self.0).map_err(Into::into)
    }
    fn reset(&self) -> Result<(), VaultStoreError> {
        vault_password::reset_blocking(&self.0).map_err(Into::into)
    }
}
#[derive(Serialize)]
pub struct VaultLease {
    generation: u64,
    reused: bool,
}

pub fn init(app: &tauri::AppHandle) -> Result<(), VaultStoreError> {
    let timing_app = app.clone();
    let backend = SnapshotBackend::new(
        app.path()
            .app_data_dir()
            .map_err(|_| VaultStoreError::unavailable())?
            .join(vault_password::VAULT_FILE),
        app.path()
            .app_local_data_dir()
            .map_err(|_| VaultStoreError::unavailable())?
            .join("stronghold-salt"),
        HostCredentials(app.clone()),
    )
    .with_timings(move |phase, duration| {
        crate::diagnostics::vault_timing(&timing_app, phase, "host", duration, false)
    });
    app.manage(VaultRuntime::spawn(backend).map_err(|_| VaultStoreError::unavailable())?);
    Ok(())
}
fn runtime(
    window: &WebviewWindow,
) -> Result<tauri::State<'_, VaultRuntime<VaultStoreError>>, VaultStoreError> {
    // Defense in depth in addition to build-time command ACLs. Never accept a
    // caller-supplied filesystem path or a debugger window as a store client.
    if !matches!(window.label(), "main" | "avatar") {
        return Err(VaultStoreError::unavailable());
    }
    window.try_state().ok_or_else(VaultStoreError::unavailable)
}
async fn reply<T: Send + 'static>(
    receiver: Receiver<Result<T, RuntimeError<VaultStoreError>>>,
) -> Result<T, VaultStoreError> {
    tauri::async_runtime::spawn_blocking(move || receiver.recv())
        .await
        .map_err(|_| VaultStoreError::unavailable())?
        .map_err(|_| VaultStoreError::unavailable())?
        .map_err(|error| match error {
            RuntimeError::Backend(error) => error,
            RuntimeError::StaleGeneration => VaultStoreError::stale(),
            RuntimeError::Unavailable => VaultStoreError::unavailable(),
        })
}
#[tauri::command]
pub async fn open_local_vault(window: WebviewWindow) -> Result<VaultLease, VaultStoreError> {
    let started = std::time::Instant::now();
    let lease = reply(runtime(&window)?.open()).await?;
    crate::diagnostics::vault_timing(
        window.app_handle(),
        "ready",
        window.label(),
        started.elapsed().as_millis() as u64,
        lease.reused,
    );
    Ok(VaultLease {
        generation: lease.generation,
        reused: lease.reused,
    })
}
#[tauri::command]
pub async fn read_local_vault(
    window: WebviewWindow,
    generation: u64,
    key: String,
) -> Result<Option<Vec<u8>>, VaultStoreError> {
    reply(runtime(&window)?.get(generation, key)).await
}
#[tauri::command]
pub async fn write_local_vault(
    window: WebviewWindow,
    generation: u64,
    key: String,
    value: Vec<u8>,
) -> Result<(), VaultStoreError> {
    reply(runtime(&window)?.put(generation, key, value)).await
}
#[tauri::command]
pub async fn remove_local_vault(
    window: WebviewWindow,
    generation: u64,
    key: String,
) -> Result<(), VaultStoreError> {
    reply(runtime(&window)?.remove(generation, key)).await
}
pub async fn reset(window: WebviewWindow) -> Result<(), VaultStoreError> {
    reply(runtime(&window)?.reset()).await
}
