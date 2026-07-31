"""build a validated racing line from the minimum-curvature QP's solved lateral offsets.

mirrors offline/geometry/pipeline.py's build_track() structure once past the QP solve: raw
offset points get refit with a closed spline and resampled by arc length exactly like a fresh
centerline, since offsetting a uniformly-arc-length-spaced curve does not itself produce a
uniformly-spaced result.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import numpy as np
from scipy.interpolate import splev

from offline.geometry.curvature import curvature_from_derivatives
from offline.geometry.pipeline import TrackGeometry
from offline.geometry.resample import resample_by_arc_length
from offline.geometry.spline import fit_closed_centerline_spline
from offline.mincurv.qp import solve_lateral_offsets
from offline.validation.checks import assert_loop_closes, assert_within_track_bounds


@dataclass(frozen=True)
class OptimizedLine:
    circuit_name: str
    source_path: Path
    spacing_m: float
    margin_m: float
    s_m: np.ndarray
    x_m: np.ndarray
    y_m: np.ndarray
    heading_rad: np.ndarray
    kappa_1pm: np.ndarray
    lateral_offset_m: np.ndarray

    @property
    def loop_length_m(self) -> float:
        return float(self.s_m[-1])

    @property
    def n_points(self) -> int:
        return len(self.s_m)

    def to_json_dict(self) -> dict:
        return {
            "schema_version": 1,
            "meta": {
                "circuit_name": self.circuit_name,
                "source": str(self.source_path),
                "method": "minimum-curvature QP over Frenet-frame lateral offsets",
                "margin_m": self.margin_m,
                "resample_spacing_m": self.spacing_m,
                "n_points": self.n_points,
                "loop_length_m": self.loop_length_m,
            },
            "line": {
                "s_m": self.s_m.tolist(),
                "x_m": self.x_m.tolist(),
                "y_m": self.y_m.tolist(),
                "heading_rad": self.heading_rad.tolist(),
                "kappa_1pm": self.kappa_1pm.tolist(),
                "lateral_offset_m": self.lateral_offset_m.tolist(),
            },
        }


def build_mincurv_line(
    track: TrackGeometry,
    margin_m: float = 1.0,
    spacing_m: float = 1.0,
    loop_closure_tol_m: float = 1e-3,
    qp_spacing_m: float = 5.0,
) -> OptimizedLine:
    """solve the minimum-curvature QP on track and return a validated racing line, or raise.

    hard gates (assert_loop_closes, assert_within_track_bounds) run before the result is
    returned -- a failing solve must never produce output that looks successful.
    """
    alpha = solve_lateral_offsets(track, margin_m, qp_spacing_m)

    normal_x = -np.sin(track.heading_rad)
    normal_y = np.cos(track.heading_rad)
    raw_x = track.x_m + alpha * normal_x
    raw_y = track.y_m + alpha * normal_y

    # raw_x/raw_y are already closed-duplicate (raw_x[-1] == raw_x[0]); the spline fitter
    # duplicates the seam itself, so drop our duplicate before handing points over.
    smoothing_factor = 0.0
    spline = fit_closed_centerline_spline(raw_x[:-1], raw_y[:-1], smoothing_factor)

    u_resampled, s_m = resample_by_arc_length(spline, spacing_m)

    centerline = np.column_stack(splev(u_resampled, spline.tck, der=0))
    d1 = np.column_stack(splev(u_resampled, spline.tck, der=1))
    d2 = np.column_stack(splev(u_resampled, spline.tck, der=2))

    if not (np.all(np.isfinite(centerline)) and np.all(np.isfinite(d1)) and np.all(np.isfinite(d2))):
        raise ValueError("non-finite values in fitted spline evaluation")

    speed = np.hypot(d1[:, 0], d1[:, 1])
    unit_tangents = d1 / speed[:, None]
    heading_rad = np.arctan2(unit_tangents[:, 1], unit_tangents[:, 0])
    kappa = curvature_from_derivatives(d1[:, 0], d1[:, 1], d2[:, 0], d2[:, 1])

    assert_loop_closes(centerline, tol=loop_closure_tol_m)

    # the refit line has a slightly different arc-length parametrization than track's original
    # grid, so widths/offsets are matched by fractional position around the loop rather than
    # by raw index -- a fine approximation since both describe the same physical circuit.
    old_frac = track.s_m / track.loop_length_m
    new_frac = s_m / s_m[-1]
    lateral_offset_m = np.interp(new_frac, old_frac, alpha, period=1.0)
    w_left_new = np.interp(new_frac, old_frac, track.w_tr_left_m, period=1.0)
    w_right_new = np.interp(new_frac, old_frac, track.w_tr_right_m, period=1.0)

    assert_within_track_bounds(lateral_offset_m, w_left_new, w_right_new, margin_m=0.0)

    return OptimizedLine(
        circuit_name=track.circuit_name,
        source_path=track.source_path,
        spacing_m=spacing_m,
        margin_m=margin_m,
        s_m=s_m,
        x_m=centerline[:, 0],
        y_m=centerline[:, 1],
        heading_rad=heading_rad,
        kappa_1pm=kappa,
        lateral_offset_m=lateral_offset_m,
    )
