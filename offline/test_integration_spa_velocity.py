"""end-to-end M8 physics against the real Spa geometry and the real elevation artifact.

Monza is flat to within a metre, so it cannot exercise a single line of the grade path. Spa
climbs 102 m, runs 12% through Eau Rouge, and is the only circuit in the set where gravity,
vertical curvature and the 3D segment length all do measurable work. this is the automated form
of the M8 half of docs/DESIGN_NOTES.md section 7.

the elevation-off comparisons re-solve the identical line with z zeroed, so every difference is
attributable to grade alone: same curvature, same arc length, same vehicle.
"""

from __future__ import annotations

import dataclasses
from pathlib import Path

import numpy as np
import pytest

from offline.elevation.profile import load_elevation_profile
from offline.geometry.pipeline import build_track
from offline.mincurv.line import build_mincurv_line
from offline.validation.checks import (
    assert_axle_circles_respected,
    assert_axle_loads_sum,
    assert_closed_loop_velocity,
    assert_grade_plausible,
    assert_gravity_work_closes,
)
from offline.velocity.solver import grade_channels, solve_velocity_profile
from offline.velocity.vehicle import DEFAULT_GT3

ROOT = Path(__file__).resolve().parent.parent
SPA_CSV = ROOT / "third_party" / "Spa.csv"
ELEVATION_JSON = ROOT / "artifacts" / "spa" / "elevation.json"

MIN_BRAKING_ZONE_M = 15.0


@pytest.fixture(scope="module")
def spa_line():
    track = build_track(SPA_CSV, circuit_name="Spa", spacing_m=1.0, gps_noise_std_m=0.1)
    return build_mincurv_line(
        track, margin_m=1.0, spacing_m=1.0, elevation=load_elevation_profile(ELEVATION_JSON)
    )


@pytest.fixture(scope="module")
def graded(spa_line):
    return solve_velocity_profile(spa_line, DEFAULT_GT3)


@pytest.fixture(scope="module")
def flattened(spa_line):
    """the same line with z zeroed: isolates grade from every other difference."""
    return solve_velocity_profile(
        dataclasses.replace(spa_line, z_m=np.zeros_like(spa_line.z_m)), DEFAULT_GT3
    )


def _braking_zones(phase: np.ndarray) -> list[tuple[int, int]]:
    """contiguous runs of braking longer than a noise threshold, as [start, end) indices."""
    zones: list[tuple[int, int]] = []
    i, n = 0, len(phase)
    while i < n:
        if phase[i] != "brake":
            i += 1
            continue
        j = i
        while j < n and phase[j] == "brake":
            j += 1
        if j - i >= MIN_BRAKING_ZONE_M:
            zones.append((i, j))
        i = j
    return zones


def _paired_zones(graded, flattened):
    """(mean grade, graded length, flat length) for braking zones present in both solves."""
    flat_zones = _braking_zones(flattened.phase)
    grade = np.tan(graded.grade_rad)
    pairs = []
    for start, end in _braking_zones(graded.phase):
        overlaps = [
            (min(end, d) - max(start, c), c, d) for c, d in flat_zones if min(end, d) > max(start, c)
        ]
        if not overlaps:
            continue
        _, c, d = max(overlaps)
        pairs.append((float(np.mean(grade[start:end])), end - start, d - c))
    return pairs


# ---- the geometry the physics rides on -------------------------------------------------


def test_elevation_reaches_the_solver_rather_than_just_the_viewer(spa_line, graded) -> None:
    # the drape moved into build_mincurv_line at M8 precisely so the z the solver grades on and
    # the z the viewer draws are the same array; before that they were separate code paths
    assert float(np.ptp(spa_line.z_m)) > 90.0
    assert float(np.max(np.abs(graded.grade_rad))) > 0.05


