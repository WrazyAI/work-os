//! The password that unlocks this device's Stronghold vault, and the rules that
//! decide how it is stored and recovered.
//!
//! The vault holds the desktop session, queued updates, and the cached workday.
//! It is encrypted with a random machine-local password, and that password lives
//! in the OS credential store (Keychain on macOS, Credential Manager on Windows,
//! Secret Service on Linux). This crate is the part of that story that has
//! nothing to do with the OS: what an answer from the store means, what may be
//! replaced, and how a device starts fresh. The host supplies the store, the
//! threaded request loop, and the diagnostics.
//!
//! Four rules shape everything here, and each one exists because of a real
//! failure:
//!
//! 1. **A password that cannot be read is never silently replaced.** A freshly
//!    minted password would leave the existing vault file undecryptable while
//!    reporting success, so a replacement is only created when there is no vault
//!    file to lose.
//! 2. **One launch raises at most one key access.** Every window boots its own
//!    vault read, and on macOS every unanswered read raises another system
//!    dialog — one of them landing behind the always-on-top companion where
//!    nobody could see it, with the app frozen behind it. One thread serves
//!    every request and answers the repeats from the value it already holds.
//! 3. **A failed attempt is not cached.** The macOS dialog is answered *after*
//!    the failure, so the next attempt must reach the store again instead of
//!    replaying the failure.
//! 4. **Starting fresh works even when the OS refuses to remove the old
//!    credential.** A stale entry the binary is not trusted for can also refuse
//!    deletion, so a reset mints a new vault id: the credential is named after
//!    that id, which makes the next read use a fresh, trusted entry instead of
//!    fighting the old one.

use base64::Engine;
use rand::RngCore;
use serde::Serialize;
use std::sync::mpsc::{Receiver, Sender};

/// The original credential name. A device with no vault id file yet keeps it, so
/// installs that already stored a password keep working.
pub const LEGACY_ACCOUNT: &str = "stronghold-vault";

/// The Stronghold vault file inside the app data directory. The host and the
/// frontend both open this name.
pub const VAULT_FILE: &str = "work-os-vault.hold";

/// Names the credential of the vault this device currently holds.
pub const VAULT_ID_FILE: &str = "work-os-vault.id";

/// Why the local vault password could not be produced.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum VaultPasswordErrorCode {
    /// The OS wants the employee to confirm access. On macOS this is the
    /// keychain dialog; a denied dialog lands here too.
    ConfirmationRequired,
    /// A password is stored but cannot be read, so the existing vault file
    /// cannot be opened. Only starting fresh recovers this.
    UnlockFailed,
    /// The credential store itself could not be reached.
    StoreUnavailable,
    /// The store refused to keep a newly generated password.
    StoreWriteFailed,
    /// The host could not run the request at all.
    Unavailable,
}

/// A failure the app's retry or reset path can act on. It never carries the
/// password or any part of it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultPasswordError {
    pub code: VaultPasswordErrorCode,
    pub message: String,
    /// True when only `reset` can move this device forward.
    pub requires_reset: bool,
}

impl VaultPasswordError {
    pub fn confirmation_required() -> Self {
        Self {
            code: VaultPasswordErrorCode::ConfirmationRequired,
            message: "macOS is waiting for you to allow access to the saved Work OS key. Look for a system password dialog — it can open behind the companion — then try again.".into(),
            requires_reset: false,
        }
    }

    pub fn unlock_failed() -> Self {
        Self {
            code: VaultPasswordErrorCode::UnlockFailed,
            message: "The saved key for this device's Work OS data can't be read, so the local data can't be opened. Try again, or start fresh to replace it.".into(),
            requires_reset: true,
        }
    }

    pub fn store_unavailable() -> Self {
        Self {
            code: VaultPasswordErrorCode::StoreUnavailable,
            message: "This device's password store is unavailable right now. Try again in a moment.".into(),
            requires_reset: false,
        }
    }

