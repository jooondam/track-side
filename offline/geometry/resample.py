"""arc-length parametrization and uniform resampling of a fitted closed spline."""

from __future__ import annotations

import numpy as np
from scipy.integrate import cumulative_trapezoid
from scipy.interpolate import splev

from offline.geometry.spline import ClosedSpline

DENSE_SAMPLE_COUNT = 20_000


def arc_length_table(
    spline: ClosedSpline, n_dense: int = DENSE_SAMPLE_COUNT
) -> tuple[np.ndarray, np.ndarray]:
    """return (u_dense, s_dense): cumulative arc length at n_dense points around the loop.

    s_dense[-1] is the total loop length in metres.
    """
    u_dense = np.linspace(0.0, 1.0, n_dense, endpoint=True)
    dx_du, dy_du = splev(u_dense, spline.tck, der=1)
    speed = np.hypot(dx_du, dy_du)
    if np.any(speed < 1e-9):
        raise ValueError("near-zero spline speed, degenerate or cusp point in fitted centerline")
    s_dense = cumulative_trapezoid(speed, u_dense, initial=0.0)
    return u_dense, s_dense


def resample_by_arc_length(
    spline: ClosedSpline, spacing_m: float
) -> tuple[np.ndarray, np.ndarray]:
    """resample the spline's parameter u at uniform arc-length spacing.

    returns (u_resampled, target_s), each of length n_segments + 1, with the last point an
    exact duplicate of the first. That matches this project's closed-array convention
    (see offline/validation/test_checks.py's circle_points fixture) and keeps
    assert_loop_closes a reliable near-no-op rather than something a correctly resampled
    track would fail on an endpoint-exclusive grid.
    """
    u_dense, s_dense = arc_length_table(spline)
    total_length = s_dense[-1]
    n_segments = round(total_length / spacing_m)
    target_s = np.linspace(0.0, total_length, n_segments + 1, endpoint=True)
    u_resampled = np.interp(target_s, s_dense, u_dense)
    u_resampled[-1] = u_resampled[0]
    return u_resampled, target_s
