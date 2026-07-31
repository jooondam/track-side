"""M1 validation harness: hard assertions a track geometry pipeline must satisfy.

written before the geometry pipeline itself (offline/geometry/). the pipeline is
only trusted once every function here passes on its output.
"""

from __future__ import annotations

import numpy as np


def assert_loop_closes(points: np.ndarray, tol: float = 1e-3) -> None:
    """raise if the first and last points of a closed track are not within tol metres."""
    gap = np.linalg.norm(points[0] - points[-1])
    if gap > tol:
        raise AssertionError(
            f"loop does not close: start/end gap is {gap:.4f} m, tolerance is {tol} m"
        )


def assert_no_normal_crossings(
    curvature: np.ndarray,
    left_width: np.ndarray,
    right_width: np.ndarray,
) -> None:
    """raise if normal-offset boundaries self-intersect anywhere along the centerline.

    for a centerline offset by distance d along its normal, the offset curve stays
    locally injective iff d * |kappa| < 1 at every point (Heilmeier et al. and TUM's
    own spline_normals check use the same condition). exceeding it means the inner
    or outer boundary has folded back on itself -- typically in hairpins.
    """
    inner_violation = left_width * np.abs(curvature) >= 1.0
    outer_violation = right_width * np.abs(curvature) >= 1.0
    violations = np.nonzero(inner_violation | outer_violation)[0]
    if violations.size > 0:
        worst = violations[np.argmax(np.abs(curvature[violations]))]
        raise AssertionError(
            f"normal crossing at {violations.size} sample point(s); worst at index "
            f"{worst} (kappa={curvature[worst]:.4f}, left={left_width[worst]:.2f} m, "
            f"right={right_width[worst]:.2f} m)"
        )


def assert_closed_loop_velocity(v_mps: np.ndarray, tol: float = 1e-2) -> None:
    """raise if the velocity profile's start and end speed don't match.

    the M2 solver constructs v(L) as an exact copy of v(0) by convention, so this should be a
    near-no-op in normal operation -- defense-in-depth against a regression, matching M1's
    assert_loop_closes.
    """
    gap = abs(float(v_mps[0]) - float(v_mps[-1]))
    if gap > tol:
        raise AssertionError(
            f"velocity profile does not close the loop: v(0)={v_mps[0]:.4f} m/s, "
            f"v(L)={v_mps[-1]:.4f} m/s, gap={gap:.4f} m/s > tolerance {tol} m/s"
        )


def assert_energy_balance(
    v_mps: np.ndarray,
    ax_mps2: np.ndarray,
    ax_drag_mps2: np.ndarray,
    mass_kg: float,
    power_w: float,
    rel_tol: float = 0.02,
) -> None:
    """raise if any point implies more propulsive power than the engine can deliver.

    a naive check that realized kinetic energy sums to zero around the closed lap would be
    tautological here: ax_mps2 is defined as the exact segment-average (v_next^2-v^2)/(2*ds),
    so it telescopes to (v(L)^2 - v(0)^2)/2 = 0 by construction regardless of whether the
    underlying physics was implemented correctly. What can actually catch a bug: whether the
    composed accel budget (friction circle + drag + engine cap) ever implies more power than
    the vehicle's engine can deliver -- net tire force is ax_mps2 + ax_drag_mps2 (drag always
    subtracts from realized accel, so adding it back isolates the tire's own contribution).
    """
    ax_tire_net = ax_mps2 + ax_drag_mps2
    power_used_w = mass_kg * ax_tire_net * v_mps
    violations = np.nonzero(power_used_w > power_w * (1.0 + rel_tol))[0]
    if violations.size > 0:
        worst = violations[np.argmax(power_used_w[violations])]
        raise AssertionError(
            f"power budget violated at {violations.size} point(s); worst at index {worst} "
            f"(power used {power_used_w[worst] / 1000:.1f} kW > "
            f"limit {power_w / 1000:.1f} kW)"
        )


def curvature_deviation(kappa: np.ndarray, kappa_reference: np.ndarray) -> dict[str, float]:
    """compare computed curvature against a published/reference curve.

    returns summary stats rather than raising -- curvature comparison against TUM's
    plots is a visual/quantitative check for M1's deliverable, not a hard gate.
    """
    if kappa.shape != kappa_reference.shape:
        raise ValueError(
            f"shape mismatch: kappa {kappa.shape} vs reference {kappa_reference.shape}, "
            "resample onto a common arc-length grid first"
        )
    diff = kappa - kappa_reference
    return {
        "max_abs_error": float(np.max(np.abs(diff))),
        "rmse": float(np.sqrt(np.mean(diff**2))),
        "mean_error": float(np.mean(diff)),
    }