    pub fn store_write_failed() -> Self {
        Self {
            code: VaultPasswordErrorCode::StoreWriteFailed,
            message: "This device's password store refused to save a new key. Try again in a moment.".into(),
            requires_reset: false,
        }
    }

    pub fn unavailable() -> Self {
        Self {
            code: VaultPasswordErrorCode::Unavailable,
            message: "The local vault request could not run. Try again in a moment.".into(),
            requires_reset: false,
        }
    }
}

/// What the credential store answered for the vault's password.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum StoreAnswer {
    Password(String),
    Missing,
    /// The read failed for another reason. The text is a diagnostic reason and
    /// never contains a password.
    Failed(String),
}

/// What to do with the store's answer given whether a vault file exists.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum StoreDecision {
    Use(String),
    /// Nothing stored and nothing to lose: create a password.
    Mint,
    UnlockFailed,
    Unavailable(String),
}

pub fn decide(answer: StoreAnswer, vault_exists: bool) -> StoreDecision {
    match answer {
        StoreAnswer::Password(password) => StoreDecision::Use(password),
        // There is a vault on disk, so a new password would be a lie: the file
        // cannot be opened with it. Surface the recovery instead.
        StoreAnswer::Missing if vault_exists => StoreDecision::UnlockFailed,
        StoreAnswer::Missing => StoreDecision::Mint,
        StoreAnswer::Failed(reason) => StoreDecision::Unavailable(reason),
    }
}

/// A read failure is usually the OS asking for confirmation; a store that is
/// genuinely unreachable (locked or missing) reads differently. Both are
/// retryable, so the split only sharpens the copy the employee sees.
pub fn classify_unavailable(reason: &str) -> VaultPasswordError {
    // errSecAuthFailed, errSecInteractionNotAllowed, errSecUserCanceled, and
    // errSecItemNotFound are how macOS reports a keychain item this binary is
    // not trusted for, plus a denied or unanswered dialog.
    for needle in ["-25293", "-25308", "-128", "-25300", "cancel", "auth"] {
        if reason.contains(needle) {
            return VaultPasswordError::confirmation_required();
        }
    }
    VaultPasswordError::store_unavailable()
}

/// The credential account for the vault this device holds.
pub fn account_for(vault_id: Option<&str>) -> String {
    match vault_id.map(str::trim).filter(|id| !id.is_empty()) {
        Some(id) => format!("{LEGACY_ACCOUNT}:{id}"),
        None => LEGACY_ACCOUNT.to_string(),
    }
}

/// The credential store and the local files this module reads and writes.
///
/// The request loop is written against this trait so the rules that broke (one
/// store access per launch, never minting over an existing vault, recovering
/// after a denied dialog) are covered by tests that never touch a keychain.
pub trait VaultStore {
    fn read(&self, account: &str) -> StoreAnswer;
    fn write(&self, account: &str, password: &str) -> Result<(), String>;
    fn delete(&self, account: &str) -> Result<(), String>;
    fn vault_exists(&self) -> bool;
    fn forget_vault(&self) -> Result<(), String>;
    fn read_vault_id(&self) -> Option<String>;
    fn write_vault_id(&self) -> Result<String, String>;
}

pub enum VaultRequest {
    Read { reply: Sender<Result<String, VaultPasswordError>> },
    Reset { reply: Sender<Result<(), VaultPasswordError>> },
}

/// Serves every vault request from one thread, one store access at a time, and
/// answers repeats from the value it already holds.
pub fn serve(
    store: &dyn VaultStore,
    notify: &dyn Fn(&str, &str),
    receiver: Receiver<VaultRequest>,
) {
    let mut cached: Option<String> = None;
    while let Ok(request) = receiver.recv() {
        match request {
            VaultRequest::Read { reply } => {
                let outcome = match cached.clone() {
                    Some(password) => Ok(password),
                    None => match read_or_create(store, notify) {
                        Ok(password) => {
                            cached = Some(password.clone());
                            Ok(password)
                        }
                        Err(error) => Err(error),
                    },
                };
                let _ = reply.send(outcome);
            }
            VaultRequest::Reset { reply } => {
                cached = None;
                let _ = reply.send(reset(store, notify));
            }
        }
    }
}

