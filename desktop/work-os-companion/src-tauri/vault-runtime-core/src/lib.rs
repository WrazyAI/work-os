//! One process-owned vault lifecycle, independent of the desktop framework.
use std::sync::mpsc::{channel, Receiver, Sender};
pub trait VaultBackend: Send + 'static {
    type Error: Send + 'static;
    fn open(&mut self) -> Result<(), Self::Error>;
    fn get(&mut self, key: &str) -> Result<Option<Vec<u8>>, Self::Error>;
    fn put(&mut self, key: &str, value: Vec<u8>) -> Result<(), Self::Error>;
    fn remove(&mut self, key: &str) -> Result<(), Self::Error>;
    fn reset(&mut self) -> Result<(), Self::Error>;
}
#[derive(Debug, PartialEq, Eq)]
pub enum RuntimeError<E> {
    Backend(E),
    StaleGeneration,
    Unavailable,
}
#[derive(Debug, PartialEq, Eq)]
pub struct VaultLease {
    pub generation: u64,
    pub reused: bool,
}
type Reply<T, E> = Sender<Result<T, RuntimeError<E>>>;
enum Request<E> {
    Open(Reply<VaultLease, E>),
    Get(u64, String, Reply<Option<Vec<u8>>, E>),
    Put(u64, String, Vec<u8>, Reply<(), E>),
    Remove(u64, String, Reply<(), E>),
    Reset(Reply<(), E>),
}
pub struct VaultRuntime<E> {
    sender: Sender<Request<E>>,
}
impl<E: Send + 'static> VaultRuntime<E> {
    pub fn spawn(mut backend: impl VaultBackend<Error = E>) -> std::io::Result<Self> {
        let (sender, receiver) = channel();
        std::thread::Builder::new()
            .name("work-os-vault-store".into())
            .spawn(move || {
                let mut ready = false;
                let mut generation = 1;
                while let Ok(request) = receiver.recv() {
                    match request {
                        Request::Open(reply) => {
                            let reused = ready;
                            let result = if ready {
                                Ok(())
                            } else {
                                guarded(|| backend.open())
                            };
                            ready = result.is_ok();
                            let _ = reply.send(result.map(|()| VaultLease { generation, reused }));
                        }
                        Request::Reset(reply) => {
                            // Fence even a failed reset: the backend may have partially
                            // discarded its state. No pre-reset mutation may be replayed.
                            ready = false;
                            generation += 1;
                            let _ = reply.send(guarded(|| backend.reset()));
                        }
                        Request::Get(lease, key, reply) => {
                            let result = if !ready || lease != generation {
                                Err(RuntimeError::StaleGeneration)
                            } else {
                                guarded(|| backend.get(&key))
                            };
                            invalidate_on_failure(&result, &mut ready, &mut generation);
                            let _ = reply.send(result);
                        }
                        Request::Put(lease, key, value, reply) => {
                            let result = if !ready || lease != generation {
                                Err(RuntimeError::StaleGeneration)
                            } else {
                                guarded(|| backend.put(&key, value))
                            };
                            invalidate_on_failure(&result, &mut ready, &mut generation);
                            let _ = reply.send(result);
                        }
                        Request::Remove(lease, key, reply) => {
                            let result = if !ready || lease != generation {
                                Err(RuntimeError::StaleGeneration)
                            } else {
                                guarded(|| backend.remove(&key))
                            };
                            invalidate_on_failure(&result, &mut ready, &mut generation);
                            let _ = reply.send(result);
                        }
                    }
                }
                // Dropping the backend never commits discarded or unacknowledged state.
            })?;
        Ok(Self { sender })
    }
    fn request<T>(
        &self,
        make: impl FnOnce(Reply<T, E>) -> Request<E>,
    ) -> Receiver<Result<T, RuntimeError<E>>> {
        let (reply, receiver) = channel();
        // Keep a sender to settle callers even when the worker has terminated.
        if self.sender.send(make(reply.clone())).is_err() {
            let _ = reply.send(Err(RuntimeError::Unavailable));
        }
        receiver
    }
    pub fn open(&self) -> Receiver<Result<VaultLease, RuntimeError<E>>> {
        self.request(Request::Open)
    }
    pub fn get(
        &self,
        generation: u64,
        key: String,
    ) -> Receiver<Result<Option<Vec<u8>>, RuntimeError<E>>> {
        self.request(|reply| Request::Get(generation, key, reply))
    }
    pub fn put(
        &self,
        generation: u64,
        key: String,
        value: Vec<u8>,
    ) -> Receiver<Result<(), RuntimeError<E>>> {
        self.request(|reply| Request::Put(generation, key, value, reply))
    }
    pub fn remove(&self, generation: u64, key: String) -> Receiver<Result<(), RuntimeError<E>>> {
        self.request(|reply| Request::Remove(generation, key, reply))
    }
    pub fn reset(&self) -> Receiver<Result<(), RuntimeError<E>>> {
        self.request(Request::Reset)
    }
}

fn invalidate_on_failure<T, E>(
    result: &Result<T, RuntimeError<E>>,
    ready: &mut bool,
    generation: &mut u64,
) {
    if matches!(
        result,
        Err(RuntimeError::Backend(_) | RuntimeError::Unavailable)
    ) {
        *ready = false;
        *generation += 1;
    }
}

// Some upstream snapshot/KDF failures panic instead of returning an error.
// A failed dependency must not kill the worker that owns the recovery command.
fn guarded<T, E>(operation: impl FnOnce() -> Result<T, E>) -> Result<T, RuntimeError<E>> {
    std::panic::catch_unwind(std::panic::AssertUnwindSafe(operation))
        .map_err(|_| RuntimeError::Unavailable)?
        .map_err(RuntimeError::Backend)
}
