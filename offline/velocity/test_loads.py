"""the M8 two-axle load and grip model, pinned at specified accelerations.

the integration tests exercise this model through a whole velocity profile, where the loads are
evaluated at a finite-difference ax and every quantity is entangled with every other. here each
case fixes ax by hand, so a sign error or a dropped term fails as itself rather than as a lap
time that came out slightly wrong. mirrored by src/solver/vehicle.test.ts.
"""

from __future__ import annotations

import dataclasses

import numpy as np
import pytest

from offline.velocity.solver import LOAD_TRANSFER_ITERS, ax_budget_mps2
from offline.velocity.vehicle import DEFAULT_GT3, GT3Vehicle

V = DEFAULT_GT3
WEIGHT = V.weight_n


def test_static_split_matches_the_weight_distribution() -> None:
    fz_front, fz_rear = V.axle_loads_n(0.0)
    assert fz_front == pytest.approx(V.weight_dist_front * WEIGHT)
    assert fz_rear == pytest.approx((1.0 - V.weight_dist_front) * WEIGHT)


def test_transfer_moves_load_rearward_under_power_and_forward_under_braking() -> None:
    level = V.axle_loads_n(0.0, 0.0)
    accel = V.axle_loads_n(0.0, 5.0)
    brake = V.axle_loads_n(0.0, -5.0)

    assert accel[1] > level[1] and accel[0] < level[0]
    assert brake[0] > level[0] and brake[1] < level[1]


def test_front_outweighs_rear_only_past_the_crossover_deceleration() -> None:
    # at 44% front the rear starts 1530 N up, so the transfer has to clear half of that before
    # the ordering reverses: a real property of a rear-biased car, not a tuned threshold
    crossover = (
        (1.0 - 2.0 * V.weight_dist_front) * WEIGHT * V.wheelbase_m
        / (2.0 * V.mass_kg * V.cg_height_m)
    )
    assert crossover == pytest.approx(5.2, abs=0.1)

    light = V.axle_loads_n(0.0, -(crossover - 1.0))
    hard = V.axle_loads_n(0.0, -12.0)  # a GT3 stop
    assert light[0] < light[1]
    assert hard[0] > hard[1]


def test_transfer_conserves_the_total_normal_load() -> None:
    for ax in (-12.0, -5.0, 0.0, 3.0, 8.0):
        fz_front, fz_rear = V.axle_loads_n(0.0, ax)
        assert fz_front + fz_rear == pytest.approx(WEIGHT)


def test_downforce_carries_no_cos_theta_but_weight_does() -> None:
    v = 60.0
    fd = V.downforce_n(v)
    cos_t = float(np.cos(0.15))

    fz_front, fz_rear = V.axle_loads_n(v, 0.0, 0.0, cos_t)
    # the weight tips with the road, the wings do not: they act normal to the road plane
    assert fz_front + fz_rear == pytest.approx(WEIGHT * cos_t + fd)
    assert fz_front == pytest.approx(
        V.weight_dist_front * WEIGHT * cos_t + V.aero_balance_front * fd
    )


def test_vertical_curvature_compresses_in_a_valley_and_unloads_over_a_crest() -> None:
    v = 70.0
    flat = sum(V.axle_loads_n(v, 0.0, 0.0, 1.0, 0.0))
    valley = sum(V.axle_loads_n(v, 0.0, 0.0, 1.0, 0.0025))
    crest = sum(V.axle_loads_n(v, 0.0, 0.0, 1.0, -0.0025))

    assert valley > flat > crest
    # Eau Rouge scale: m*v^2*kappa_v at 70 m/s over a 400 m vertical radius is over a tonne
    assert valley - flat == pytest.approx(V.mass_kg * v * v * 0.0025)


def test_axle_load_never_falls_below_the_numerical_floor() -> None:
    # a crest steep enough to throw the car off the road; the model is never airborne
    fz_front, fz_rear = V.axle_loads_n(80.0, 0.0, 0.0, 1.0, -0.01)
    assert fz_front >= V.fz_floor_n
    assert fz_rear >= V.fz_floor_n


def test_mu_effective_is_exactly_mu_at_the_reference_condition() -> None:
    """the calibration invariant that keeps the grip slider meaning what it always meant.

    Fz0 is the static axle load, so at rest on the level with no aero every axle sits at its own
    reference, mu_front == mu_rear == mu, and ay_max(0) == mu*g exactly. this is what lets
    test_ay_max_at_zero_speed_is_mu_g survive M8 unchanged.
    """
    assert float(V.ay_max_mps2(0.0)) == pytest.approx(V.mu * V.g_mps2, rel=1e-12)


