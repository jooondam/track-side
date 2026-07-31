"""end-to-end minimum-time NLP solve against the real vendored Monza track.

automated form of M4's DESIGN_NOTES.md deliverable's offline-reference half: lap time and
friction-circle/track-bounds compliance on real circuit geometry, not a screenshot.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest

casadi = pytest.importorskip("casadi")

from offline.geometry.pipeline import build_track
from offline.geometry.raceline import build_raceline_geometry
from offline.mincurv.qp import build_min_curv_qp
from offline.reference.mintime import solve_mintime
from offline.velocity.solver import solve_velocity_profile
from offline.velocity.vehicle import DEFAULT_GT3

MONZA_CSV = Path(__file__).resolve().parent.parent / "third_party" / "Monza.csv"
MONZA_RACELINE_CSV = Path(__file__).resolve().parent.parent / "third_party" / "Monza_raceline.csv"


@pytest.fixture(scope="module")
def monza_track():
    return build_track(MONZA_CSV, circuit_name="Monza", spacing_m=1.0, gps_noise_std_m=0.1)


@pytest.fixture(scope="module")
def monza_mintime(monza_track):
    # qp_spacing_m=15.0, not solve_mintime's 5.0 default: at Monza's scale (~1150 points at
    # 5m) IPOPT's default scaling struggles with the wide corner-to-straight speed range
    # (~14-79 m/s) and either times out or reports spurious "infeasible" at a few metres/sec of
    # true constraint violation ~1e-8. 15m (~386 points) converges reliably in seconds. The
    # synthetic circle/stadium unit tests in offline/reference/test_mintime.py don't hit this,
    # since their speed range is much narrower, so they keep the 5.0 default.
    #
    # two_stage isn't pinned here, so this reflects solve_mintime's actual default (True) --
    # this fixture is what a real caller gets.
    return solve_mintime(monza_track, DEFAULT_GT3, margin_m=1.0, qp_spacing_m=15.0)


@pytest.fixture(scope="module")
def monza_mintime_single_stage(monza_track):
    # explicit two_stage=False baseline, decoupled from solve_mintime's default so the wiggle
    # comparison test below stays meaningful regardless of what that default is.
    return solve_mintime(monza_track, DEFAULT_GT3, margin_m=1.0, qp_spacing_m=15.0, two_stage=False)


def test_lap_time_in_real_gt3_band(monza_mintime) -> None:
    assert 100.0 < monza_mintime.lap_time_s < 120.0


def test_lap_time_beats_or_matches_tum_raceline_with_our_velocity_solver(monza_mintime) -> None:
    tum_raceline = build_raceline_geometry(MONZA_RACELINE_CSV, circuit_name="Monza")
    tum_profile = solve_velocity_profile(tum_raceline, DEFAULT_GT3)

    # mintime optimizes the path for this exact vehicle; driving TUM's (differently-optimized)
    # raceline with our velocity solver is a plausible baseline it should match or beat, with
    # slack for the coarse NLP grid vs. TUM's full-resolution raceline.
    assert monza_mintime.lap_time_s <= tum_profile.lap_time_s + 3.0


def test_solver_converged(monza_mintime) -> None:
    assert monza_mintime.ipopt_status in {"Solve_Succeeded", "Solved_To_Acceptable_Level"}
    assert np.all(np.isfinite(monza_mintime.v_mps))


def test_two_stage_cuts_straight_section_wiggle_within_tolerance(
    monza_track, monza_mintime, monza_mintime_single_stage
) -> None:
    # empirically (see mintime.py's module docstring), Monza's straight-section wiggle drops
    # ~3x at just 1% lap-time tolerance, unlike the extreme synthetic stadium test which needs
    # much more. This is the real-track validation the two_stage default (now True) reflects.
    _, kappa_ref, _, _, coarse_s = build_min_curv_qp(monza_track, margin_m=1.0, qp_spacing_m=15.0)
    straight_mask = np.abs(kappa_ref) < 5e-4

    baseline_wiggle = np.max(np.abs(np.diff(monza_mintime_single_stage.n_m)[straight_mask[:-1]]))
    smoothed_wiggle = np.max(np.abs(np.diff(monza_mintime.n_m)[straight_mask[:-1]]))

    assert smoothed_wiggle < 0.5 * baseline_wiggle
    assert monza_mintime.lap_time_s <= monza_mintime_single_stage.lap_time_s * 1.01 + 1e-6
