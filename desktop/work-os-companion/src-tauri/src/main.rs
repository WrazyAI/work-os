// Keep the companion a GUI process in both development and release builds.
// Without this, Windows attaches a console to debug binaries launched directly.
#![cfg_attr(windows, windows_subsystem = "windows")]

fn main() {
    work_os_companion_lib::run();
}