def test_grip_is_maximal_at_zero_longitudinal_force() -> None:
    """the Jensen bound the lateral speed cap depends on.

    Fz^(1-k) is concave and the transfer conserves the total load, so any transfer strictly
    reduces G_front + G_rear. without this the cap would be an estimate rather than a rigorous
    upper bound, and the whole backward pass would lose its guarantee.
    """
    for v in (0.0, 25.0, 50.0, 75.0):
        at_zero = float(V.ay_max_mps2(v))
        for ax in (-14.0, -8.0, -3.0, 3.0, 8.0, 14.0):
            assert float(V.ay_max_mps2(v, ax)) <= at_zero + 1e-9


def test_an_overloaded_axle_is_less_grippy_per_newton() -> None:
    light_f, light_r = V.axle_loads_n(0.0, -8.0)
    heavy_f, heavy_r = V.axle_loads_n(0.0, 8.0)
    (_, grip_light_r) = V.axle_grip_n(light_f, light_r)
    (_, grip_heavy_r) = V.axle_grip_n(heavy_f, heavy_r)

    assert heavy_r > light_r  # more load under power
    assert grip_heavy_r / heavy_r < grip_light_r / light_r  # but less grip per newton of it


def test_load_sensitivity_makes_grip_grow_slower_than_downforce_alone() -> None:
    v = 50.0
    naive = V.mu * (V.g_mps2 + V.downforce_n(v) / V.mass_kg)
    actual = float(V.ay_max_mps2(v))
    assert actual < naive
    assert actual > 0.9 * naive


def test_three_iterations_is_within_half_a_percent_of_convergence() -> None:
    """justify LOAD_TRANSFER_ITERS by measurement rather than by assertion.

    Fz depends on ax and ax depends on Fz. the transfer path alone contracts at about
    (1-k)*mu*h_cg/wheelbase ~ 0.12, which would put three passes at 0.2%, but the braking branch
    divides the front axle's capacity by brake_bias_front to reach the total, lifting the loop
    gain to ~0.20. measured that way three passes leave 0.8% and four leave 0.14%, which is why
    the constant is 4. this iterates the identical fixed point to convergence and measures the
    gap rather than trusting either estimate.
    """

    def converged_budget(v, kappa_abs, mode, sin_t=0.0, cos_t=1.0, kappa_v=0.0, iters=200):
        vehicle = V
        fy_needed = vehicle.mass_kg * v**2 * kappa_abs
        braking = mode == "decel_backw"
        ax_tyre = 0.0
        for _ in range(iters):
            fz_f, fz_r = vehicle.axle_loads_n(v, ax_tyre, sin_t, cos_t, kappa_v)
            g_f, g_r = vehicle.axle_grip_n(fz_f, fz_r)
            fx_f, fx_r = vehicle.longitudinal_capacity_n(g_f, g_r, fy_needed)
            if braking:
                ax_tyre = -float(vehicle.ax_brake_mps2(fx_f, fx_r))
            else:
                ax_tyre = min(
                    float(vehicle.ax_traction_mps2(fx_f, fx_r)),
                    float(vehicle.ax_engine_mps2(v)),
                )
        ax_drag = float(vehicle.ax_drag_mps2(v))
        ax_grade = vehicle.g_mps2 * sin_t
        return (-ax_tyre if braking else ax_tyre) + (
            ax_drag + ax_grade if braking else -ax_drag - ax_grade
        )

    worst_rel = 0.0
    for v in (15.0, 40.0, 70.0, 90.0):
        for kappa_abs in (0.0, 0.002, 0.008, 0.02):
            for mode in ("accel_forw", "decel_backw"):
                for sin_t in (-0.12, 0.0, 0.12):
                    cos_t = float(np.sqrt(1.0 - sin_t**2))
                    three = ax_budget_mps2(v, kappa_abs, V, mode, sin_t, cos_t, 0.0)
                    exact = converged_budget(v, kappa_abs, mode, sin_t, cos_t)
                    if abs(exact) > 1e-6:
                        worst_rel = max(worst_rel, abs(three - exact) / abs(exact))

    assert LOAD_TRANSFER_ITERS == 4
    assert worst_rel < 0.005, (
        f"{LOAD_TRANSFER_ITERS} iterations leaves {worst_rel * 100:.3f}% residual"
    )


