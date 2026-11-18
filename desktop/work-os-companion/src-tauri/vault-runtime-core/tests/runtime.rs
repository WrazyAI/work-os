use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use work_os_vault_runtime_core::{RuntimeError, VaultBackend, VaultRuntime};

#[derive(Default)]
struct Disk {
    records: HashMap<String, Vec<u8>>,
    live: HashMap<String, Vec<u8>>,
    opens: usize,
    fail_open: bool,
    fail_save: bool,
    fail_reset: bool,
    panic_open: bool,
}
struct Backend(Arc<Mutex<Disk>>);
impl VaultBackend for Backend {
    type Error = &'static str;
    fn open(&mut self) -> Result<(), Self::Error> {
        let panic_open = self.0.lock().unwrap().panic_open;
        if panic_open {
            panic!("synthetic native open panic");
        }
        let mut disk = self.0.lock().unwrap();
        disk.opens += 1;
        if disk.fail_open {
            Err("confirmation_required")
        } else {
            disk.live = disk.records.clone();
            Ok(())
        }
    }
    fn get(&mut self, key: &str) -> Result<Option<Vec<u8>>, Self::Error> {
        Ok(self.0.lock().unwrap().live.get(key).cloned())
    }
    fn put(&mut self, key: &str, value: Vec<u8>) -> Result<(), Self::Error> {
        let mut disk = self.0.lock().unwrap();
        // A real store mutates its live copy before committing the snapshot. A
        // failed commit must not be treated as durable on the next open.
        disk.live.insert(key.into(), value);
        if disk.fail_save {
            return Err("save_failed");
        }
        disk.records = disk.live.clone();
        Ok(())
    }
    fn remove(&mut self, key: &str) -> Result<(), Self::Error> {
        let mut disk = self.0.lock().unwrap();
        disk.live.remove(key);
        if disk.fail_save {
            return Err("save_failed");
        }
        disk.records = disk.live.clone();
        Ok(())
    }
    fn reset(&mut self) -> Result<(), Self::Error> {
        let mut disk = self.0.lock().unwrap();
        if disk.fail_reset {
            return Err("reset_failed");
        }
        disk.records.clear();
        disk.live.clear();
        Ok(())
    }
}

#[test]
fn a_panicking_dependency_does_not_disable_reset_or_future_open_requests() {
    let (runtime, disk) = fixture();
    disk.lock().unwrap().panic_open = true;
    assert_eq!(
        runtime.open().recv().unwrap(),
        Err(RuntimeError::Unavailable)
    );
    disk.lock().unwrap().panic_open = false;
    runtime.reset().recv().unwrap().unwrap();
    assert!(!runtime.open().recv().unwrap().unwrap().reused);
}
fn fixture() -> (VaultRuntime<&'static str>, Arc<Mutex<Disk>>) {
    let disk = Arc::new(Mutex::new(Disk::default()));
    (VaultRuntime::spawn(Backend(disk.clone())).unwrap(), disk)
}

#[test]
fn concurrent_windows_share_one_open_and_never_replace_unsaved_live_state() {
    let (runtime, disk) = fixture();
    let opens: Vec<_> = (0..20).map(|_| runtime.open()).collect();
    let leases: Vec<_> = opens
        .into_iter()
        .map(|r| r.recv().unwrap().unwrap())
        .collect();
    assert_eq!(disk.lock().unwrap().opens, 1);
    assert!(!leases[0].reused);
    assert!(leases[1..]
        .iter()
        .all(|lease| lease.reused && lease.generation == leases[0].generation));
    runtime
        .put(leases[0].generation, "session".into(), b"saved".to_vec())
        .recv()
        .unwrap()
        .unwrap();
    assert_eq!(
        runtime
            .get(leases[19].generation, "session".into())
            .recv()
            .unwrap()
            .unwrap(),
        Some(b"saved".to_vec())
    );
}

