//! Real-format acceptance: synthetic data only, never an installed profile.
use super::*;
use std::sync::{Arc, Mutex};
use work_os_vault_runtime_core::{RuntimeError, VaultRuntime};

struct Fixture {
    dir: PathBuf,
    password: Mutex<String>,
}
impl Drop for Fixture {
    fn drop(&mut self) {
        // Exact, test-created directory only.
        let _ = std::fs::remove_dir_all(&self.dir);
    }
}
struct TestCredentials(Arc<Fixture>);
impl Credentials for TestCredentials {
    fn read(&self) -> Result<String, VaultStoreError> {
        Ok(self.0.password.lock().unwrap().clone())
    }
    fn reset(&self) -> Result<(), VaultStoreError> {
        let path = self.0.dir.join("work-os-vault.hold");
        if path.exists() {
            std::fs::remove_file(path).map_err(|_| VaultStoreError::storage())?;
        }
        *self.0.password.lock().unwrap() = "synthetic-new-password".into();
        Ok(())
    }
}
fn fixture() -> Arc<Fixture> {
    let dir = std::env::temp_dir().join(format!(
        "work-os-vault-native-test-{}",
        uuid::Uuid::new_v4()
    ));
    std::fs::create_dir_all(&dir).unwrap();
    Arc::new(Fixture {
        dir,
        password: Mutex::new("synthetic-acceptance-password".into()),
    })
}
fn backend(f: &Arc<Fixture>) -> SnapshotBackend<TestCredentials> {
    SnapshotBackend::new(
        f.dir.join("work-os-vault.hold"),
        f.dir.join("stronghold-salt"),
        TestCredentials(f.clone()),
    )
}
fn old_open(f: &Fixture) -> Stronghold {
    // Copy before deriving: holding the fixture lock through Argon2 would
    // serialize the duplicate trials and flatter the measured old path.
    let password = f.password.lock().unwrap().clone();
    let hash = KeyDerivation::argon2(&password, &f.dir.join("stronghold-salt"));
    let store = Stronghold::new(f.dir.join("work-os-vault.hold"), hash).unwrap();
    store.load_client("work-os").unwrap();
    store
}

