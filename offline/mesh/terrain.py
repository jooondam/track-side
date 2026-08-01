"""landscape height grid around a circuit, shared by the apron builder and the viewer asset.

this used to live as a private helper inside build_viewer_assets.py, which was fine while the
grid only ever became terrain.json. M9's apron has to *meet* that terrain along its outer edge,
and the only way to guarantee the two agree is for both to read the identical numbers -- not
the same IDW formula evaluated twice, the same grid. Sampling the raw IDW for the apron while
the runtime renders an interpolated grid would leave them apart by the grid's own interpolation
error, which is exactly the gap that shows up as a hole along the edge of the road.

heights are rounded at construction, not at serialisation, for the same reason: terrain.json
ships 2 dp, so the apron is built against the rounded values the viewer will actually load.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from scipy.spatial import cKDTree

# 200 rather than M5's 140: the runtime draws this as a displaced mesh now instead of a point
# field, so cell size is silhouette quality rather than dot spacing. Spa goes from 25 m cells to
# 17 m for about 120 KB more JSON.
TERRAIN_CELLS = 200

_IDW_NEIGHBOURS = 12
_RELAX_START_M = 150.0
_RELAX_SPAN_M = 1050.0
_HEIGHT_DECIMALS = 2

# the steepest height change allowed between neighbouring cells, and how hard to work at it.
#
# This exists because of a specific artifact, not as general smoothing. The IDW takes the 12
# nearest track points, but the track is sampled every metre, so all 12 come from the same 12 m
# of road: the interpolation degenerates into *nearest section wins*. Out in the infield, where
# two distant parts of the circuit are about equally far away, the boundary between their basins
# is a cliff. At Spa the worst was 65 m between adjacent cells, where one side's nearest road was
# s=4481 at z=9.9 and the other's was s=3117 at z=80.4.
#
# 6 m over a ~11 m cell is a 55% slope. Real terrain near this circuit runs to about 30%, so the
# relaxation only ever touches the artifact: with this cap the height sampled at every track
# point is unchanged to 0.07 m, exactly as it was before. Dropping the cap to 4 m starts moving
# real ground, which is the signal that 6 is the right side of the line.
_MAX_CELL_STEP_M = 6.0
_CLIFF_RELAX_ITERS = 40
_CLIFF_RELAX_RATE = 0.6
# ground within this distance of the track is never relaxed: it is what the apron's outer edge
# (32 m out) samples, and moving it is how a 14% roadside bank became a 49% one
_ROADSIDE_PROTECT_M = 45.0


def relax_cliffs(
    heights: np.ndarray,
    protect: np.ndarray | None = None,
    max_step_m: float = _MAX_CELL_STEP_M,
    iterations: int = _CLIFF_RELAX_ITERS,
    rate: float = _CLIFF_RELAX_RATE,
) -> np.ndarray:
    """diffuse only the cells whose neighbours are impossibly far below or above them.

    Deliberately not a blur. A blur would soften the whole landscape to remove a handful of
    interpolation cliffs, and the thing that has to stay sharp is precisely the ground next to
    the road, where the apron ties in. This touches a cell only while one of its four neighbours
    is more than max_step_m away, so a real slope is left exactly as it was and only the
    Voronoi ridges between basins are pulled down.

    `protect` pins cells that must not move at all, whatever their neighbours are doing. The
    roadside band uses it: at Spa only 2% of cliff cells sit within 40 m of the track, but the
    apron's outer edge is at 32 m, so relaxing that band moved the ground the apron ties to and
    turned a 14% roadside bank into a 49% one. Repairing the infield must not come out of the
    accuracy of the metre of ground the road actually meets.
    """
    h = heights.copy()
    for _ in range(iterations):
        padded = np.pad(h, 1, mode="edge")
        neighbours = (
            padded[:-2, 1:-1],
            padded[2:, 1:-1],
            padded[1:-1, :-2],
            padded[1:-1, 2:],
        )
        steep = np.zeros(h.shape, dtype=bool)
        for neighbour in neighbours:
            steep |= np.abs(neighbour - h) > max_step_m
        if protect is not None:
            steep &= ~protect
        if not steep.any():
            break
        mean = sum(neighbours) / 4.0
        h = np.where(steep, h + rate * (mean - h), h)
    return h


@dataclass(frozen=True)
class TerrainGrid:
    """regular height grid in the glTF Y-up frame's ground plane.

    grid axes are gltf x and z (= -track_y); heights are gltf y in metres. heights is indexed
    [row, col] with row running along z and col along x, matching the row-major nesting the
    JSON ships and the order src/render/TerrainMesh.tsx reads.
    """

    circuit_name: str
    n_cells: int
    x0: float
    z0: float
    dx: float
    dz: float
    heights: np.ndarray

    def sample(self, x, z):
        """bilinearly interpolate the grid at glTF-frame (x, z), clamped at the edges.

        this is the same interpolation three.js does across the displaced plane's triangles
        along the grid axes, so an apron vertex placed here lands on the rendered surface rather
        than near it.
        """
        fx = np.clip((np.asarray(x, dtype=float) - self.x0) / self.dx, 0.0, self.n_cells - 1)
        fz = np.clip((np.asarray(z, dtype=float) - self.z0) / self.dz, 0.0, self.n_cells - 1)

        i0 = np.floor(fx).astype(int)
        j0 = np.floor(fz).astype(int)
        i1 = np.minimum(i0 + 1, self.n_cells - 1)
        j1 = np.minimum(j0 + 1, self.n_cells - 1)
        tx = fx - i0
        tz = fz - j0

        h00 = self.heights[j0, i0]
        h10 = self.heights[j0, i1]
        h01 = self.heights[j1, i0]
        h11 = self.heights[j1, i1]
        return (
            h00 * (1 - tx) * (1 - tz)
            + h10 * tx * (1 - tz)
            + h01 * (1 - tx) * tz
            + h11 * tx * tz
        )

    def sample_triangulated(self, x, z):
        """height as the *renderer* will actually show it, not as the grid mathematically is.

        three.js displaces a PlaneGeometry at its vertices and then rasterises triangles, so a
        point inside a cell is interpolated linearly across one triangle rather than bilinearly
        across the quad. PlaneGeometry splits each cell (a, b, c, d) into (a, b, d) and
        (b, c, d), which is the anti-diagonal, so the two halves are selected by tx + tz <= 1.

        the difference between this and sample() is small but real, and it is precisely the
        residual OUTER_LIFT_M exists to absorb. placing the apron with this puts its outer edge
        on the rendered surface rather than near it.
        """
        fx = np.clip((np.asarray(x, dtype=float) - self.x0) / self.dx, 0.0, self.n_cells - 1)
        fz = np.clip((np.asarray(z, dtype=float) - self.z0) / self.dz, 0.0, self.n_cells - 1)

        i0 = np.minimum(np.floor(fx).astype(int), self.n_cells - 2)
        j0 = np.minimum(np.floor(fz).astype(int), self.n_cells - 2)
        tx = fx - i0
        tz = fz - j0

        h00 = self.heights[j0, i0]
        h10 = self.heights[j0, i0 + 1]
        h01 = self.heights[j0 + 1, i0]
        h11 = self.heights[j0 + 1, i0 + 1]

        lower = h00 * (1.0 - tx - tz) + h10 * tx + h01 * tz
        upper = h01 * (1.0 - tx) + h10 * (1.0 - tz) + h11 * (tx + tz - 1.0)
        return np.where(tx + tz <= 1.0, lower, upper)

    def to_json_dict(self) -> dict:
        return {
            "schema_version": 1,
            "meta": {
                "circuit_name": self.circuit_name,
                "frame": "gltf Y-up; x0/z0 origin, heights are gltf y in metres",
                "n_cells": self.n_cells,
                "x0": round(self.x0, 2),
                "z0": round(self.z0, 2),
                "dx": round(self.dx, 4),
                "dz": round(self.dz, 4),
            },
            "heights": self.heights.tolist(),
        }


def build_terrain_grid(
    track, z_m: np.ndarray, n_cells: int = TERRAIN_CELLS, margin_frac: float = 0.35
) -> TerrainGrid:
    """IDW-interpolated landscape height grid around the circuit.

    heights are exact near the track (the nearest track point dominates the weighting) and relax
    toward the track's mean elevation with distance, so far-field terrain flattens out rather
    than extrapolating structure the data cannot support. this is honest smoothing, not a DEM,
    and it is listed as such in the known-wrong section.
    """
    gx = track.x_m
    gz = -track.y_m
    span_x = gx.max() - gx.min()
    span_z = gz.max() - gz.min()
    x0, x1 = gx.min() - span_x * margin_frac, gx.max() + span_x * margin_frac
    z0, z1 = gz.min() - span_z * margin_frac, gz.max() + span_z * margin_frac

    xs = np.linspace(x0, x1, n_cells)
    zs = np.linspace(z0, z1, n_cells)
    grid_x, grid_z = np.meshgrid(xs, zs)
    query = np.column_stack([grid_x.ravel(), grid_z.ravel()])

    tree = cKDTree(np.column_stack([gx, gz]))
    distances, indices = tree.query(query, k=_IDW_NEIGHBOURS)
    weights = 1.0 / np.maximum(distances, 1.0) ** 2
    idw = np.sum(weights * z_m[indices], axis=1) / np.sum(weights, axis=1)

    relax = np.clip((distances[:, 0] - _RELAX_START_M) / _RELAX_SPAN_M, 0.0, 1.0)
    heights = (1.0 - relax) * idw + relax * float(np.mean(z_m))
    # the roadside band is the apron's tie-in, so it is exempt from the repair below
    roadside = (distances[:, 0] < _ROADSIDE_PROTECT_M).reshape(n_cells, n_cells)
    heights = relax_cliffs(heights.reshape(n_cells, n_cells), protect=roadside)

    return TerrainGrid(
        circuit_name=track.circuit_name,
        n_cells=n_cells,
        x0=float(x0),
        z0=float(z0),
        dx=float((x1 - x0) / (n_cells - 1)),
        dz=float((z1 - z0) / (n_cells - 1)),
        heights=np.round(heights, _HEIGHT_DECIMALS),
    )