pub fn random_id() -> String {
    let mut value = [0_u8; 16];
    rand::rng().fill_bytes(&mut value);
    value.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn read_or_create(
    store: &dyn VaultStore,
    notify: &dyn Fn(&str, &str),
) -> Result<String, VaultPasswordError> {
    let account = account_for(store.read_vault_id().as_deref());
    // Store errors are for the diagnostics trail, never for the employee: the
    // failure screen's copy is bounded and the OS wording is not.
    let mut detail = String::new();
    let outcome = match decide(store.read(&account), store.vault_exists()) {
        StoreDecision::Use(password) => Ok(password),
        StoreDecision::UnlockFailed => Err(VaultPasswordError::unlock_failed()),
        StoreDecision::Unavailable(reason) => {
            detail = reason.clone();
            Err(classify_unavailable(&reason))
        }
        StoreDecision::Mint => {
            let mut value = [0_u8; 32];
            rand::rng().fill_bytes(&mut value);
            let password = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(value);
            match store.write(&account, &password) {
                Ok(()) => Ok(password),
                Err(reason) => {
                    detail = reason.clone();
                    Err(VaultPasswordError::store_write_failed())
                }
            }
        }
    };
    match &outcome {
        Ok(_) => notify("vault.password.ready", "Resolved the local vault key"),
        Err(error) => notify(
            "vault.password.failed",
            &format!(
                "Local vault key unavailable ({:?}){}",
                error.code,
                if detail.is_empty() { String::new() } else { format!(": {detail}") }
            ),
        ),
    }
    outcome
}

/// Starts fresh on this device: replaces the vault id, removes the vault file,
/// and best-effort removes the credential that id pointed at.
fn reset(store: &dyn VaultStore, notify: &dyn Fn(&str, &str)) -> Result<(), VaultPasswordError> {
    let stale_account = account_for(store.read_vault_id().as_deref());
    // Best effort: a credential the binary is not trusted for may also refuse
    // removal. The new vault id is what unblocks the next launch.
    let removed = store.delete(&stale_account);
    store
        .forget_vault()
        .map_err(|_| VaultPasswordError::store_write_failed())?;
    let new_id = store
        .write_vault_id()
        .map_err(|_| VaultPasswordError::store_write_failed())?;
    notify(
        "vault.local.reset",
        &format!(
            "Replaced this device's local vault (new id {new_id}, previous credential {})",
            match removed {
                Ok(()) => "removed".to_string(),
                Err(reason) => format!("removal failed: {reason}"),
            }
        ),
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc::channel;
    use std::sync::Mutex;

    #[derive(Default)]
    struct StoreLog {
        reads: Vec<String>,
        writes: Vec<String>,
    }

    struct FakeStore {
        answer: Mutex<StoreAnswer>,
        vault_exists: Mutex<bool>,
        vault_id: Mutex<Option<String>>,
        log: Mutex<StoreLog>,
        delete_result: Result<(), String>,
    }

    impl FakeStore {
        fn new(answer: StoreAnswer, vault_exists: bool) -> Self {
            Self {
                answer: Mutex::new(answer),
                vault_exists: Mutex::new(vault_exists),
                vault_id: Mutex::new(None),
                log: Mutex::new(StoreLog::default()),
                delete_result: Ok(()),
            }
        }

        fn reads(&self) -> usize {
            self.log.lock().unwrap().reads.len()
        }

        fn writes(&self) -> usize {
            self.log.lock().unwrap().writes.len()
        }
    }

    impl VaultStore for FakeStore {
        fn read(&self, account: &str) -> StoreAnswer {
            self.log.lock().unwrap().reads.push(account.to_string());
            self.answer.lock().unwrap().clone()
        }
        fn write(&self, account: &str, password: &str) -> Result<(), String> {
            self.log
                .lock()
                .unwrap()
                .writes
                .push(format!("{account}:{password}"));
            Ok(())
        }
        fn delete(&self, _account: &str) -> Result<(), String> {
            self.delete_result.clone()
        }
        fn vault_exists(&self) -> bool {
            *self.vault_exists.lock().unwrap()
        }
        fn forget_vault(&self) -> Result<(), String> {
            *self.vault_exists.lock().unwrap() = false;
            Ok(())
        }
        fn read_vault_id(&self) -> Option<String> {
            self.vault_id.lock().unwrap().clone()
        }
        fn write_vault_id(&self) -> Result<String, String> {
            let id = "0123456789abcdef".to_string();
            *self.vault_id.lock().unwrap() = Some(id.clone());
            Ok(id)
        }
    }

    fn quiet() -> impl Fn(&str, &str) {
        |_category: &str, _message: &str| {}
    }

    /// Serves `store` on its own thread and returns the request sender.
    fn serving(store: &'static FakeStore) -> Sender<VaultRequest> {
        let (sender, receiver) = channel();
        std::thread::spawn(move || serve(store, &quiet(), receiver));
        sender
    }

    fn read(sender: &Sender<VaultRequest>) -> Result<String, VaultPasswordError> {
        let (reply, answer) = channel();
        sender.send(VaultRequest::Read { reply }).unwrap();
        answer.recv().unwrap()
    }

    fn reset_once(sender: &Sender<VaultRequest>) -> Result<(), VaultPasswordError> {
        let (reply, answer) = channel();
        sender.send(VaultRequest::Reset { reply }).unwrap();
        answer.recv().unwrap()
    }

    fn boxed(store: FakeStore) -> &'static FakeStore {
        Box::leak(Box::new(store))
    }

    #[test]
    fn decides_from_the_store_answer_and_the_vault_file() {
        assert_eq!(
            decide(StoreAnswer::Password("saved".into()), true),
            StoreDecision::Use("saved".into())
        );
        assert_eq!(decide(StoreAnswer::Missing, true), StoreDecision::UnlockFailed);
        assert_eq!(decide(StoreAnswer::Missing, false), StoreDecision::Mint);
        assert_eq!(
            decide(StoreAnswer::Failed("OSStatus -25308".into()), true),
            StoreDecision::Unavailable("OSStatus -25308".into())
        );
    }

    #[test]
    fn names_the_credential_after_the_vault_id() {
        assert_eq!(account_for(None), LEGACY_ACCOUNT);
        assert_eq!(account_for(Some("   ")), LEGACY_ACCOUNT);
        assert_eq!(account_for(Some("abc123")), "stronghold-vault:abc123");
        assert_eq!(account_for(Some(" abc123 ")), "stronghold-vault:abc123");
    }

    #[test]
    fn classifies_a_denied_macos_dialog_as_confirmation() {
        assert_eq!(
            classify_unavailable("keychain error OSStatus -25308").code,
            VaultPasswordErrorCode::ConfirmationRequired
        );
        assert_eq!(
            classify_unavailable(
                "platform failure: The user name or passphrase you entered is not correct."
            )
            .code,
            VaultPasswordErrorCode::StoreUnavailable
        );
    }

    #[test]
    fn reads_the_store_once_and_answers_every_later_window_from_memory() {
        let store = boxed(FakeStore::new(StoreAnswer::Password("saved".into()), true));
        let sender = serving(store);
        assert_eq!(read(&sender).unwrap(), "saved");
        assert_eq!(read(&sender).unwrap(), "saved");
        assert_eq!(read(&sender).unwrap(), "saved");
        assert_eq!(store.reads(), 1, "one launch raises at most one key access");
    }

    #[test]
    fn refuses_to_mint_over_an_existing_vault() {
        let store = boxed(FakeStore::new(StoreAnswer::Missing, true));
        let sender = serving(store);
        let error = read(&sender).unwrap_err();
        assert_eq!(error.code, VaultPasswordErrorCode::UnlockFailed);
        assert!(error.requires_reset);
        assert_eq!(
            store.writes(),
            0,
            "a new password would not open the existing vault"
        );
    }

    #[test]
    fn mints_a_password_on_a_device_with_no_vault_yet() {
        let store = boxed(FakeStore::new(StoreAnswer::Missing, false));
        let sender = serving(store);
        let password = read(&sender).unwrap();
        assert!(!password.is_empty());
        assert_eq!(store.writes(), 1);
        assert_eq!(
            read(&sender).unwrap(),
            password,
            "the minted password is the launch's password"
        );
        assert_eq!(store.reads(), 1);
    }

    #[test]
    fn a_retry_can_recover_once_the_employee_allows_access() {
        let store = boxed(FakeStore::new(
            StoreAnswer::Failed("OSStatus -25308".into()),
            true,
        ));
        let sender = serving(store);
        assert_eq!(
            read(&sender).unwrap_err().code,
            VaultPasswordErrorCode::ConfirmationRequired
        );
        // The dialog is answered: the next attempt must reach the store again
        // rather than replaying the cached failure.
        *store.answer.lock().unwrap() = StoreAnswer::Password("allowed".into());
        assert_eq!(read(&sender).unwrap(), "allowed");
        assert_eq!(store.reads(), 2);
    }

    #[test]
    fn keeps_store_jargon_out_of_the_employee_message() {
        let store = boxed(FakeStore::new(
            StoreAnswer::Failed("keychain error OSStatus -25294".into()),
            true,
        ));
        let sender = serving(store);
        let error = read(&sender).unwrap_err();
        assert_eq!(error.code, VaultPasswordErrorCode::StoreUnavailable);
        assert!(
            !error.message.contains("OSStatus") && !error.message.contains("-25294"),
            "the failure screen shows a bounded reason, not the OS wording: {}",
            error.message
        );
        assert!(error.message.len() < 200);
    }

    #[test]
    fn reset_replaces_the_vault_id_so_a_stale_credential_cannot_block_a_restart() {
        let store = boxed(FakeStore::new(
            StoreAnswer::Failed("OSStatus -25293".into()),
            true,
        ));
        *store.vault_id.lock().unwrap() = Some("oldid".into());
        let sender = serving(store);

        reset_once(&sender).unwrap();
        assert_ne!(
            store.vault_id.lock().unwrap().clone(),
            Some("oldid".to_string())
        );
        assert!(
            !store.vault_exists(),
            "starting fresh removes the unreadable vault"
        );

        // The next read asks the new credential name, so the stale entry that
        // macOS would not even delete can no longer block the app.
        *store.answer.lock().unwrap() = StoreAnswer::Password("fresh".into());
        assert_eq!(read(&sender).unwrap(), "fresh");
        assert_eq!(
            store.log.lock().unwrap().reads.last().unwrap(),
            "stronghold-vault:0123456789abcdef"
        );
    }

    #[test]
    fn reset_survives_a_credential_the_os_refuses_to_remove() {
        let mut store = FakeStore::new(StoreAnswer::Failed("OSStatus -25293".into()), true);
        store.delete_result = Err("OSStatus -25293".into());
        let store = boxed(store);
        let sender = serving(store);
        assert!(reset_once(&sender).is_ok());
        assert!(!store.vault_exists());
    }

    #[test]
    fn reset_clears_the_cached_password_for_the_replaced_vault() {
        let store = boxed(FakeStore::new(StoreAnswer::Password("old".into()), true));
        let sender = serving(store);
        assert_eq!(read(&sender).unwrap(), "old");
        reset_once(&sender).unwrap();
        press_reload(store, "new");
        assert_eq!(read(&sender).unwrap(), "new");
        assert_eq!(store.reads(), 2, "the replaced vault is read, not replayed");
    }

    fn press_reload(store: &FakeStore, password: &str) {
        *store.answer.lock().unwrap() = StoreAnswer::Password(password.into());
    }
}