#[test]
fn old_snapshot_shared_runtime_restart_and_reset_keep_compatibility() {
    let f = fixture();
    // Exactly the legacy plugin wrapper and KDF, with production parameters.
    let hash = KeyDerivation::argon2(&f.password.lock().unwrap(), &f.dir.join("stronghold-salt"));
    let legacy = Stronghold::new(f.dir.join("work-os-vault.hold"), hash).unwrap();
    let client = legacy.create_client("work-os").unwrap();
    client
        .store()
        .insert(b"session".to_vec(), b"fixture-session-json".to_vec(), None)
        .unwrap();
    client
        .store()
        .insert(
            b"settings".to_vec(),
            br#"{"theme":"dark","themePromptSeen":true}"#.to_vec(),
            None,
        )
        .unwrap();
    legacy.save().unwrap();
    drop(legacy);

    let runtime = VaultRuntime::spawn(backend(&f)).unwrap();
    let a = runtime.open();
    let b = runtime.open();
    let first = a.recv().unwrap().unwrap();
    let second = b.recv().unwrap().unwrap();
    assert!(!first.reused);
    assert!(second.reused);
    assert_eq!(first.generation, second.generation);
    assert_eq!(
        runtime
            .get(first.generation, "session".into())
            .recv()
            .unwrap()
            .unwrap(),
        Some(b"fixture-session-json".to_vec())
    );
    runtime
        .put(first.generation, "from-main".into(), vec![1])
        .recv()
        .unwrap()
        .unwrap();
    runtime
        .put(second.generation, "from-avatar".into(), vec![2])
        .recv()
        .unwrap()
        .unwrap();
    let late = runtime.open().recv().unwrap().unwrap();
    assert!(late.reused);
    // A separately opened old wrapper can read the new owner's saved format.
    let old = old_open(&f);
    assert_eq!(
        old.get_client("work-os")
            .unwrap()
            .store()
            .get(b"from-avatar")
            .unwrap(),
        Some(vec![2])
    );
    drop(old);

    // A new runtime simulates a process restart, not a shared in-memory cache.
    let restarted = VaultRuntime::spawn(backend(&f)).unwrap();
    let fresh = restarted.open().recv().unwrap().unwrap();
    assert_eq!(
        restarted
            .get(fresh.generation, "from-main".into())
            .recv()
            .unwrap()
            .unwrap(),
        Some(vec![1])
    );
    assert_eq!(
        restarted
            .get(fresh.generation, "settings".into())
            .recv()
            .unwrap()
            .unwrap(),
        Some(br#"{"theme":"dark","themePromptSeen":true}"#.to_vec())
    );
    restarted.reset().recv().unwrap().unwrap();
    assert!(matches!(
        restarted
            .put(fresh.generation, "session".into(), vec![9])
            .recv()
            .unwrap(),
        Err(RuntimeError::StaleGeneration)
    ));
    let reset = restarted.open().recv().unwrap().unwrap();
    assert_eq!(
        restarted
            .get(reset.generation, "session".into())
            .recv()
            .unwrap()
            .unwrap(),
        None
    );
    println!("PASS native compatibility: legacy snapshot, shared open, late attach, both writes, restart, theme, reset fence");
}

fn create_snapshot(f: &Fixture) {
    let password = f.password.lock().unwrap().clone();
    let hash = KeyDerivation::argon2(&password, &f.dir.join("stronghold-salt"));
    let legacy = Stronghold::new(f.dir.join("work-os-vault.hold"), hash).unwrap();
    legacy
        .create_client("work-os")
        .unwrap()
        .store()
        .insert(b"session".to_vec(), b"fixture".to_vec(), None)
        .unwrap();
    legacy.save().unwrap();
}

#[test]
fn opening_with_the_wrong_credential_returns_explicit_reset_recovery() {
    let f = fixture();
    create_snapshot(&f);
    let path = f.dir.join("work-os-vault.hold");
    let salt = f.dir.join("stronghold-salt");
    let before = (std::fs::read(&path).unwrap(), std::fs::read(&salt).unwrap());
    *f.password.lock().unwrap() = "synthetic-wrong-password".into();
    let error = backend(&f).open().unwrap_err();
    assert_eq!(error.code, "bad_file_key");
    assert!(error.requires_reset);
    assert_eq!(
        (std::fs::read(&path).unwrap(), std::fs::read(&salt).unwrap()),
        before
    );
}

#[test]
fn corrupt_snapshot_is_preserved_not_replaced() {
    let f = fixture();
    create_snapshot(&f);
    let path = f.dir.join("work-os-vault.hold");
    let salt = f.dir.join("stronghold-salt");
    let salt_before = std::fs::read(&salt).unwrap();
    std::fs::write(&path, b"not-a-snapshot").unwrap();
    assert!(backend(&f).open().is_err());
    assert_eq!(std::fs::read(&path).unwrap(), b"not-a-snapshot");
    assert_eq!(std::fs::read(&salt).unwrap(), salt_before);
}

#[test]
fn malformed_salt_is_preserved_not_replaced() {
    let f = fixture();
    create_snapshot(&f);
    let path = f.dir.join("work-os-vault.hold");
    let salt = f.dir.join("stronghold-salt");
    let snapshot_before = std::fs::read(&path).unwrap();
    std::fs::write(&salt, b"bad").unwrap();
    assert!(backend(&f).open().is_err());
    assert_eq!(std::fs::read(&salt).unwrap(), b"bad");
    assert_eq!(std::fs::read(&path).unwrap(), snapshot_before);
}

#[test]
fn shared_open_reports_native_subphases_only_for_the_first_initialization() {
    let f = fixture();
    let events = Arc::new(Mutex::new(Vec::new()));
    let sink = events.clone();
    let runtime = VaultRuntime::spawn(backend(&f).with_timings(move |phase, duration| {
        sink.lock().unwrap().push((phase, duration));
    }))
    .unwrap();
    let first = runtime.open().recv().unwrap().unwrap();
    let second = runtime.open().recv().unwrap().unwrap();
    assert!(!first.reused);
    assert!(second.reused);
    let events = events.lock().unwrap();
    assert_eq!(
        events.iter().map(|e| e.0).collect::<Vec<_>>(),
        vec!["key", "derive", "snapshot", "client"]
    );
}

#[test]
fn confirmed_decryption_verdict_retains_the_explicit_reset_recovery() {
    let failure = snapshot_error("failed to decode/decrypt age content BadFileKey");
    assert_eq!(failure.code, "bad_file_key");
    assert!(failure.requires_reset);
    assert!(failure.message.contains("BadFileKey"));
    assert!(!snapshot_error("unknown disk failure").requires_reset);
}

#[test]
#[ignore = "manual same-machine synthetic encrypted snapshot benchmark"]
fn compare_duplicate_and_shared_snapshot_opens() {
    use std::time::Instant;
    let f = fixture();
    let hash = KeyDerivation::argon2(&f.password.lock().unwrap(), &f.dir.join("stronghold-salt"));
    let legacy = Stronghold::new(f.dir.join("work-os-vault.hold"), hash).unwrap();
    legacy.create_client("work-os").unwrap();
    legacy.save().unwrap();
    drop(legacy);
    for trial in 1..=3 {
        let start = Instant::now();
        std::thread::scope(|scope| {
            let a = scope.spawn(|| old_open(&f));
            let b = scope.spawn(|| old_open(&f));
            drop(a.join().unwrap());
            drop(b.join().unwrap());
        });
        let old_ms = start.elapsed().as_millis();
        let runtime = VaultRuntime::spawn(backend(&f)).unwrap();
        let start = Instant::now();
        let a = runtime.open();
        let b = runtime.open();
        assert!(!a.recv().unwrap().unwrap().reused);
        assert!(b.recv().unwrap().unwrap().reused);
        let shared_ms = start.elapsed().as_millis();
        println!("trial={trial} duplicate_snapshot_ms={old_ms} shared_snapshot_ms={shared_ms}");
    }
}
