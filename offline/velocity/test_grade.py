"""grade_channels() and the way gravity composes into the longitudinal budget.

the sign convention here is the single easiest thing in M8 to get wrong, because the backward
pass integrates in the reversed travel direction and the temptation is to flip sin(theta) with
it. these tests pin the convention at the level where an error is still readable, before it
reaches a lap time that merely looks a bit off.
"""

from __future__ import annotations

import numpy as np
import pytest

from offline.velocity.solver import (
    KAPPA_V_SMOOTH_WINDOW_M,
    ax_budget_mps2,
    grade_channels,
    lateral_speed_cap_mps,
)
from offline.velocity.vehicle import DEFAULT_GT3 as V


def _closed_ramp(n: int = 400, length_m: float = 400.0, height_m: float = 20.0):
    """a closed loop that climbs for half a lap and descends for the other half."""
    s = np.linspace(0.0, length_m, n + 1)
    z = height_m * np.sin(2.0 * np.pi * s / length_m)
    z[-1] = z[0]  # closure is exact by construction, never by luck
    return s, z


def test_flat_track_reduces_to_the_pre_m8_geometry() -> None:
    s = np.linspace(0.0, 100.0, 101)
    z = np.zeros_like(s)
    sin_t, cos_t, dl, kappa_v = grade_channels(s, z)

    assert np.allclose(sin_t, 0.0)
    assert np.allclose(cos_t, 1.0)
    assert np.allclose(dl, np.diff(s))
    assert np.allclose(kappa_v, 0.0)


def test_dl_is_the_three_dimensional_segment_length() -> None:
    s, z = _closed_ramp()
    _, _, dl, _ = grade_channels(s, z)
    assert np.allclose(dl, np.hypot(np.diff(s), np.diff(z)))
    # the 3D path is always at least as long as its planar shadow
    assert float(np.sum(dl)) > float(s[-1] - s[0])


def test_sin_theta_times_dl_is_exactly_dz() -> None:
    """the identity the whole closed-loop energy argument rests on.

    theta is deliberately the raw finite difference with no smoothing, so sin(theta)*dl == dz to
    float precision and the gravity term integrates to exactly zero around a lap. smoothing
    theta would break this for no gain.
    """
    s, z = _closed_ramp()
    sin_t, _, dl, _ = grade_channels(s, z)
    assert np.allclose(sin_t * dl, np.diff(z), atol=1e-12)
    assert abs(float(np.sum(sin_t * dl))) < 1e-9


def test_uphill_is_positive_and_downhill_negative() -> None:
    s = np.linspace(0.0, 100.0, 101)
    sin_up, cos_up, _, _ = grade_channels(s, 0.1 * s)
    sin_down, _, _, _ = grade_channels(s, -0.1 * s)

    assert np.all(sin_up > 0.0)
    assert np.all(sin_down < 0.0)
    assert np.all(cos_up > 0.0)  # cos stays positive on any real road
    assert sin_up[0] == pytest.approx(0.1 / np.hypot(1.0, 0.1))


def test_vertical_curvature_is_positive_in_a_compression_negative_over_a_crest() -> None:
    s, z = _closed_ramp()
    _, _, _, kappa_v = grade_channels(s, z)
    # z = h*sin(2*pi*s/L): the crest sits at a quarter lap, the compression at three quarters
    crest = len(kappa_v) // 4
    valley = 3 * len(kappa_v) // 4

    assert kappa_v[crest] < 0.0
    assert kappa_v[valley] > 0.0
    # d2z/ds2 of the analytic shape, which kappa_v approximates for small theta
    expected = (2.0 * np.pi / 400.0) ** 2 * 20.0
    assert abs(kappa_v[valley]) == pytest.approx(expected, rel=0.15)


def test_vertical_curvature_smoothing_has_no_seam_at_the_start_line() -> None:
    """the boxcar wraps, so s = 0 is not a discontinuity.

    a non-circular smoother leaves a step exactly at the point the closed-loop boundary
    condition is enforced, which is the worst possible place for one.
    """
    s, z = _closed_ramp(n=800, length_m=800.0)
    _, _, _, kappa_v = grade_channels(s, z)
    wrapped = np.concatenate([kappa_v[-5:], kappa_v[:5]])
    # no jump across the seam larger than the typical step elsewhere in the array
    assert float(np.max(np.abs(np.diff(wrapped)))) <= 3.0 * float(
        np.max(np.abs(np.diff(kappa_v)))
    )


def test_smoothing_window_is_wide_enough_to_tame_a_second_derivative() -> None:
    # kappa_v is d(theta)/ds off an already-smoothed z; the window is what stops the ~1e-4 m
    # quantisation in the shipped geometry showing up as hundreds of newtons of axle load
    assert KAPPA_V_SMOOTH_WINDOW_M >= 15.0