#[test]
fn dropped_caller_and_late_window_still_join_the_successful_open() {
    let (runtime, disk) = fixture();
    drop(runtime.open());
    assert!(runtime.open().recv().unwrap().unwrap().reused);
    assert_eq!(disk.lock().unwrap().opens, 1);
}

#[test]
fn open_failure_is_retryable_and_preserves_the_backend_error_and_records() {
    let (runtime, disk) = fixture();
    disk.lock()
        .unwrap()
        .records
        .insert("session".into(), b"existing".to_vec());
    disk.lock().unwrap().fail_open = true;
    assert_eq!(
        runtime.open().recv().unwrap(),
        Err(RuntimeError::Backend("confirmation_required"))
    );
    disk.lock().unwrap().fail_open = false;
    let lease = runtime.open().recv().unwrap().unwrap();
    assert!(!lease.reused);
    assert_eq!(disk.lock().unwrap().opens, 2);
    assert_eq!(
        runtime
            .get(lease.generation, "session".into())
            .recv()
            .unwrap()
            .unwrap(),
        Some(b"existing".to_vec())
    );
}

#[test]
fn reset_fences_queued_old_writes_and_old_reads_without_replaying_them() {
    let (runtime, _) = fixture();
    let old = runtime.open().recv().unwrap().unwrap();
    let reset = runtime.reset();
    let stale_write = runtime.put(old.generation, "session".into(), b"resurrected".to_vec());
    reset.recv().unwrap().unwrap();
    assert_eq!(
        stale_write.recv().unwrap(),
        Err(RuntimeError::StaleGeneration)
    );
    assert_eq!(
        runtime
            .get(old.generation, "session".into())
            .recv()
            .unwrap(),
        Err(RuntimeError::StaleGeneration)
    );
    let new = runtime.open().recv().unwrap().unwrap();
    assert_ne!(old.generation, new.generation);
    assert_eq!(
        runtime
            .get(new.generation, "session".into())
            .recv()
            .unwrap()
            .unwrap(),
        None
    );
}

#[test]
fn failed_reset_still_retires_old_leases_and_can_be_retried() {
    let (runtime, disk) = fixture();
    let old = runtime.open().recv().unwrap().unwrap();
    disk.lock().unwrap().fail_reset = true;
    assert_eq!(
        runtime.reset().recv().unwrap(),
        Err(RuntimeError::Backend("reset_failed"))
    );
    assert_eq!(
        runtime
            .put(old.generation, "session".into(), vec![1])
            .recv()
            .unwrap(),
        Err(RuntimeError::StaleGeneration)
    );
    disk.lock().unwrap().fail_reset = false;
    runtime.reset().recv().unwrap().unwrap();
    assert!(!runtime.open().recv().unwrap().unwrap().reused);
}

#[test]
fn writes_are_durable_before_acknowledgement_and_save_failure_is_not_success() {
    let (runtime, disk) = fixture();
    let lease = runtime.open().recv().unwrap().unwrap();
    runtime
        .put(lease.generation, "settings".into(), b"dark".to_vec())
        .recv()
        .unwrap()
        .unwrap();
    disk.lock().unwrap().fail_save = true;
    assert_eq!(
        runtime
            .put(lease.generation, "settings".into(), b"light".to_vec())
            .recv()
            .unwrap(),
        Err(RuntimeError::Backend("save_failed"))
    );
    disk.lock().unwrap().fail_save = false;
    let reopened = runtime.open().recv().unwrap().unwrap();
    assert!(!reopened.reused);
    assert_eq!(
        runtime
            .get(reopened.generation, "settings".into())
            .recv()
            .unwrap()
            .unwrap(),
        Some(b"dark".to_vec())
    );
    runtime
        .remove(reopened.generation, "settings".into())
        .recv()
        .unwrap()
        .unwrap();
    assert_eq!(
        runtime
            .get(reopened.generation, "settings".into())
            .recv()
            .unwrap()
            .unwrap(),
        None
    );
}