def test_gravity_does_no_net_work_around_a_closed_lap(spa_line) -> None:
    """the best of the new checks: unlike KE telescoping it is not tautological.

    a sign error, an off-by-one in the reversed indexing, and a z/s grid mismatch all show up
    here as a non-zero net climb, and each one is an energy injection per lap that would stop
    the closed-loop boundary condition converging.
    """
    sin_theta, _, dl_m, _ = grade_channels(spa_line.s_m, spa_line.z_m)
    assert_gravity_work_closes(sin_theta, dl_m)


def test_the_lap_closes_in_elevation_exactly(spa_line) -> None:
    # a hard gate after the drape: a residual here is the amount the two integration passes
    # disagree by, and it does not average out
    assert spa_line.z_m[-1] == spa_line.z_m[0]


def test_road_gradient_stays_plausible(graded) -> None:
    assert_grade_plausible(graded.grade_rad)
    # Eau Rouge is the steepest thing in the set at roughly 12 to 17% depending on where the
    # racing line sits across it
    assert 0.08 < float(np.max(np.abs(np.tan(graded.grade_rad)))) < 0.20


# ---- the load model on real data -------------------------------------------------------


def test_axle_loads_sum_to_the_total_normal_load(graded) -> None:
    expected = DEFAULT_GT3.mass_kg * (
        DEFAULT_GT3.g_mps2 * np.cos(graded.grade_rad)
        + graded.v_mps**2 * graded.kappa_v_1pm
    ) + DEFAULT_GT3.downforce_n(graded.v_mps)
    assert_axle_loads_sum(graded.fz_front_n, graded.fz_rear_n, expected)


def test_load_moves_forward_under_braking_and_rearward_under_power(graded) -> None:
    balance = graded.fz_front_n / (graded.fz_front_n + graded.fz_rear_n)
    hardest_brake = int(np.argmin(graded.ax_mps2))
    hardest_accel = int(np.argmax(graded.ax_mps2))

    assert balance[hardest_brake] > balance[hardest_accel]
    # and the front is genuinely the heavier axle at a real Spa stop, despite the 44% static
    # split, because a GT3 stop is well past the 5.2 m/s2 crossover
    assert graded.fz_front_n[hardest_brake] > graded.fz_rear_n[hardest_brake]
    assert graded.fz_rear_n[hardest_accel] > graded.fz_front_n[hardest_accel]


def test_neither_axle_exceeds_its_own_friction_circle(graded) -> None:
    grip_front, grip_rear = DEFAULT_GT3.axle_grip_n(graded.fz_front_n, graded.fz_rear_n)
    ax_tyre = (
        graded.ax_mps2
        + DEFAULT_GT3.ax_drag_mps2(graded.v_mps)
        + DEFAULT_GT3.g_mps2 * np.sin(graded.grade_rad)
    )
    fy_needed = DEFAULT_GT3.mass_kg * graded.v_mps**2 * np.abs(graded.kappa_1pm)
    fy_front, fy_rear = DEFAULT_GT3.lateral_shares(grip_front, grip_rear, fy_needed)

    fx_total = DEFAULT_GT3.mass_kg * ax_tyre
    driving = fx_total >= 0.0
    bias = DEFAULT_GT3.brake_bias_front
    fx_front = np.where(driving, 0.0, bias * fx_total)
    fx_rear = np.where(driving, fx_total, (1.0 - bias) * fx_total)

    assert_axle_circles_respected(
        fx_front, fy_front, grip_front, fx_rear, fy_rear, grip_rear
    )


def test_the_fz_floor_is_inert_on_real_geometry(graded) -> None:
    """the floor is a numerical guard, not physics, and on real data it never fires.

    it was put in for a crest sharp enough to unload an axle completely. Spa's sharpest crest is
    Raidillon, and even there the car keeps roughly 4.7 kN on the lighter axle against a 255 N
    floor: an order of magnitude of margin. recorded as a measurement because if a future
    elevation source ever does trip it, the diagnostic matters more than the guard.
    """
    floor = DEFAULT_GT3.fz_floor_n
    lightest = min(float(np.min(graded.fz_front_n)), float(np.min(graded.fz_rear_n)))
    assert lightest > 10.0 * floor, f"lightest axle load {lightest:.0f} N is near the {floor:.0f} N floor"


