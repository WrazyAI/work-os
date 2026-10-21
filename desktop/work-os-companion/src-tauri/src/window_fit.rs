//! Applies the work-area fit from `work-os-window-fit-core` to real windows.
//!
//! The decision itself lives in the core crate so it can be tested without a
//! display server; this module only reads the monitor, applies the result, and
//! records the numbers for support reports.

use tauri::{PhysicalSize, WebviewWindow};
use work_os_window_fit_core::{fitted_inner_size, Geometry, Size};

use crate::diagnostics;

/// Fits the window to its monitor's work area, then centers it there.
pub fn fit_to_work_area(window: &WebviewWindow, app: &tauri::AppHandle) {
    let category = format!("window.{}.fit", window.label());
    let monitor = window
        .current_monitor()
        .ok()
        .flatten()
        .or_else(|| window.primary_monitor().ok().flatten());
    let Some(monitor) = monitor else {
        diagnostics::host_event(
            app,
            &category,
            "no monitor reported; leaving the window at its configured size",
            diagnostics::DiagnosticLevel::Warn,
        );
        return;
    };
    let (Ok(outer), Ok(inner)) = (window.outer_size(), window.inner_size()) else {
        return;
    };
    let work_area = monitor.work_area();
    let geometry = Geometry {
        work_area: Size::new(work_area.size.width, work_area.size.height),
        outer: Size::new(outer.width, outer.height),
        inner: Size::new(inner.width, inner.height),
    };
    let applied = fitted_inner_size(&geometry, monitor.scale_factor());
    if let Some(size) = applied {
        // `set_size` sets the inner size, which is the one this fit computed.
        let _ = window.set_size(tauri::Size::Physical(PhysicalSize::new(size.width, size.height)));
        let _ = window.center();
    }
    let message = format!(
        "work_area={}x{}+{},{} outer={}x{} inner={}x{} scale={} fitted={}",
        geometry.work_area.width,
        geometry.work_area.height,
        work_area.position.x,
        work_area.position.y,
        geometry.outer.width,
        geometry.outer.height,
        geometry.inner.width,
        geometry.inner.height,
        monitor.scale_factor(),
        applied
            .map(|size| format!("{}x{}", size.width, size.height))
            .unwrap_or_else(|| "none".to_string()),
    );
    diagnostics::host_event(
        app,
        &category,
        &message,
        diagnostics::DiagnosticLevel::Info,
    );
}
