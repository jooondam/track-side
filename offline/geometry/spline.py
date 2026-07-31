"""closed periodic cubic spline fit through a centerline's raw points."""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from scipy.interpolate import splev, splprep


@dataclass(frozen=True)
class ClosedSpline:
    tck: tuple
    smoothing_factor: float
    degree: int = 3


def fit_closed_centerline_spline(
    x_m: np.ndarray, y_m: np.ndarray, smoothing_factor: float
) -> ClosedSpline:
    """fit a closed (periodic) cubic B-spline through [x_m, y_m].

    explicitly duplicates the first point onto the end before calling splprep(per=True).
    scipy's per=True otherwise silently overwrites the last input point with a copy of the
    first to force closure, discarding real geometry at the seam if the raw data isn't
    already pre-closed (TUMFTM's format never is: it's N evenly-spaced points with an
    implied, not literal, wraparound).
    """
    x_closed = np.append(x_m, x_m[0])
    y_closed = np.append(y_m, y_m[0])
    tck, _u = splprep([x_closed, y_closed], per=True, k=3, s=smoothing_factor, quiet=0)
    return ClosedSpline(tck=tck, smoothing_factor=smoothing_factor)


def evaluate_spline(spline: ClosedSpline, u: np.ndarray, der: int = 0) -> np.ndarray:
    """evaluate the spline (or its der-th derivative) at parameter values u, shape (len(u), 2)."""
    return np.column_stack(splev(u, spline.tck, der=der))
