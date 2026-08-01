"""build a validated racing line from a solved lateral-offset array alpha(s).

mirrors offline/geometry/pipeline.py's build_track() structure once past the offset solve: raw
offset points get refit with a closed spline and resampled by arc length exactly like a fresh
centerline, since offsetting a uniformly-arc-length-spaced curve does not itself produce a
uniformly-spaced result.

build_line_from_offsets is the shared post-solve pipeline -- any solver that produces a full-
resolution alpha(s) array (minimum-curvature, shortest-path, or a grip-weighted blend of the
two) turns it into a validated OptimizedLine through here, so the spline-refit/resample/bounds-
check logic lives in exactly one place.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import numpy as np
from scipy.interpolate import splev

from offline.elevation.profile import ElevationProfile, drape_elevation_onto_path
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
    method: str
    spacing_m: float
    margin_m: float
    s_m: np.ndarray
    x_m: np.ndarray
    y_m: np.ndarray
    z_m: np.ndarray
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
                "method": self.method,
                "margin_m": self.margin_m,
                "resample_spacing_m": self.spacing_m,
                "n_points": self.n_points,
                "loop_length_m": self.loop_length_m,
            },
            "line": {
                "s_m": self.s_m.tolist(),
                "x_m": self.x_m.tolist(),
                "y_m": self.y_m.tolist(),
                "z_m": self.z_m.tolist(),
                "heading_rad": self.heading_rad.tolist(),
                "kappa_1pm": self.kappa_1pm.tolist(),
                "lateral_offset_m": self.lateral_offset_m.tolist(),
            },
        }


def build_line_from_offsets(
    track: TrackGeometry,
    alpha: np.ndarray,
    method: str,
    margin_m: float = 1.0,
    spacing_m: float = 1.0,
    loop_closure_tol_m: float = 1e-3,
    elevation: ElevationProfile | None = None,
) -> OptimizedLine:
    """turn a full-resolution solved lateral-offset array alpha(s) into a validated racing line.

    shared by every offset solver (minimum-curvature, shortest-path, grip-weighted blend) --
    hard gates (assert_loop_closes, assert_within_track_bounds) run before the result is
    returned, a failing solve must never produce output that looks successful.

    elevation, when given, is draped onto the refit arc length here rather than by the caller.
    that used to happen in build_viewer_assets.py, which meant the line the solver ran on and
    the line the viewer drew got their z from two places; since M8 made grade part of the
    physics they have to be the same array, so the drape lives here now.
    """
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

    # draped by physical position rather than by arc-length fraction: the line cuts corners, so
    # its fractional position leads the centerline point it is beside, and sampling by fraction
    # left it hanging below the road surface through every corner on a graded circuit
    z_m = (
        np.zeros_like(s_m)
        if elevation is None
        else drape_elevation_onto_path(centerline[:, 0], centerline[:, 1], track, elevation)
    )

    return OptimizedLine(
        circuit_name=track.circuit_name,
        source_path=track.source_path,
        method=method,
        spacing_m=spacing_m,
        margin_m=margin_m,
        s_m=s_m,
        x_m=centerline[:, 0],
        y_m=centerline[:, 1],
        z_m=z_m,
        heading_rad=heading_rad,
        kappa_1pm=kappa,
        lateral_offset_m=lateral_offset_m,
    )


def build_mincurv_line(
    track: TrackGeometry,
    margin_m: float = 1.0,
    spacing_m: float = 1.0,
    loop_closure_tol_m: float = 1e-3,
    qp_spacing_m: float = 5.0,
    elevation: ElevationProfile | None = None,
) -> OptimizedLine:
    """solve the minimum-curvature QP on track and return a validated racing line, or raise."""
    alpha = solve_lateral_offsets(track, margin_m, qp_spacing_m)
    return build_line_from_offsets(
        track,
        alpha,
        method="minimum-curvature QP over Frenet-frame lateral offsets",
        margin_m=margin_m,
        spacing_m=spacing_m,
        loop_closure_tol_m=loop_closure_tol_m,
        elevation=elevation,
    )