def test_braking_budget_loads_the_front_not_the_rear() -> None:
    """the negation inside the braking branch of the fixed point, tested at its own level.

    drop the minus sign on ax_tyre in decel_backw and the car loads its rear axle under braking,
    which produces a car that brakes harder the harder it brakes. that error survives into a
    plausible-looking lap time, so it needs a test that looks directly at the loads.
    """
    v, kappa_abs = 60.0, 0.004
    ax_brake = ax_budget_mps2(v, kappa_abs, V, "decel_backw")
    # ax_budget returns a positive magnitude; the tyres are producing -ax_brake plus drag
    ax_tyre = -(ax_brake - float(V.ax_drag_mps2(v)))
    fz_front, fz_rear = V.axle_loads_n(v, ax_tyre)
    static_front = V.weight_dist_front * WEIGHT

    assert ax_tyre < 0.0
    assert fz_front > static_front


def test_collapses_onto_the_lumped_circle_when_bias_matches_the_load_split() -> None:
    """M8 is a strict generalisation, not a different model with new tuning constants.

    with no load sensitivity, no aero split and a brake bias equal to the static load split, the
    per-axle circles have to reproduce the single lumped friction circle the pre-M8 solver used.
    """
    lumped = dataclasses.replace(
        DEFAULT_GT3,
        tyre_load_sensitivity=0.0,
        cg_height_m=0.0,  # no transfer, so both axles stay at their static share
        aero_balance_front=DEFAULT_GT3.weight_dist_front,
        brake_bias_front=DEFAULT_GT3.weight_dist_front,
    )
    for v in (20.0, 55.0, 85.0):
        for kappa_abs in (0.0, 0.003, 0.01):
            fy_needed = lumped.mass_kg * v**2 * kappa_abs
            total_grip = lumped.mu * (lumped.weight_n + lumped.downforce_n(v))
            expected = float(
                np.sqrt(max(total_grip**2 - fy_needed**2, 0.0)) / lumped.mass_kg
            )

            fz_f, fz_r = lumped.axle_loads_n(v)
            g_f, g_r = lumped.axle_grip_n(fz_f, fz_r)
            fx_f, fx_r = lumped.longitudinal_capacity_n(g_f, g_r, fy_needed)
            assert float(lumped.ax_brake_mps2(fx_f, fx_r)) == pytest.approx(expected, rel=1e-9)


def test_a_front_driven_car_uses_the_front_axle_for_traction() -> None:
    # drive_axle is a string so AWD stays a data change rather than a code change
    fwd = dataclasses.replace(DEFAULT_GT3, drive_axle="front")
    assert float(fwd.ax_traction_mps2(1000.0, 5000.0)) == pytest.approx(1000.0 / fwd.mass_kg)
    assert float(V.ax_traction_mps2(1000.0, 5000.0)) == pytest.approx(5000.0 / V.mass_kg)


def test_axle_loads_are_vectorised() -> None:
    # called with whole arrays from the solver diagnostics and from mintime; a scalar-only
    # implementation would fail there rather than here
    v = np.linspace(0.0, 80.0, 32)
    ax = np.linspace(-12.0, 8.0, 32)
    fz_front, fz_rear = V.axle_loads_n(v, ax)
    assert fz_front.shape == v.shape and fz_rear.shape == v.shape
    for i in (0, 7, 19, 31):
        one = V.axle_loads_n(float(v[i]), float(ax[i]))
        assert fz_front[i] == pytest.approx(one[0])
        assert fz_rear[i] == pytest.approx(one[1])


def test_a_taller_cg_transfers_more_load() -> None:
    tall = dataclasses.replace(DEFAULT_GT3, cg_height_m=0.35)
    low = dataclasses.replace(DEFAULT_GT3, cg_height_m=0.25)
    assert tall.axle_loads_n(0.0, -8.0)[0] > low.axle_loads_n(0.0, -8.0)[0]


def test_zero_load_sensitivity_reproduces_a_constant_mu() -> None:
    flat_tyre = dataclasses.replace(DEFAULT_GT3, tyre_load_sensitivity=0.0)
    for v in (0.0, 30.0, 70.0):
        expected = flat_tyre.mu * (flat_tyre.weight_n + flat_tyre.downforce_n(v))
        fz_f, fz_r = flat_tyre.axle_loads_n(v)
        assert sum(flat_tyre.axle_grip_n(fz_f, fz_r)) == pytest.approx(expected)


def test_lateral_demand_splits_in_proportion_to_axle_grip() -> None:
    g_f, g_r = 9000.0, 12000.0
    fy_f, fy_r = GT3Vehicle().lateral_shares(g_f, g_r, 15000.0)
    assert fy_f + fy_r == pytest.approx(15000.0)
    assert fy_f / fy_r == pytest.approx(g_f / g_r)
