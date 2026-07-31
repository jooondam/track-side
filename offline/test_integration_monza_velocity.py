"""end-to-end solve_velocity_profile() against the real vendored Monza raceline.

automated form of the M2 sanity checks in docs/DESIGN_NOTES.md section 7: lap time in the
real GT3 band, mu->0 and mu->large behave sanely, energy/power balance, closed loop, and
coast segments actually exist (braking + accel distance != lap distance).
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest

from offline.geometry.raceline import build_raceline_geometry
from offline.validation.checks import assert_closed_loop_velocity, assert_energy_balance
from offline.velocity.solver import solve_velocity_profile
from offline.velocity.vehicle import DEFAULT_GT3, GT3Vehicle

MONZA_RACELINE_CSV = Path(__file__).resolve().parent.parent / "third_party" / "Monza_raceline.csv"


@pytest.fixture(scope="module")
def monza_geometry():
    return build_raceline_geometry(MONZA_RACELINE_CSV, circuit_name="Monza")


def test_lap_time_in_real_gt3_band(monza_geometry) -> None:
    profile = solve_velocity_profile(monza_geometry, DEFAULT_GT3)
    assert 100.0 < profile.lap_time_s < 120.0


def test_closed_loop_and_power_budget_hold(monza_geometry) -> None:
    profile = solve_velocity_profile(monza_geometry, DEFAULT_GT3)
    assert_closed_loop_velocity(profile.v_mps)
    assert_energy_balance(
        profile.v_mps,
        profile.ax_mps2,
        DEFAULT_GT3.ax_drag_mps2(profile.v_mps),
        DEFAULT_GT3.mass_kg,
        DEFAULT_GT3.power_w,
    )


def test_coast_segments_exist(monza_geometry) -> None:
    profile = solve_velocity_profile(monza_geometry, DEFAULT_GT3)
    ds = np.diff(profile.s_m)
    phase_at_segment_start = profile.phase[:-1]

    braking_and_accel_distance = float(
        np.sum(ds[np.isin(phase_at_segment_start, ["brake", "accel"])])
    )
    coast_distance = float(np.sum(ds[phase_at_segment_start == "coast"]))

    assert braking_and_accel_distance < 0.98 * profile.loop_length_m
    assert coast_distance > 0.0


def test_mu_towards_zero_increases_lap_time_and_decreases_top_speed(monza_geometry) -> None:
    mus = [0.5, 0.1, 0.01]
    lap_times = []
    top_speeds = []
    for mu in mus:
        vehicle = GT3Vehicle(mu=mu)
        profile = solve_velocity_profile(monza_geometry, vehicle)
        lap_times.append(profile.lap_time_s)
        top_speeds.append(float(np.max(profile.v_mps)))

    assert lap_times == sorted(lap_times)
    assert top_speeds == sorted(top_speeds, reverse=True)


def test_mu_large_approaches_power_floor_not_zero(monza_geometry) -> None:
    vehicle_100 = GT3Vehicle(mu=100.0)
    vehicle_1000 = GT3Vehicle(mu=1000.0)

    profile_100 = solve_velocity_profile(monza_geometry, vehicle_100)
    profile_1000 = solve_velocity_profile(monza_geometry, vehicle_1000)

    kappa_abs = np.abs(monza_geometry.kappa_1pm)
    ay_used = profile_100.v_mps**2 * kappa_abs
    ay_max = vehicle_100.ay_max_mps2(profile_100.v_mps)
    assert np.max(ay_used / ay_max) < 0.5  # grip is nowhere close to binding

    rel_diff = abs(profile_100.lap_time_s - profile_1000.lap_time_s) / profile_100.lap_time_s
    assert rel_diff < 0.01  # bottomed out at the power/drag floor, not still improving
