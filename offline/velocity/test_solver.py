"""solve_velocity_profile against synthetic geometry with known analytic curvature."""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest

from offline.geometry.raceline import RacelineGeometry
from offline.velocity.solver import lateral_speed_cap_mps, solve_velocity_profile
from offline.velocity.vehicle import DEFAULT_GT3


def _circle_geometry(radius: float, n: int = 200) -> RacelineGeometry:
    theta = np.linspace(0.0, 2 * np.pi, n + 1)
    return RacelineGeometry(
        circuit_name="TestCircle",
        source_path=Path("synthetic"),
        spacing_m=radius * theta[1],
        gps_noise_std_m=0.0,
        smoothing_factor=0.0,
        s_m=radius * theta,
        x_m=radius * np.cos(theta),
        y_m=radius * np.sin(theta),
        z_m=np.zeros(n + 1),
        heading_rad=theta + np.pi / 2,
        kappa_1pm=np.full(n + 1, 1.0 / radius),
    )


def _stadium_geometry(radius: float, straight_length: float, spacing: float = 1.0) -> RacelineGeometry:
    half_l = straight_length / 2
    arc_length = np.pi * radius
    perimeter = 2 * straight_length + 2 * arc_length
    n_segments = round(perimeter / spacing)
    s = np.linspace(0.0, perimeter, n_segments + 1)

    x, y, kappa, heading = (np.empty_like(s) for _ in range(4))
    for i, si in enumerate(s):
        if si < straight_length:
            x[i], y[i], kappa[i], heading[i] = -half_l + si, -radius, 0.0, 0.0
        elif si < straight_length + arc_length:
            a = (si - straight_length) / radius - np.pi / 2
            x[i], y[i] = half_l + radius * np.cos(a), radius * np.sin(a)
            kappa[i], heading[i] = 1.0 / radius, a + np.pi / 2
        elif si < 2 * straight_length + arc_length:
            d = si - (straight_length + arc_length)
            x[i], y[i], kappa[i], heading[i] = half_l - d, radius, 0.0, np.pi
        else:
            a = (si - (2 * straight_length + arc_length)) / radius + np.pi / 2
            x[i], y[i] = -half_l + radius * np.cos(a), radius * np.sin(a)
            kappa[i], heading[i] = 1.0 / radius, a + np.pi / 2

    return RacelineGeometry(
        circuit_name="TestStadium",
        source_path=Path("synthetic"),
        spacing_m=spacing,
        gps_noise_std_m=0.0,
        smoothing_factor=0.0,
        s_m=s,
        x_m=x,
        y_m=y,
        z_m=np.zeros_like(s),
        heading_rad=heading,
        kappa_1pm=kappa,
    )


def test_constant_curvature_circle_holds_the_closed_form_cap_speed() -> None:
    # a perfect circle has no local speed minimum to trigger the forward/backward passes --
    # this is a known idealization shared with TUM's own algorithm (their initial ggv-based
    # estimate behaves identically on constant-curvature input), not a bug in this port.
    radius = 60.0
    geom = _circle_geometry(radius)
    profile = solve_velocity_profile(geom, DEFAULT_GT3)

    expected = lateral_speed_cap_mps(np.array([1.0 / radius]), DEFAULT_GT3)[0]
    assert np.allclose(profile.v_mps, expected, rtol=1e-6)
    assert np.all(profile.phase == "coast")


def test_stadium_brakes_before_the_tight_turn_and_accelerates_after() -> None:
    radius = 15.0
    geom = _stadium_geometry(radius, straight_length=1500.0, spacing=1.0)
    profile = solve_velocity_profile(geom, DEFAULT_GT3)

    assert "brake" in profile.phase
    assert "accel" in profile.phase
    assert "coast" in profile.phase

    corner_cap = lateral_speed_cap_mps(np.array([1.0 / radius]), DEFAULT_GT3)[0]
    assert np.min(profile.v_mps) == pytest.approx(corner_cap, rel=0.05)

    # a 1500 m straight is long enough to reach top speed before braking for the next corner
    assert np.max(profile.v_mps) == pytest.approx(DEFAULT_GT3.v_top_mps, rel=0.05)

    assert profile.lap_time_s > 0.0
    assert profile.v_mps[0] == pytest.approx(profile.v_mps[-1])
