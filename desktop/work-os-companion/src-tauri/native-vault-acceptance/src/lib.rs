//! Test-only harness: compiles the production backend at the crate root so its
//! synthetic native tests can run without constructing a Tauri application.
#[path = "../../src/vault_backend.rs"]
pub mod backend;

// This WSL machine's older MinGW CRT lacks libsodium's C23 zeroing symbol.
// Volatile writes preserve explicit-memset semantics. Test harness only.
#[no_mangle]
pub unsafe extern "C" fn memset_explicit(
    dst: *mut std::ffi::c_void,
    value: std::ffi::c_int,
    count: usize,
) -> *mut std::ffi::c_void {
    let bytes = dst.cast::<u8>();
    for i in 0..count {
        std::ptr::write_volatile(bytes.add(i), value as u8);
    }
    std::sync::atomic::compiler_fence(std::sync::atomic::Ordering::SeqCst);
    dst
}
