"""orchestrates parse -> fit -> resample -> curvature -> widths -> validate -> boundaries.

build_track() is a pure function: no filesystem output. All I/O (JSON, PNG) belongs in the
CLI (offline/build_track.py), so this stays trivially unit-testable.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import numpy as np
from scipy.interpolate import splev

from offline.geometry.boundaries import offset_boundary
from offline.geometry.curvature import curvature_from_derivatives
from offline.geometry.resample import resample_by_arc_length
from offline.geometry.spline import fit_closed_centerline_spline
from offline.geometry.widths import resample_widths
from offline.ingest.tumftm import RawTrack, parse_tumftm_csv
from offline.validation.checks import assert_loop_closes, assert_no_normal_crossings


@dataclass(frozen=True)
class TrackGeometry:
    circuit_name: str
    source_path: Path
    spacing_m: float
    gps_noise_std_m: float
    smoothing_factor: float
    s_m: np.ndarray
    x_m: np.ndarray
    y_m: np.ndarray
    heading_rad: np.ndarray
    kappa_1pm: np.ndarray
    w_tr_left_m: np.ndarray
    w_tr_right_m: np.ndarray
    boundary_left_x_m: np.ndarray
    boundary_left_y_m: np.ndarray
    boundary_right_x_m: np.ndarray
    boundary_right_y_m: np.ndarray

    @property
    def loop_length_m(self) -> float:
        return float(self.s_m[-1])

    @property
    def n_points(self) -> int:
        return len(self.s_m)

    def to_json_dict(self) -> dict:
        centerline_points = np.column_stack([self.x_m, self.y_m])
        loop_closure_gap_m = float(np.linalg.norm(centerline_points[0] - centerline_points[-1]))
        return {
            "schema_version": 1,
            "meta": {
                "circuit_name": self.circuit_name,
                "source": str(self.source_path),
                "source_license": "TUMFTM/racetrack-database, LGPL-3.0",
                "resample_spacing_m": self.spacing_m,
                "actual_spacing_m": self.loop_length_m / (self.n_points - 1),
                "gps_noise_std_m": self.gps_noise_std_m,
                "smoothing_factor_s": self.smoothing_factor,
                "spline_degree": 3,
                "n_points": self.n_points,
                "loop_length_m": self.loop_length_m,
                "loop_closure_gap_m": loop_closure_gap_m,
            },
            "centerline": {
                "s_m": self.s_m.tolist(),
                "x_m": self.x_m.tolist(),
                "y_m": self.y_m.tolist(),
                "heading_rad": self.heading_rad.tolist(),
                "kappa_1pm": self.kappa_1pm.tolist(),
            },
            "width": {
                "w_tr_left_m": self.w_tr_left_m.tolist(),
                "w_tr_right_m": self.w_tr_right_m.tolist(),
            },
            "boundary_left": {
                "x_m": self.boundary_left_x_m.tolist(),
                "y_m": self.boundary_left_y_m.tolist(),
            },
            "boundary_right": {
                "x_m": self.boundary_right_x_m.tolist(),
                "y_m": self.boundary_right_y_m.tolist(),
            },
        }


def build_track(
    csv_path: Path,
    circuit_name: str,
    spacing_m: float = 1.0,
    gps_noise_std_m: float = 0.1,
    loop_closure_tol_m: float = 1e-3,
) -> TrackGeometry:
    """parse a TUMFTM CSV and produce validated track geometry, or raise.

    hard gates (assert_loop_closes, assert_no_normal_crossings) run before any boundary or
    output is built -- a failing run must never produce output that looks successful.
    """
    raw: RawTrack = parse_tumftm_csv(csv_path, circuit_name)

    median_spacing = float(np.median(np.hypot(np.diff(raw.x_m), np.diff(raw.y_m))))
    closing_gap = float(np.hypot(raw.x_m[0] - raw.x_m[-1], raw.y_m[0] - raw.y_m[-1]))
    if closing_gap > 5 * median_spacing:
        raise ValueError(
            f"raw start/end gap ({closing_gap:.2f} m) is far larger than the median raw "
            f"point spacing ({median_spacing:.2f} m); this may not be a simple closed loop"
        )

    n_points = len(raw.x_m)
    smoothing_factor = n_points * gps_noise_std_m**2
    spline = fit_closed_centerline_spline(raw.x_m, raw.y_m, smoothing_factor)

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

    w_left, w_right = resample_widths(
        raw.x_m, raw.y_m, raw.w_tr_left_m, raw.w_tr_right_m, s_m, s_m[-1]
    )

    assert_loop_closes(centerline, tol=loop_closure_tol_m)
    assert_no_normal_crossings(kappa, w_left, w_right)

    boundary_left = offset_boundary(centerline, unit_tangents, w_left, side="left")
    boundary_right = offset_boundary(centerline, unit_tangents, w_right, side="right")

    return TrackGeometry(
        circuit_name=circuit_name,
        source_path=csv_path,
        spacing_m=spacing_m,
        gps_noise_std_m=gps_noise_std_m,
        smoothing_factor=smoothing_factor,
        s_m=s_m,
        x_m=centerline[:, 0],
        y_m=centerline[:, 1],
        heading_rad=heading_rad,
        kappa_1pm=kappa,
        w_tr_left_m=w_left,
        w_tr_right_m=w_right,
        boundary_left_x_m=boundary_left[:, 0],
        boundary_left_y_m=boundary_left[:, 1],
        boundary_right_x_m=boundary_right[:, 0],
        boundary_right_y_m=boundary_right[:, 1],
    )