def test_non_increasing_s_is_rejected() -> None:
    s = np.array([0.0, 1.0, 1.0, 2.0])
    with pytest.raises(ValueError, match="strictly increasing"):
        grade_channels(s, np.zeros_like(s))


def test_gravity_opposes_the_climb_in_the_forward_pass() -> None:
    v, kappa_abs = 50.0, 0.0
    sin_up, sin_down = 0.1, -0.1
    cos_t = float(np.sqrt(1.0 - 0.1**2))

    level = ax_budget_mps2(v, kappa_abs, V, "accel_forw", 0.0, 1.0)
    uphill = ax_budget_mps2(v, kappa_abs, V, "accel_forw", sin_up, cos_t)
    downhill = ax_budget_mps2(v, kappa_abs, V, "accel_forw", sin_down, cos_t)

    assert uphill < level < downhill
    # the whole difference is g*sin(theta) either side of level, to within the cos(theta) that
    # rides along on the normal load
    assert level - uphill == pytest.approx(V.g_mps2 * sin_up, rel=0.05)


def test_gravity_helps_you_slow_going_uphill_in_the_backward_pass() -> None:
    """the sign that has no extra flip in the reversed indexing.

    the backward pass walks the array in reverse but the physics is still stated in the true
    travel direction: on an uphill approach gravity adds to the braking budget, on a downhill
    sin(theta) is already negative and subtracts. flipping the sign to match the reversed loop
    is the classic M8 bug and it produces a car that brakes better downhill.
    """
    v, kappa_abs = 50.0, 0.0
    cos_t = float(np.sqrt(1.0 - 0.1**2))

    level = ax_budget_mps2(v, kappa_abs, V, "decel_backw", 0.0, 1.0)
    uphill = ax_budget_mps2(v, kappa_abs, V, "decel_backw", 0.1, cos_t)
    downhill = ax_budget_mps2(v, kappa_abs, V, "decel_backw", -0.1, cos_t)

    assert uphill > level > downhill
    assert uphill - level == pytest.approx(V.g_mps2 * 0.1, rel=0.05)


def test_grade_enters_the_loads_through_ax_tyre_even_at_zero_net_acceleration() -> None:
    """a car held at constant speed on a slope still transfers load.

    ax_tyre is the tyres' own longitudinal acceleration, not the vehicle's net acceleration, so
    holding station on a downhill means braking against gravity and loading the front axle. a
    model driven by net accel would show nothing here, which is why the transfer is written
    against ax_tyre throughout.
    """
    # 20 m/s, not a high speed: past about 39 m/s drag alone exceeds a 10% slope's 0.98 m/s2
    # and the car needs throttle to hold station rather than brakes
    v = 20.0
    sin_down = -0.1
    # net accel zero: the tyres supply exactly enough to fight gravity and drag
    ax_tyre = V.g_mps2 * sin_down + float(V.ax_drag_mps2(v))
    fz_front, _ = V.axle_loads_n(v, ax_tyre, sin_down, float(np.sqrt(1 - 0.01)))
    level_front, _ = V.axle_loads_n(v, 0.0)

    assert ax_tyre < 0.0
    assert fz_front > level_front


def test_a_compression_raises_the_cornering_speed_cap() -> None:
    kappa = np.array([0.01, 0.01, 0.01])
    flat = lateral_speed_cap_mps(kappa, V, np.zeros(3), np.ones(3), np.zeros(3))
    valley = lateral_speed_cap_mps(kappa, V, np.zeros(3), np.ones(3), np.full(3, 0.002))
    crest = lateral_speed_cap_mps(kappa, V, np.zeros(3), np.ones(3), np.full(3, -0.002))

    assert np.all(valley > flat)
    assert np.all(crest < flat)


def test_the_speed_cap_is_finite_on_a_straight() -> None:
    # load sensitivity makes grip grow like v^1.8 rather than v^2, so a finite root always
    # exists; before M8 a straight was a degenerate case needing its own branch
    cap = lateral_speed_cap_mps(np.array([0.0]), V)
    assert np.isfinite(cap[0])
    assert cap[0] == pytest.approx(V.v_top_mps)


def test_the_speed_cap_is_an_upper_bound_on_the_achievable_lateral_accel() -> None:
    kappa = np.array([0.002, 0.006, 0.015, 0.03])
    cap = lateral_speed_cap_mps(kappa, V)
    ay_used = cap**2 * kappa
    ay_available = V.ay_max_mps2(cap)
    # the fixed point converges from above, so the cap sits at or just inside the limit
    assert np.all(ay_used <= ay_available * 1.001)
