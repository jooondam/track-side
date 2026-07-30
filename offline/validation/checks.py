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
