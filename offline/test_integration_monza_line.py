"""end-to-end minimum-curvature path solve against the real vendored Monza track + raceline.

automated form of M3's DESIGN_NOTES.md deliverable: our own line vs TUM's, with lateral
deviation (metres) and lap-time delta (seconds) as numbers, not a screenshot. No test asserts
our line must beat TUM's lap time -- the deliverable is an honest quantified comparison.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest

from offline.geometry.pipeline import build_track
from offline.geometry.raceline import build_raceline_geometry
from offline.mincurv.line import build_mincurv_line
from offline.validation.checks import (
    assert_closed_loop_velocity,
    assert_energy_balance,
    lateral_deviation,
)
from offline.velocity.solver import solve_velocity_profile
from offline.velocity.vehicle import DEFAULT_GT3

MONZA_CSV = Path(__file__).resolve().parent.parent / "third_party" / "Monza.csv"
MONZA_RACELINE_CSV = Path(__file__).resolve().parent.parent / "third_party" / "Monza_raceline.csv"


@pytest.fixture(scope="module")
def monza_track():
    return build_track(MONZA_CSV, circuit_name="Monza", spacing_m=1.0, gps_noise_std_m=0.1)


@pytest.fixture(scope="module")
def monza_line(monza_track):
    return build_mincurv_line(monza_track, margin_m=1.0, spacing_m=1.0)


@pytest.fixture(scope="module")
def monza_tum_raceline():
    return build_raceline_geometry(MONZA_RACELINE_CSV, circuit_name="Monza")


def test_line_reduces_peak_curvature_vs_centerline(monza_track, monza_line) -> None:
    assert np.max(np.abs(monza_line.kappa_1pm)) < np.max(np.abs(monza_track.kappa_1pm))


def test_lateral_deviation_vs_tum_is_finite_and_plausible(monza_track, monza_line, monza_tum_raceline) -> None:
    deviation = lateral_deviation(
        np.column_stack([monza_line.x_m, monza_line.y_m]),
        np.column_stack([monza_tum_raceline.x_m, monza_tum_raceline.y_m]),
    )
    track_half_width = float(np.max(monza_track.w_tr_left_m + monza_track.w_tr_right_m))
    assert 0.0 < deviation["max_m"] < track_half_width
    assert 0.0 < deviation["mean_m"] < deviation["max_m"]


def test_lap_time_delta_vs_tum_is_finite_and_plausible(monza_line, monza_tum_raceline) -> None:
    our_profile = solve_velocity_profile(monza_line, DEFAULT_GT3)
    tum_profile = solve_velocity_profile(monza_tum_raceline, DEFAULT_GT3)

    for profile in (our_profile, tum_profile):
        assert_closed_loop_velocity(profile.v_mps)
        assert_energy_balance(
            profile.v_mps,
            profile.ax_mps2,
            DEFAULT_GT3.ax_drag_mps2(profile.v_mps),
            DEFAULT_GT3.mass_kg,
            DEFAULT_GT3.power_w,
        )

    lap_time_delta_s = our_profile.lap_time_s - tum_profile.lap_time_s
    assert abs(lap_time_delta_s) < 10.0
