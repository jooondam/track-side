"""parse TUMFTM racetrack-database raceline CSV format: x_m, y_m only.

mirrors offline/ingest/tumftm.py's guards, minus the width columns a bare raceline doesn't have.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import numpy as np


@dataclass(frozen=True)
class RawRaceline:
    x_m: np.ndarray
    y_m: np.ndarray
    circuit_name: str
    source_path: Path


def parse_raceline_csv(csv_path: Path, circuit_name: str) -> RawRaceline:
    """load a TUMFTM-format raceline CSV, rejecting rows that would break spline fitting."""
    data = np.loadtxt(csv_path, delimiter=",", comments="#")
    if data.ndim != 2 or data.shape[1] != 2:
        raise ValueError(f"expected 2 columns (x_m,y_m), got shape {data.shape}")

    x_m, y_m = data.T

    if not np.all(np.isfinite(data)):
        raise ValueError(f"non-finite values in {csv_path}")

    segment_lengths = np.hypot(np.diff(x_m), np.diff(y_m))
    if np.any(segment_lengths < 1e-6):
        raise ValueError("coincident consecutive raw points, degenerate for spline parametrization")

    return RawRaceline(x_m, y_m, circuit_name, csv_path)
