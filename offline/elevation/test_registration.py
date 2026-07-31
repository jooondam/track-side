"""tests for the OpenF1-to-metre-frame registration against synthetic known transforms.

every test applies a *known* similarity transform (plus optional mirror) to a synthetic loop
and asserts register_via_icp recovers it -- no real data, no network, the recovery either
works to numerical tolerance or the module is wrong.
"""

from __future__ import annotations

import numpy as np
import pytest

from offline.elevation.registration import (
    apply_similarity_transform,
    register_via_icp,
    similarity_transform_fit,
)


def _synthetic_loop(n: int = 400) -> np.ndarray:
    """a lumpy non-symmetric closed loop -- asymmetric on purpose, so there is exactly one
    correct rotation (a circle would make every rotation equally right)."""
    theta = np.linspace(0.0, 2 * np.pi, n, endpoint=False)
    radius = 100.0 + 30.0 * np.sin(2 * theta) + 15.0 * np.cos(5 * theta) + 8.0 * np.sin(3 * theta + 1.0)
    return np.column_stack([radius * np.cos(theta), radius * np.sin(theta)])


def _make_transformed_source(
    target: np.ndarray, scale: float, angle_rad: float, translation: np.ndarray, mirror: bool
) -> np.ndarray:
    """build source points such that mapping source -> target requires the given transform."""
    c, s = np.cos(angle_rad), np.sin(angle_rad)
    rotation = np.array([[c, -s], [s, c]])
    # invert target = s*R @ (mirror(source)) + t  =>  source = mirror(R^-1 @ (target - t) / s)
    source = (target - translation) @ rotation / scale
    if mirror:
        source[:, 0] = -source[:, 0]
    return source


def test_similarity_fit_recovers_known_transform_on_paired_points() -> None:
    target = _synthetic_loop()
    source = _make_transformed_source(target, 0.1, 0.7, np.array([50.0, -20.0]), mirror=False)

    scale, rotation, translation = similarity_transform_fit(source, target)

    assert scale == pytest.approx(0.1, rel=1e-9)
    moved = apply_similarity_transform(source, scale, rotation, translation)
    np.testing.assert_allclose(moved, target, atol=1e-9)


def test_icp_recovers_transform_without_correspondences() -> None:
    target = _synthetic_loop(n=600)
    # different sample count and a phase offset so no source point coincides with any target
    # point -- correspondences genuinely unknown, which is the whole point of ICP.
    source_target = _synthetic_loop(n=380)
    source = _make_transformed_source(source_target, 0.1, 2.1, np.array([-300.0, 800.0]), mirror=False)

    result = register_via_icp(source, target)

    assert not result.mirrored
    assert result.scale == pytest.approx(0.1, rel=0.01)
    assert result.rmse_m < 1.0


def test_icp_detects_and_fixes_mirrored_frame() -> None:
    target = _synthetic_loop(n=600)
    source_target = _synthetic_loop(n=380)
    source = _make_transformed_source(source_target, 0.1, 1.0, np.array([10.0, 20.0]), mirror=True)

    result = register_via_icp(source, target)

    assert result.mirrored
    assert result.scale == pytest.approx(0.1, rel=0.01)
    assert result.rmse_m < 1.0


def test_icp_tolerates_noise() -> None:
    rng = np.random.default_rng(42)
    target = _synthetic_loop(n=600)
    source_target = _synthetic_loop(n=380)
    source = _make_transformed_source(source_target, 0.1, 0.4, np.array([5.0, -7.0]), mirror=False)
    source = source + rng.normal(0.0, 20.0, source.shape)  # 20 raw units = 2 m at scale 0.1

    result = register_via_icp(source, target)

    assert result.scale == pytest.approx(0.1, rel=0.05)
    assert result.rmse_m < 5.0


def test_too_few_points_raises() -> None:
    with pytest.raises(ValueError, match="at least 10 points"):
        register_via_icp(np.zeros((5, 2)), _synthetic_loop())


def test_paired_fit_shape_mismatch_raises() -> None:
    with pytest.raises(ValueError, match="paired point sets"):
        similarity_transform_fit(np.zeros((10, 2)), np.zeros((12, 2)))
