"""resample per-raw-point track widths onto a new arc-length grid.

widths are measured per original CSV row, not part of the spline fit, so they need their
own periodic parametrization of the raw points, independent of the spline's internal u.
"""

from __future__ import annotations

import numpy as np


def raw_chord_length_fraction(x_m: np.ndarray, y_m: np.ndarray) -> np.ndarray:
    """periodic position fraction [0, 1) of each raw point along the closed loop.

    chord length including the implicit wraparound segment back to the first point.
    deliberately decoupled from the spline's own u parametrization: width is a slowly
    varying physical quantity, so a small mismatch against arc length is immaterial here,
    unlike for curvature.
    """
    d = np.hypot(np.diff(x_m), np.diff(y_m))
    closing = np.hypot(x_m[0] - x_m[-1], y_m[0] - y_m[-1])
    cum = np.concatenate([[0.0], np.cumsum(d)])
    return cum / (cum[-1] + closing)


def resample_widths(
    x_m: np.ndarray,
    y_m: np.ndarray,
    w_left: np.ndarray,
    w_right: np.ndarray,
    target_s: np.ndarray,
    total_length_m: float,
) -> tuple[np.ndarray, np.ndarray]:
    """linearly interpolate left/right widths onto target_s (arc length in metres)."""
    frac = raw_chord_length_fraction(x_m, y_m)
    target_frac = (target_s / total_length_m) % 1.0
    left = np.interp(target_frac, frac, w_left, period=1.0)
    right = np.interp(target_frac, frac, w_right, period=1.0)
    return left, right
