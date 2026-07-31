"""register OpenF1's arbitrary coordinate frame onto the TUMFTM metre frame.

OpenF1's /v1/location x/y/z are bare integers in an undocumented track-relative frame:
arbitrary origin, arbitrary rotation, unknown scale (magnitudes suggest decimetres), possibly
mirrored handedness relative to TUMFTM's local metre frame. No transform is published
(docs/DESIGN_NOTES.md section 4 point 2), so this module estimates a 2D similarity transform
(scale, rotation, translation, optional pre-mirror) itself:

1. handedness first: the signed loop area (shoelace) of a car's lap trace vs. the centerline.
   A similarity transform preserves orientation, so if the signs differ no rotation/scale can
   ever align them -- mirror x once up front and record that it happened.
2. coarse search: a similarity fit needs point *correspondences*, which are unknown between an
   unevenly-sampled car trace and a resampled centerline. ICP recovers correspondences by
   alternating nearest-neighbor matching with transform refitting, but converges only locally,
   so the rotation is seeded from a grid of candidate angles (scale seeded from the loop-length
   ratio, which needs no correspondences at all) and the best few-iteration candidate wins.
3. refine to convergence with full ICP.

the registration only ever uses x/y. z rides along untouched: the 2D transform's scale applies
to z downstream (a similarity transform scales all axes equally), but no z offset or z rotation
is estimated -- absolute z is untrustworthy car height anyway, and only the shape survives into
the elevation profile (offline/elevation/profile.py).
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from scipy.spatial import cKDTree


@dataclass(frozen=True)
class RegistrationResult:
    scale: float
    rotation: np.ndarray  # (2, 2) proper rotation
    translation: np.ndarray  # (2,)
    mirrored: bool
    rmse_m: float
    n_iterations: int


def _signed_loop_area(xy: np.ndarray) -> float:
    """shoelace formula over a closed polygon (last->first edge included implicitly)."""
    x, y = xy[:, 0], xy[:, 1]
    return 0.5 * float(np.sum(x * np.roll(y, -1) - np.roll(x, -1) * y))


def _polyline_length(xy: np.ndarray) -> float:
    return float(np.sum(np.hypot(np.diff(xy[:, 0]), np.diff(xy[:, 1]))))


def similarity_transform_fit(
    source_xy: np.ndarray, target_xy: np.ndarray
) -> tuple[float, np.ndarray, np.ndarray]:
    """closed-form least-squares similarity fit (Umeyama 1991) for *paired* points.

    returns (scale, rotation, translation) minimizing ||target - (s*R@source + t)||^2 over
    corresponding rows. SVD of the centered cross-covariance, with the determinant-sign
    correction that forces a proper rotation (det(R) = +1) -- reflections are handled
    explicitly and separately in register_via_icp, never silently absorbed here.
    """
    if source_xy.shape != target_xy.shape:
        raise ValueError(f"paired point sets must match: {source_xy.shape} vs {target_xy.shape}")

    mu_src = source_xy.mean(axis=0)
    mu_tgt = target_xy.mean(axis=0)
    src_c = source_xy - mu_src
    tgt_c = target_xy - mu_tgt

    cov = tgt_c.T @ src_c / len(source_xy)
    u, singular_values, vt = np.linalg.svd(cov)

    d = np.ones(2)
    if np.linalg.det(u @ vt) < 0:
        d[-1] = -1.0
    rotation = u @ np.diag(d) @ vt

    var_src = float(np.mean(np.sum(src_c**2, axis=1)))
    scale = float(np.sum(singular_values * d)) / var_src
    translation = mu_tgt - scale * rotation @ mu_src

    return scale, rotation, translation


def apply_similarity_transform(
    xy: np.ndarray, scale: float, rotation: np.ndarray, translation: np.ndarray
) -> np.ndarray:
    return scale * xy @ rotation.T + translation


def _icp_iterate(
    source_xy: np.ndarray,
    target_tree: cKDTree,
    target_xy: np.ndarray,
    scale: float,
    rotation: np.ndarray,
    translation: np.ndarray,
    n_iterations: int,
    tol: float,
) -> tuple[float, np.ndarray, np.ndarray, float, int]:
    """run up to n_iterations of nearest-neighbor ICP from the given initial transform."""
    rmse = np.inf
    performed = 0
    for _ in range(n_iterations):
        moved = apply_similarity_transform(source_xy, scale, rotation, translation)
        distances, indices = target_tree.query(moved)
        new_rmse = float(np.sqrt(np.mean(distances**2)))
        scale, rotation, translation = similarity_transform_fit(source_xy, target_xy[indices])
        performed += 1
        if abs(rmse - new_rmse) < tol:
            rmse = new_rmse
            break
        rmse = new_rmse
    return scale, rotation, translation, rmse, performed


def register_via_icp(
    source_xy: np.ndarray,
    target_xy: np.ndarray,
    n_seed_angles: int = 24,
    coarse_iterations: int = 5,
    max_iterations: int = 50,
    tol_m: float = 1e-4,
) -> RegistrationResult:
    """estimate the similarity transform mapping source_xy onto target_xy, correspondences
    unknown. source should be one clean, continuous lap trace (temporal order traces the loop
    exactly once); target the circuit centerline in metres.
    """
    if len(source_xy) < 10 or len(target_xy) < 10:
        raise ValueError("need at least 10 points on each side to register")

    mirrored = False
    src = np.array(source_xy, dtype=float, copy=True)
    if _signed_loop_area(src) * _signed_loop_area(target_xy) < 0:
        mirrored = True
        src[:, 0] = -src[:, 0]

    # loop-length ratio needs no correspondences and pins the scale well enough to seed with;
    # the car's driven lap is a few % different from the centerline length, well within ICP's
    # basin once the rotation seed is close.
    scale0 = _polyline_length(target_xy) / _polyline_length(src)

    target_tree = cKDTree(target_xy)
    tgt_centroid = target_xy.mean(axis=0)
    src_centroid = src.mean(axis=0)

    best = None
    for angle in np.linspace(0.0, 2.0 * np.pi, n_seed_angles, endpoint=False):
        c, s = np.cos(angle), np.sin(angle)
        rotation0 = np.array([[c, -s], [s, c]])
        translation0 = tgt_centroid - scale0 * rotation0 @ src_centroid
        candidate = _icp_iterate(
            src, target_tree, target_xy, scale0, rotation0, translation0, coarse_iterations, tol_m
        )
        if best is None or candidate[3] < best[3]:
            best = candidate

    scale, rotation, translation, _, coarse_done = best
    scale, rotation, translation, rmse, refine_done = _icp_iterate(
        src, target_tree, target_xy, scale, rotation, translation, max_iterations, tol_m
    )

    return RegistrationResult(
        scale=scale,
        rotation=rotation,
        translation=translation,
        mirrored=mirrored,
        rmse_m=rmse,
        n_iterations=coarse_done + refine_done,
    )
