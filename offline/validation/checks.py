"""M1 validation harness: hard assertions a track geometry pipeline must satisfy.

written before the geometry pipeline itself (offline/geometry/). the pipeline is
only trusted once every function here passes on its output.
"""

from __future__ import annotations

import numpy as np
from scipy.spatial import cKDTree


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


def assert_within_track_bounds(
    lateral_offset_m: np.ndarray,
    w_tr_left_m: np.ndarray,
    w_tr_right_m: np.ndarray,
    margin_m: float = 0.0,
) -> None:
    """raise if a signed lateral offset from the centerline ever leaves the track.

    positive lateral_offset_m is toward the left boundary (matching unit_normals_left's
    convention), so the valid range at each point is [-(w_tr_right_m - margin_m),
    w_tr_left_m - margin_m]. margin_m defaults to 0 here since callers that already solved
    the QP with a margin (offline/mincurv) are re-checking the box constraint after a spline
    refit, not re-applying the margin a second time.
    """
    lower = -(w_tr_right_m - margin_m)
    upper = w_tr_left_m - margin_m
    violations = np.nonzero((lateral_offset_m < lower) | (lateral_offset_m > upper))[0]
    if violations.size > 0:
        worst = violations[np.argmax(np.abs(lateral_offset_m[violations]))]
        raise AssertionError(
            f"line leaves the track at {violations.size} sample point(s); worst at index "
            f"{worst} (offset={lateral_offset_m[worst]:.2f} m, "
            f"bounds=[{lower[worst]:.2f}, {upper[worst]:.2f}] m)"
        )


def assert_friction_circle_respected(
    ax_tire_mps2: np.ndarray,
    ay_mps2: np.ndarray,
    ay_max_mps2: np.ndarray,
    rel_tol: float = 0.02,
) -> None:
    """raise if the tire force implied by (ax_tire, ay) ever exceeds the friction circle.

    isotropic circle ax_tire^2 + ay^2 <= ay_max^2, the same physics GT3Vehicle.ay_max_mps2
    encodes and M2's forward-backward solver enforces per-mode. Checked directly here against
    an NLP solution where ax_tire and ay were free decision-adjacent quantities rather than
    values already clipped to the circle by construction.
    """
    used = np.hypot(ax_tire_mps2, ay_mps2)
    limit = ay_max_mps2 * (1.0 + rel_tol)
    violations = np.nonzero(used > limit)[0]
    if violations.size > 0:
        worst = violations[np.argmax(used[violations] - limit[violations])]
        raise AssertionError(
            f"friction circle violated at {violations.size} point(s); worst at index {worst} "
            f"(used={used[worst]:.3f} m/s2 > limit={ay_max_mps2[worst]:.3f} m/s2)"
        )


def lateral_deviation(line_a_xy: np.ndarray, line_b_xy: np.ndarray) -> dict[str, float]:
    """nearest-point distance stats between two (N, 2) polylines.

    uses a KD-tree nearest-neighbour lookup rather than index-aligned or arc-length-aligned
    comparison, since two independently-parametrized racing lines (ours vs TUM's) don't share
    a common arc-length origin or point count.
    """
    tree = cKDTree(line_b_xy)
    distances, _ = tree.query(line_a_xy)
    return {
        "max_m": float(np.max(distances)),
        "mean_m": float(np.mean(distances)),
    }


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


def assert_elevation_plausible(
    z_m: np.ndarray,
    s_m: np.ndarray,
    expected_max_rise_m: float,
    expected_total_range_m: float,
    rise_window_m: float = 500.0,
    rel_tol: float = 0.5,
) -> None:
    """raise unless the profile's steepest sustained rise and total range land in loose bands
    around a circuit's documented figures (e.g. Spa: ~40 m Eau Rouge climb, ~100 m total).

    the rise location is found by rolling-window search rather than hardcoded arc length --
    the documented landmark's exact s-position isn't known precisely. Bands are deliberately
    wide (rel_tol=0.5 -> a 2x scale error lands outside on either metric); this is the
    DESIGN_NOTES section 3 M5 test "if you're out by a factor of two you'll see it
    immediately," as an assertion instead of an eyeball.
    """
    spacing = float(np.median(np.diff(s_m)))
    window = max(1, int(round(rise_window_m / spacing)))
    if window >= len(z_m):
        raise ValueError(f"rise_window_m={rise_window_m} exceeds the profile length")

    rises = z_m[window:] - z_m[:-window]
    max_rise = float(np.max(rises))
    lo, hi = expected_max_rise_m * (1 - rel_tol), expected_max_rise_m * (1 + rel_tol)
    if not (lo <= max_rise <= hi):
        raise AssertionError(
            f"steepest {rise_window_m:.0f} m-window rise is {max_rise:.1f} m, outside "
            f"[{lo:.1f}, {hi:.1f}] m around the documented {expected_max_rise_m:.0f} m"
        )

    total_range = float(np.max(z_m) - np.min(z_m))
    lo, hi = expected_total_range_m * (1 - rel_tol), expected_total_range_m * (1 + rel_tol)
    if not (lo <= total_range <= hi):
        raise AssertionError(
            f"total elevation range is {total_range:.1f} m, outside [{lo:.1f}, {hi:.1f}] m "
            f"around the documented {expected_total_range_m:.0f} m"
        )
