//! Snapshot adapter shared by the host and native compatibility tests.
//! It uses the upstream plugin's *same* KDF and snapshot implementation.
use serde::Serialize;
use std::path::PathBuf;
use std::time::Instant;
use tauri_plugin_stronghold::{kdf::KeyDerivation, stronghold::Stronghold};
use work_os_vault_runtime_core::VaultBackend;
use zeroize::Zeroizing;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultStoreError {
    pub code: String,
    pub message: String,
    pub requires_reset: bool,
}
impl VaultStoreError {
    pub fn unavailable() -> Self {
        Self::new(
            "unavailable",
            "The local vault request could not run. Try again in a moment.",
        )
    }
    pub fn storage() -> Self {
        Self::new(
            "storage_failed",
            "This device's local data could not be read or saved. Try again.",
        )
    }
    pub fn stale() -> Self {
        Self::new(
            "stale_generation",
            "This device's local data changed. Try the action again.",
        )
    }
    fn new(code: &str, message: &str) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
            requires_reset: false,
        }
    }
}

pub trait Credentials: Send + 'static {
    fn read(&self) -> Result<String, VaultStoreError>;
    fn reset(&self) -> Result<(), VaultStoreError>;
}

pub struct SnapshotBackend<C> {
    path: PathBuf,
    salt_path: PathBuf,
    credentials: C,
    stronghold: Option<Stronghold>,
    timing: Box<dyn Fn(&'static str, u64) + Send>,
}
impl<C: Credentials> SnapshotBackend<C> {
    pub fn new(path: PathBuf, salt_path: PathBuf, credentials: C) -> Self {
        Self {
            path,
            salt_path,
            credentials,
            stronghold: None,
            timing: Box::new(|_, _| {}),
        }
    }
    pub fn with_timings(mut self, timing: impl Fn(&'static str, u64) + Send + 'static) -> Self {
        self.timing = Box::new(timing);
        self
    }
    fn store(&self) -> Result<&Stronghold, VaultStoreError> {
        self.stronghold
            .as_ref()
            .ok_or_else(VaultStoreError::unavailable)
    }
}

fn snapshot_error(error: impl std::fmt::Display) -> VaultStoreError {
    // Preserve only the confirmed decryption verdict consumed by the existing
    // recovery gate, never an arbitrary native error/path in a UI or log.
    if error
        .to_string()
        .split(|c: char| !c.is_alphanumeric())
        .any(|part| part == "BadFileKey")
    {
        VaultStoreError {
            code: "bad_file_key".into(),
            message: "BadFileKey: the available key could not decrypt this device's saved data."
                .into(),
            requires_reset: true,
        }
    } else {
        VaultStoreError::storage()
    }
}
impl<C: Credentials> VaultBackend for SnapshotBackend<C> {
    type Error = VaultStoreError;
    fn open(&mut self) -> Result<(), Self::Error> {
        // Never reuse a partially initialized or unsuccessfully saved instance.
        self.stronghold = None;
        let started = Instant::now();
        let password = Zeroizing::new(self.credentials.read()?);
        (self.timing)("key", started.elapsed().as_millis() as u64);
        // Upstream KDF panics on a malformed salt. Preserve the file and return
        // a recoverable error instead; never rotate a salt for an existing vault.
        if self.salt_path.exists()
            && std::fs::metadata(&self.salt_path)
                .map_err(|_| VaultStoreError::storage())?
                .len()
                != 32
        {
            return Err(VaultStoreError::storage());
        }
        let started = Instant::now();
        let hash = KeyDerivation::argon2(&password, &self.salt_path);
        drop(password);
        (self.timing)("derive", started.elapsed().as_millis() as u64);
        let started = Instant::now();
        let stronghold = Stronghold::new(&self.path, hash).map_err(snapshot_error)?;
        (self.timing)("snapshot", started.elapsed().as_millis() as u64);
        let started = Instant::now();
        match stronghold.load_client("work-os") {
            Ok(_) => {}
            Err(error)
                if !self.path.exists()
                    && error.to_string() == "error loading client data; no data present" =>
            {
                stronghold
                    .create_client("work-os")
                    .map_err(|_| VaultStoreError::storage())?;
            }
            Err(_) => return Err(VaultStoreError::storage()),
        }
        (self.timing)("client", started.elapsed().as_millis() as u64);
        self.stronghold = Some(stronghold);
        Ok(())
    }
    fn get(&mut self, key: &str) -> Result<Option<Vec<u8>>, Self::Error> {
        self.store()?
            .get_client("work-os")
            .map_err(|_| VaultStoreError::storage())?
            .store()
            .get(key.as_bytes())
            .map_err(|_| VaultStoreError::storage())
    }
    fn put(&mut self, key: &str, value: Vec<u8>) -> Result<(), Self::Error> {
        let store = self.store()?;
        store
            .get_client("work-os")
            .map_err(|_| VaultStoreError::storage())?
            .store()
            .insert(key.as_bytes().to_vec(), value, None)
            .map_err(|_| VaultStoreError::storage())?;
        store.save().map_err(|_| VaultStoreError::storage())
    }
    fn remove(&mut self, key: &str) -> Result<(), Self::Error> {
        let store = self.store()?;
        store
            .get_client("work-os")
            .map_err(|_| VaultStoreError::storage())?
            .store()
            .delete(key.as_bytes())
            .map_err(|_| VaultStoreError::storage())?;
        store.save().map_err(|_| VaultStoreError::storage())
    }
    fn reset(&mut self) -> Result<(), Self::Error> {
        // Stronghold has no commit-on-drop. Do not persist discarded state.
        self.stronghold = None;
        self.credentials.reset()
    }
}

#[cfg(test)]
#[path = "vault_native_tests.rs"]
mod native_tests;
