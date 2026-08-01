"""build validated (s, x, y, heading, kappa) geometry for a bare TUMFTM raceline.

mirrors offline/geometry/pipeline.py's build_track() structure -- parse, fit, resample,
curvature, loop-closure gate -- but stops there. A bare raceline has no width columns, so
there is no boundary offset or normal-crossing check to run; TUM's optimizer already kept it
within track boundaries by construction.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import numpy as np
from scipy.interpolate import splev

from offline.geometry.curvature import curvature_from_derivatives
from offline.geometry.resample import resample_by_arc_length
from offline.geometry.spline import fit_closed_centerline_spline
from offline.ingest.raceline import RawRaceline, parse_raceline_csv
from offline.validation.checks import assert_loop_closes


@dataclass(frozen=True)
class RacelineGeometry:
    circuit_name: str
    source_path: Path
    spacing_m: float
    gps_noise_std_m: float
    smoothing_factor: float
    s_m: np.ndarray
    x_m: np.ndarray
    y_m: np.ndarray
    z_m: np.ndarray
    heading_rad: np.ndarray
    kappa_1pm: np.ndarray

    @property
    def loop_length_m(self) -> float:
        return float(self.s_m[-1])

    @property
    def n_points(self) -> int:
        return len(self.s_m)


def build_raceline_geometry(
    csv_path: Path,
    circuit_name: str,
    spacing_m: float = 1.0,
    gps_noise_std_m: float = 0.1,
    loop_closure_tol_m: float = 1e-3,
) -> RacelineGeometry:
    """parse a TUMFTM raceline CSV and produce validated arc-length geometry, or raise."""
    raw: RawRaceline = parse_raceline_csv(csv_path, circuit_name)

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

    assert_loop_closes(centerline, tol=loop_closure_tol_m)

    return RacelineGeometry(
        circuit_name=circuit_name,
        source_path=csv_path,
        spacing_m=spacing_m,
        gps_noise_std_m=gps_noise_std_m,
        smoothing_factor=smoothing_factor,
        s_m=s_m,
        x_m=centerline[:, 0],
        y_m=centerline[:, 1],
        # a bare TUMFTM raceline CSV carries no elevation column, so this geometry is flat by
        # construction. drape a real profile onto it with drape_elevation() if you have one.
        z_m=np.zeros_like(s_m),
        heading_rad=heading_rad,
        kappa_1pm=kappa,
    )
