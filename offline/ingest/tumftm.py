"""parse TUMFTM racetrack-database CSV format: x_m, y_m, w_tr_right_m, w_tr_left_m."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import numpy as np


@dataclass(frozen=True)
class RawTrack:
    x_m: np.ndarray
    y_m: np.ndarray
    w_tr_right_m: np.ndarray
    w_tr_left_m: np.ndarray
    circuit_name: str
    source_path: Path


def parse_tumftm_csv(csv_path: Path, circuit_name: str) -> RawTrack:
    """load a TUMFTM-format centerline CSV, rejecting rows that would break spline fitting."""
    data = np.loadtxt(csv_path, delimiter=",", comments="#")
    if data.ndim != 2 or data.shape[1] != 4:
        raise ValueError(
            f"expected 4 columns (x_m,y_m,w_tr_right_m,w_tr_left_m), got shape {data.shape}"
        )

    x_m, y_m, w_tr_right_m, w_tr_left_m = data.T

    if not np.all(np.isfinite(data)):
        raise ValueError(f"non-finite values in {csv_path}")

    if np.any(w_tr_left_m <= 0) or np.any(w_tr_right_m <= 0):
        raise ValueError("non-positive track width encountered")

    segment_lengths = np.hypot(np.diff(x_m), np.diff(y_m))
    if np.any(segment_lengths < 1e-6):
        raise ValueError("coincident consecutive raw points, degenerate for spline parametrization")

    return RawTrack(x_m, y_m, w_tr_right_m, w_tr_left_m, circuit_name, csv_path)
