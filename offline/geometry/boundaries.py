"""left/right track boundary polylines via normal offset from the centerline.

sign convention verified against TUM's own reference implementation
(trajectory_planning_helpers.calc_normal_vectors_ahead + global_racetrajectory_optimization's
prep_track.py): their normvec points along tangent rotated -90 degrees (CW), and
bound_right = centerline + normvec * w_tr_right, bound_left = centerline - normvec * w_tr_left.
That is mathematically identical to N_left (CCW rotation) used here with left offset by
N_left and right offset by -N_left.
"""

from __future__ import annotations

from typing import Literal

import numpy as np


def unit_normals_left(unit_tangents: np.ndarray) -> np.ndarray:
    """tangent rotated +90 degrees (CCW): points toward the inside of a CCW-traversed curve."""
    tx, ty = unit_tangents[:, 0], unit_tangents[:, 1]
    return np.column_stack([-ty, tx])


def offset_boundary(
    centerline: np.ndarray,
    unit_tangents: np.ndarray,
    width_m: np.ndarray,
    side: Literal["left", "right"],
) -> np.ndarray:
    """offset the centerline by width_m along the left or right normal at each point."""
    n_left = unit_normals_left(unit_tangents)
    normal = n_left if side == "left" else -n_left
    return centerline + width_m[:, None] * normal
