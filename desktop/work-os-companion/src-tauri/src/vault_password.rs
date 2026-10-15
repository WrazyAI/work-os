//! Host side of the local vault password.
//!
//! The rules and the request loop live in the `work-os-vault-password-core`
//! crate; this module supplies the OS credential store, the diagnostics trail,
//! and the async commands. Two things matter here:
//!
//! - **The credential store is never touched on the app's main thread.** On
//!   macOS an in-place update changes the app's ad-hoc code signature, so the
//!   stored keychain item no longer matches the new binary and macOS raises a
//!   system password dialog that blocks the caller until it is answered. That
//!   call used to run inside a synchronous command on the main thread, so the
//!   whole app froze: every window kept its last paint — a loading screen that
//!   never resolved, a mascot that could not be dragged — while nothing
//!   responded. Requests are answered from a worker thread and awaited with
//!   `spawn_blocking`, so the UI stays live while a dialog is open.
//! - **Every window shares one worker.** Two windows reading the vault used to
//!   raise two dialogs, the second of them behind the always-on-top companion
//!   where it could never be answered.

use crate::diagnostics::{self, DiagnosticLevel};
use std::path::PathBuf;
use std::sync::mpsc::{channel, Receiver, Sender};
use tauri::Manager;
use work_os_vault_password_core::{self as vault, VaultPasswordError, VaultRequest};

pub use vault::{VAULT_FILE, VAULT_ID_FILE};

/// The real credential store: the OS keyring plus the app data directory.
struct KeyringStore {
    data_dir: PathBuf,
}

impl KeyringStore {
    fn entry(account: &str) -> Result<keyring::Entry, String> {
        keyring::Entry::new("com.wrazy.workos", account).map_err(|error| error.to_string())
    }
}

impl vault::VaultStore for KeyringStore {
    fn read(&self, account: &str) -> vault::StoreAnswer {
        match Self::entry(account) {
            Err(error) => vault::StoreAnswer::Failed(error),
            Ok(entry) => match entry.get_password() {
                Ok(password) => vault::StoreAnswer::Password(password),
                Err(keyring::Error::NoEntry) => vault::StoreAnswer::Missing,
                Err(error) => vault::StoreAnswer::Failed(error.to_string()),
            },
        }
    }

    fn write(&self, account: &str, password: &str) -> Result<(), String> {
        Self::entry(account)?
            .set_password(password)
            .map_err(|error| error.to_string())
    }

    fn delete(&self, account: &str) -> Result<(), String> {
        match Self::entry(account)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(error) => Err(error.to_string()),
        }
    }

    fn vault_exists(&self) -> bool {
        self.data_dir.join(VAULT_FILE).exists()
    }

    fn forget_vault(&self) -> Result<(), String> {
        match std::fs::remove_file(self.data_dir.join(VAULT_FILE)) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(error) => Err(error.to_string()),
        }
    }

    fn read_vault_id(&self) -> Option<String> {
        std::fs::read_to_string(self.data_dir.join(VAULT_ID_FILE))
            .ok()
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
    }

    fn write_vault_id(&self) -> Result<String, String> {
        let id = vault::random_id();
        std::fs::create_dir_all(&self.data_dir).map_err(|error| error.to_string())?;
        std::fs::write(self.data_dir.join(VAULT_ID_FILE), &id).map_err(|error| error.to_string())?;
        Ok(id)
    }
}

/// The app's handle on the vault worker.
pub struct VaultPasswordWorker {
    sender: Sender<VaultRequest>,
}

impl VaultPasswordWorker {
    async fn read(&self) -> Result<String, VaultPasswordError> {
        let (reply, receiver) = channel();
        self.sender
            .send(VaultRequest::Read { reply })
            .map_err(|_| VaultPasswordError::unavailable())?;
        await_reply(receiver).await
    }

    async fn reset(&self) -> Result<(), VaultPasswordError> {
        let (reply, receiver) = channel();
        self.sender
            .send(VaultRequest::Reset { reply })
            .map_err(|_| VaultPasswordError::unavailable())?;
        await_reply(receiver).await
    }
}

/// Waits for the worker without occupying the app's main thread.
async fn await_reply<T: Send + 'static>(
    receiver: Receiver<Result<T, VaultPasswordError>>,
) -> Result<T, VaultPasswordError> {
    tauri::async_runtime::spawn_blocking(move || receiver.recv())
        .await
        .map_err(|_| VaultPasswordError::unavailable())?
        .map_err(|_| VaultPasswordError::unavailable())?
}

/// Set when the host panicked while this device's vault was being opened.
///
/// The Stronghold plugin panics instead of returning an error when its salt or
/// vault file cannot be written or read, and a panic leaves the frontend's
/// promise unresolved forever: the gate then reports a plain timeout whose only
/// suggestion is Retry, which panics again. Recording the panic lets the gate
/// offer the one recovery that can move the device forward.
static VAULT_OPEN_PANIC: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

/// Called from the diagnostics panic hook for every host panic.
pub fn note_panic(message: &str) {
    if message.to_ascii_lowercase().contains("stronghold") {
        VAULT_OPEN_PANIC.store(true, std::sync::atomic::Ordering::Relaxed);
    }
}

/// Whether this launch has already lost a vault open to a host panic. Read by
/// the boot gate when its own attempt times out.
#[tauri::command]
pub fn vault_open_trouble() -> bool {
    VAULT_OPEN_PANIC.load(std::sync::atomic::Ordering::Relaxed)
}

/// Starts the worker. Called once from setup, after diagnostics.
pub fn init(app: &tauri::AppHandle) {
    let data_dir = match app.path().app_data_dir() {
        Ok(dir) => dir,
        Err(error) => {
            diagnostics::host_event(
                app,
                "vault.password.init_failed",
                &format!("No app data directory ({error}); local vault requests will report unavailable"),
                DiagnosticLevel::Error,
            );
            return;
        }
    };
    // The vault file and the vault id are written straight into this directory.
    if let Err(error) = vault::ensure_directories([data_dir.clone()]) {
        diagnostics::host_event(
            app,
            "vault.password.init_failed",
            &format!("Could not create the local vault directory ({error})"),
            DiagnosticLevel::Warn,
        );
    }
    let (sender, receiver) = channel();
    let handle = app.clone();
    let spawned = std::thread::Builder::new()
        .name("work-os-vault-password".into())
        .spawn(move || {
            let store = KeyringStore { data_dir };
            let notify = move |category: &str, message: &str| {
                diagnostics::host_event(&handle, category, message, DiagnosticLevel::Info);
            };
            vault::serve(&store, &notify, receiver);
        });
    match spawned {
        Ok(_) => {
            app.manage(VaultPasswordWorker { sender });
        }
        Err(error) => {
            diagnostics::host_event(
                app,
                "vault.password.init_failed",
                &format!("The vault worker thread could not start ({error})"),
                DiagnosticLevel::Error,
            );
        }
    }
}

fn worker(app: &tauri::AppHandle) -> Result<tauri::State<'_, VaultPasswordWorker>, VaultPasswordError> {
    app.try_state::<VaultPasswordWorker>()
        .ok_or_else(VaultPasswordError::unavailable)
}

/// The password for this device's vault, creating one on first run.
#[tauri::command]
pub async fn get_vault_password(app: tauri::AppHandle) -> Result<String, VaultPasswordError> {
    worker(&app)?.read().await
}

/// Starts fresh on this device: replaces the local vault and its key. Data
/// already filed with the server is untouched.
#[tauri::command]
pub async fn reset_local_vault(app: tauri::AppHandle) -> Result<(), VaultPasswordError> {
    worker(&app)?.reset().await
}