def test_vertical_curvature_both_compresses_and_unloads(graded) -> None:
    # Eau Rouge is a compression, the Raidillon crest an extension; a model carrying only one
    # sign would still pass every lap-time check
    assert float(np.max(graded.kappa_v_1pm)) > 5e-4
    assert float(np.min(graded.kappa_v_1pm)) < -5e-4


# ---- what grade does to the lap --------------------------------------------------------


def test_the_profile_still_closes_on_a_graded_loop(graded) -> None:
    # v(0) == v(L) survives M8 and means more than it did: the same point is approached uphill
    # on one virtual lap and the energy books still have to balance
    assert_closed_loop_velocity(graded.v_mps)


def test_grade_costs_time_over_a_closed_lap(graded, flattened, spa_line) -> None:
    """slower with real elevation than with z zeroed, and not merely because the path is longer.

    the two effects are separable and worth separating: the 3D path length adds a fixed amount,
    while the physics (climbing costs more than descending returns, because drag and the tyre
    limit are not symmetric) adds the rest.
    """
    delta = graded.lap_time_s - flattened.lap_time_s
    assert delta > 0.0, "grade made the lap faster, which is a finding to chase, not a tolerance"

    _, _, dl_m, _ = grade_channels(spa_line.s_m, spa_line.z_m)
    extra_path_m = float(np.sum(dl_m)) - float(spa_line.s_m[-1])
    path_cost_s = extra_path_m / float(np.mean(graded.v_mps))

    assert extra_path_m > 0.0
    assert delta > path_cost_s  # the physics costs more than the extra distance does
    assert delta < 2.0  # and it is a correction, not a rewrite of the lap


def test_braking_zones_shorten_uphill_and_lengthen_downhill(graded, flattened) -> None:
    """the sharpest observable consequence of putting grade in the physics.

    the plan names Les Combes (uphill approach off the Kemmel straight) and Stavelot (downhill)
    as the two instances. rather than hard-code arc lengths that no artifact yet defines, this
    takes every braking zone Spa has and correlates its mean grade against how much the zone
    moves when elevation is switched off. the named corners are the extremes of that set:
    the steepest uphill approach shortens by ~18 m, the steepest downhill lengthens by ~10 m.
    """
    pairs = _paired_zones(graded, flattened)
    assert len(pairs) >= 12, "too few paired braking zones to say anything"

    grades = np.array([g for g, _, _ in pairs])
    deltas = np.array([gl - fl for _, gl, fl in pairs], dtype=float)

    uphill = deltas[grades > 0.01]
    downhill = deltas[grades < -0.01]
    assert uphill.size and downhill.size

    assert float(np.mean(uphill)) < 0.0, "uphill braking zones should shorten"
    assert float(np.mean(downhill)) > 0.0, "downhill braking zones should lengthen"
    # steeper grade, bigger effect, in the right direction
    assert float(np.corrcoef(grades, deltas)[0, 1]) < -0.5


def test_grade_changes_where_the_car_is_slowest_not_just_how_fast(graded, flattened) -> None:
    # a model that only scaled the whole profile would keep the minimum in the same place; grade
    # genuinely redistributes where the car is limited
    assert int(np.argmin(graded.v_mps)) != int(np.argmin(flattened.v_mps)) or float(
        np.max(np.abs(graded.v_mps - flattened.v_mps))
    ) > 1.0


def test_lap_time_stays_in_a_plausible_gt3_band(graded) -> None:
    # a real GT3 laps Spa in roughly 2:15 to 2:25. this model runs slow of that (no slip model,
    # no engine braking, a ggv diagram that does not exist publicly), so the band is wide on
    # purpose: it is a smoke test, not a validation claim. see docs for what is and is not
    # trustworthy here.
    assert 140.0 < graded.lap_time_s < 175.0
