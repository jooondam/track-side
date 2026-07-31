"""build_raceline_geometry: circle sanity check and hard-gate enforcement."""

from __future__ import annotations

import numpy as np
import pytest

from offline.geometry.raceline import build_raceline_geometry

HEADER = "# x_m,y_m\n"


def _circle_csv(tmp_path, radius: float, n: int = 120):
    theta = np.linspace(0, 2 * np.pi, n, endpoint=False)
    x, y = radius * np.cos(theta), radius * np.sin(theta)
    lines = [f"{xi:.6f},{yi:.6f}" for xi, yi in zip(x, y)]
    path = tmp_path / "circle.csv"
    path.write_text(HEADER + "\n".join(lines) + "\n")
    return path


def test_circle_geometry_has_expected_length_and_curvature(tmp_path) -> None:
    radius = 100.0
    csv_path = _circle_csv(tmp_path, radius)
    geom = build_raceline_geometry(csv_path, circuit_name="TestCircle", spacing_m=2.0, gps_noise_std_m=0.0)

    assert geom.loop_length_m == pytest.approx(2 * np.pi * radius, rel=0.01)
    assert geom.kappa_1pm == pytest.approx(1.0 / radius, rel=0.02)
    assert geom.x_m[0] == geom.x_m[-1]
    assert geom.y_m[0] == geom.y_m[-1]


def test_open_gap_raises(tmp_path) -> None:
    # points that don't trace a simple closed loop: a big jump partway through
    x = np.concatenate([np.linspace(0, 10, 20), np.linspace(200, 210, 20)])
    y = np.zeros_like(x)
    lines = [f"{xi:.6f},{yi:.6f}" for xi, yi in zip(x, y)]
    path = tmp_path / "broken.csv"
    path.write_text(HEADER + "\n".join(lines) + "\n")

    with pytest.raises(ValueError, match="may not be a simple closed loop"):
        build_raceline_geometry(path, circuit_name="Broken")
