"""tests for the terrain height grid and its cliff relaxation."""

from __future__ import annotations

import numpy as np
import pytest

from offline.mesh.terrain import TerrainGrid, relax_cliffs


def _grid(heights: np.ndarray) -> TerrainGrid:
    return TerrainGrid(
        circuit_name="Test",
        n_cells=heights.shape[0],
        x0=0.0,
        z0=0.0,
        dx=10.0,
        dz=10.0,
        heights=heights,
    )


def test_relaxation_pulls_a_cliff_down() -> None:
    # two plateaus 60 m apart meeting at a single cell boundary: the artifact this exists for
    heights = np.zeros((40, 40))
    heights[:, 20:] = 60.0
    relaxed = relax_cliffs(heights, max_step_m=6.0, iterations=60)

    before = float(np.max(np.abs(np.diff(heights, axis=1))))
    after = float(np.max(np.abs(np.diff(relaxed, axis=1))))
    assert before == pytest.approx(60.0)
    assert after < 10.0


def test_relaxation_leaves_a_plausible_slope_untouched() -> None:
    """the property that separates this from a blur.

    a real 30% slope across an 11 m cell is 3.3 m, comfortably inside the cap, so the relaxation
    must not move it at all. If this ever fails the cap has been set below real topography and
    the terrain is being flattened rather than repaired.
    """
    ramp = np.tile(np.linspace(0.0, 120.0, 40), (40, 1))  # 3 m per cell
    relaxed = relax_cliffs(ramp, max_step_m=6.0, iterations=60)
    np.testing.assert_allclose(relaxed, ramp, atol=1e-12)


def test_relaxation_conserves_the_broad_shape() -> None:
    rng = np.random.default_rng(0)
    heights = np.cumsum(rng.normal(0, 1.0, (30, 30)), axis=0)
    relaxed = relax_cliffs(heights, max_step_m=6.0, iterations=40)
    # it is a local repair, so the mean height cannot wander
    assert float(np.mean(relaxed)) == pytest.approx(float(np.mean(heights)), abs=0.5)


def test_relaxation_stops_early_when_there_is_nothing_to_do() -> None:
    flat = np.zeros((10, 10))
    np.testing.assert_array_equal(relax_cliffs(flat, iterations=1000), flat)


def test_bilinear_sample_hits_the_grid_nodes_exactly() -> None:
    heights = np.array([[0.0, 10.0], [20.0, 30.0]])
    grid = _grid(heights)
    assert float(grid.sample(0.0, 0.0)) == pytest.approx(0.0)
    assert float(grid.sample(10.0, 0.0)) == pytest.approx(10.0)
    assert float(grid.sample(0.0, 10.0)) == pytest.approx(20.0)
    assert float(grid.sample(10.0, 10.0)) == pytest.approx(30.0)
    # centre of the cell is the mean of the four corners under bilinear interpolation
    assert float(grid.sample(5.0, 5.0)) == pytest.approx(15.0)


def test_triangulated_sample_differs_from_bilinear_inside_a_cell_but_not_at_nodes() -> None:
    """the renderer rasterises triangles, so the two agree only on the shared vertices.

    the apron is placed with the triangulated form precisely because that is the surface three.js
    actually draws; this pins the distinction so it cannot quietly be swapped back.
    """
    heights = np.array([[0.0, 10.0], [20.0, 0.0]])  # a twisted cell, where the two disagree most
    grid = _grid(heights)

    for x, z in ((0.0, 0.0), (10.0, 0.0), (0.0, 10.0), (10.0, 10.0)):
        assert float(grid.sample(x, z)) == pytest.approx(float(grid.sample_triangulated(x, z)))

    assert float(grid.sample(5.0, 5.0)) != pytest.approx(
        float(grid.sample_triangulated(5.0, 5.0))
    )


def test_samples_clamp_outside_the_grid_rather_than_extrapolating() -> None:
    grid = _grid(np.array([[0.0, 10.0], [20.0, 30.0]]))
    assert float(grid.sample(-500.0, -500.0)) == pytest.approx(0.0)
    assert float(grid.sample(500.0, 500.0)) == pytest.approx(30.0)
