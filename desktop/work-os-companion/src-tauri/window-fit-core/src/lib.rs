//! How a window is fitted into the display's usable area.
//!
//! The companion asks for a 1000x960 logical window. A 13-inch MacBook's work
//! area is about 1440x875 points, and macOS only guarantees that a window's
//! *title bar* stays on screen: the rest of an oversized window hangs below the
//! display. The setup wizard pins its Back/Continue row to the bottom of the
//! window, so on those Macs the row was painted below the physical screen even
//! though the layout was correct.
//!
//! This crate owns the arithmetic only. The host supplies the monitor's real
//! numbers and applies the result, which keeps the decision testable on a
//! machine without a display server.

/// A size in physical pixels.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Size {
    pub width: u32,
    pub height: u32,
}

impl Size {
    pub const fn new(width: u32, height: u32) -> Self {
        Self { width, height }
    }
}

/// The three sizes a fit decision needs, all in physical pixels.
#[derive(Debug, Clone, Copy)]
pub struct Geometry {
    pub work_area: Size,
    pub outer: Size,
    pub inner: Size,
}

/// Gap kept between the window and the work-area edges, in logical pixels.
const EDGE_MARGIN: f64 = 8.0;
/// A fit below these logical sizes is not meaningful; leave the window alone.
const MIN_LOGICAL_WIDTH: f64 = 360.0;
const MIN_LOGICAL_HEIGHT: f64 = 480.0;

/// The inner size to apply when the window does not fit, or `None` when every
/// edge already falls inside the work area.
///
/// Only the axis that overflows is resized: a display that is narrow but tall
/// must not stretch the window, and vice versa.
pub fn fitted_inner_size(geometry: &Geometry, scale_factor: f64) -> Option<Size> {
    let scale = if scale_factor.is_finite() && scale_factor > 0.0 {
        scale_factor
    } else {
        1.0
    };
    let margin = (EDGE_MARGIN * scale).round() as u32;
    let available = Size::new(
        geometry
            .work_area
            .width
            .saturating_sub(margin.saturating_mul(2)),
        geometry
            .work_area
            .height
            .saturating_sub(margin.saturating_mul(2)),
    );
    let too_wide = geometry.outer.width > available.width;
    let too_tall = geometry.outer.height > available.height;
    if !too_wide && !too_tall {
        return None;
    }

    // The frame and title bar sit between the inner size we set and the outer
    // size the display has to hold.
    let chrome_width = geometry.outer.width.saturating_sub(geometry.inner.width);
    let chrome_height = geometry.outer.height.saturating_sub(geometry.inner.height);

    let inner_width = if too_wide {
        available
            .width
            .saturating_sub(chrome_width)
            .max((MIN_LOGICAL_WIDTH * scale).round() as u32)
    } else {
        geometry.inner.width
    };
    let inner_height = if too_tall {
        let candidate = available.height.saturating_sub(chrome_height);
        if f64::from(candidate) < MIN_LOGICAL_HEIGHT * scale {
            return None;
        }
        candidate
    } else {
        geometry.inner.height
    };

    Some(Size::new(inner_width, inner_height))
}

#[cfg(test)]
mod tests {
    use super::{fitted_inner_size, Geometry, Size};

    fn geometry(work: (u32, u32), outer: (u32, u32), inner: (u32, u32)) -> Geometry {
        Geometry {
            work_area: Size::new(work.0, work.1),
            outer: Size::new(outer.0, outer.1),
            inner: Size::new(inner.0, inner.1),
        }
    }

    #[test]
    fn a_window_taller_than_the_display_loses_the_title_bar_and_margins() {
        // 13-inch MacBook at 2x: 1440x900 points with a 25-point menu bar, and a
        // 1000x960 window whose frame adds a 28-point title bar.
        let result = fitted_inner_size(&geometry((2880, 1750), (2000, 1976), (2000, 1920)), 2.0);
        // 1750 physical points of work area minus 16px of margin on each side
        // leaves 1718 for the frame; the 56px title bar comes out of the inner
        // height, so the setup footer lands at 831 logical points.
        assert_eq!(result, Some(Size::new(2000, 1662)));
    }

    #[test]
    fn a_window_that_already_fits_is_left_alone() {
        assert_eq!(
            fitted_inner_size(&geometry((2880, 2200), (2000, 1976), (2000, 1920)), 2.0),
            None
        );
    }

    #[test]
    fn only_the_axis_that_overflows_is_resized() {
        // A narrow display: the width gives, the height stays as configured.
        assert_eq!(
            fitted_inner_size(&geometry((1900, 2200), (2000, 1976), (2000, 1920)), 1.0),
            Some(Size::new(1884, 1920))
        );
    }

    #[test]
    fn a_display_too_short_to_hold_the_minimum_is_left_alone() {
        assert_eq!(
            fitted_inner_size(&geometry((2880, 700), (2000, 1976), (2000, 1920)), 2.0),
            None
        );
    }

    #[test]
    fn a_bogus_scale_factor_falls_back_to_one() {
        assert_eq!(
            fitted_inner_size(&geometry((1900, 2200), (2000, 1976), (2000, 1920)), 0.0),
            Some(Size::new(1884, 1920))
        );
    }

    #[test]
    fn a_14_inch_mac_is_shortened_to_its_work_area() {
        // 14-inch MacBook Pro at 2x: 1512x982 points, 25-point menu bar. The
        // frame makes the window 988 points tall, 31 more than the work area,
        // so the footer's lower edge was clipped there too.
        assert_eq!(
            fitted_inner_size(&geometry((3024, 1914), (2000, 1976), (2000, 1920)), 2.0),
            Some(Size::new(2000, 1826))
        );
    }
}
