"""offset ribbons either side of the track: the raised lip, the run-off, and the tie to terrain.

M8 left the track as a grey band ending in mid-air. This adds the ground it sits on, as a
generic offset-ribbon builder sharing the asphalt ribbon's arc-length parameterisation and its
seam handling, so every surface tiles against the same s and no two of them disagree at the
start line.

Four columns per side, measured outboard from the track boundary:

      col 0   the boundary itself, at road height
      col 1   +0.4 m out and +0.06 m up: the raised lip. this is the piece that fixes "the
              ribbon ends in mid-air" and gives the instanced kerbs something to sit on
      col 2   the run-off edge, 0.18 m below road height
      col 3   the tie to terrain, sampled from the terrain grid and lifted

**Kerbs are deliberately not baked here.** src/render/Kerbs.tsx already instances them from the
curvature channel and works. Baking would freeze the curvature threshold into the asset and
turn the red/white alternation into a geometry problem when it is a texture problem. What the
mesh owes the kerbs is the lip to stand on, which is col 1.

The outer edge is sampled from the *terrain grid* rather than the raw IDW, and lifted
OUTER_LIFT_M. The lift is not styling: terrain renders as linear triangles while the sample
here is bilinear, so a residual mismatch is inevitable, and a quarter metre turns it into a
small berm instead of z-fighting along the entire length of the circuit.
"""

from __future__ import annotations

import numpy as np

from offline.mesh.gltf import Attribute, MaterialDef, Primitive, z_up_to_y_up
from offline.mesh.ribbon import build_ribbon_mesh, ribbon_to_primitives
from offline.mesh.terrain import TerrainGrid

# the material slots the GLB carries. base colours are fallbacks only: src/render/textures.ts
# generates the real appearance at runtime, which is why no images/textures/samplers are
# emitted and the asset stays free of binary texture payloads.
SURFACE_MATERIALS = [
    MaterialDef("asphalt", base_color=(0.20, 0.21, 0.23, 1.0), roughness=0.94),
    MaterialDef("apron_left", base_color=(0.34, 0.33, 0.30, 1.0), roughness=0.98),
    MaterialDef("apron_right", base_color=(0.34, 0.33, 0.30, 1.0), roughness=0.98),
]
MATERIAL_ASPHALT = 0
MATERIAL_APRON_LEFT = 1
MATERIAL_APRON_RIGHT = 2

# outboard offsets in metres, and the height of each column relative to the road
LIP_OFFSET_M = 0.4
LIP_RISE_M = 0.06
RUNOFF_DROP_M = 0.18
DEFAULT_RUNOFF_WIDTH_M = 12.0
# the terrain blend ramps across this span, so the outer edge matches the landscape by
# construction rather than by hoping the run-off happened to end at the right height.
#
# 20 m, not the 40 m first tried, and the number comes from measurement. terrain tracks the road
# to within 0.03 m at the run-off edge and stays plausible out to a 20 m ramp (Spa p99 2.1 m of
# fall, a 16% bank). past that the apron stops being a roadside feature and starts reaching into
# unrelated topography: at 28 m Spa's p99 is 9 m and at 40 m it is 26 m, which is the Malmedy
# embankment falling away below Les Combes. an apron that follows a 76% slope is a cliff, not a
# run-off, and the terrain mesh is the right thing to render that drop.
TERRAIN_RAMP_M = 20.0
OUTER_LIFT_M = 0.25
# the steepest bank the apron is allowed to become before it is treated as a modelling failure
MAX_APRON_SLOPE = 0.35

# one vertex every 8 m along s. the apron is flat, wide and mostly seen from a distance, so it
# carries none of the curvature detail the racing surface needs: at 1 m it would cost 2.8 MB
# per circuit to render the same silhouette.
APRON_DECIMATION_M = 8.0


def _outboard_unit(centre_xy: np.ndarray, boundary_xy: np.ndarray) -> np.ndarray:
    """unit vector from the centreline toward a boundary, per point.

    taken from the boundary arrays rather than from the heading normal so the apron inherits
    M1's normal-crossing guarantee instead of re-deriving a direction that could disagree with
    it on a tight radius.
    """
    delta = boundary_xy - centre_xy
    length = np.linalg.norm(delta, axis=1, keepdims=True)
    return delta / np.maximum(length, 1e-9)


def _column_ring(
    boundary_xy: np.ndarray,
    outboard: np.ndarray,
    road_z: np.ndarray,
    terrain: TerrainGrid,
    runoff_width_m: float,
) -> tuple[np.ndarray, np.ndarray]:
    """(positions (m, 4, 3), lateral offsets (4,)) for one side's four columns."""
    offsets = np.array(
        [0.0, LIP_OFFSET_M, runoff_width_m, runoff_width_m + TERRAIN_RAMP_M], dtype=float
    )
    heights = np.array([0.0, LIP_RISE_M, -RUNOFF_DROP_M], dtype=float)

    columns = []
    for offset, dz in zip(offsets[:3], heights):
        xy = boundary_xy + outboard * offset
        columns.append(np.column_stack([xy, road_z + dz]))

    # the outer column follows the landscape, not the road, and is placed on the surface the
    # renderer will actually draw rather than on the grid's mathematical bilinear form
    outer_xy = boundary_xy + outboard * offsets[3]
    outer_z = terrain.sample_triangulated(outer_xy[:, 0], -outer_xy[:, 1]) + OUTER_LIFT_M
    columns.append(np.column_stack([outer_xy, outer_z]))

    return np.stack(columns, axis=1), offsets


def _ribbon_from_columns(
    positions: np.ndarray, s_m: np.ndarray, lateral_offsets: np.ndarray, loop_length_m: float
) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    """triangulate an (m, c, 3) column grid closed in s, with the same seam split as the ribbon.

    returns (vertices, triangles, normals, uvs). the seam duplicate is cross-section 0 repeated
    at v = loop_length, so a texture runs the full lap without compressing into the last quad.
    """
    m, c, _ = positions.shape
    vertices = positions.reshape(m * c, 3)

    idx = np.arange(m)
    nxt = (idx + 1) % m
    quads = []
    for col in range(c - 1):
        a = idx * c + col
        b = idx * c + col + 1
        a_n = nxt * c + col
        b_n = nxt * c + col + 1
        quads.append(np.column_stack([a, b, a_n]))
        quads.append(np.column_stack([b, b_n, a_n]))
    triangles = np.concatenate(quads).astype(np.uint32)

    # wind for +z normals: measured, not assumed, exactly as the asphalt ribbon does
    tri_a, tri_b, tri_c = (vertices[triangles[:, i]] for i in range(3))
    z_component = np.cross(tri_b - tri_a, tri_c - tri_a)[:, 2]
    if np.mean(z_component > 0) < 0.5:
        triangles = triangles[:, [0, 2, 1]]

    normals = _accumulate_normals(vertices, triangles)

    uvs = np.column_stack(
        [np.tile(lateral_offsets, m), np.repeat(s_m, c)]
    )

    # split the seam after normals, so the duplicated row inherits a correctly averaged normal
    first_row = np.arange(c)
    vertices = np.vstack([vertices, vertices[first_row]])
    normals = np.vstack([normals, normals[first_row]])
    uvs = np.vstack([uvs, np.column_stack([lateral_offsets, np.full(c, loop_length_m)])])

    last_quads = triangles[-2 * (c - 1) :]
    for col in range(c):
        last_quads[last_quads == col] = m * c + col

    return vertices, triangles, normals, uvs


def _accumulate_normals(vertices: np.ndarray, triangles: np.ndarray) -> np.ndarray:
    a = vertices[triangles[:, 0]]
    b = vertices[triangles[:, 1]]
    c = vertices[triangles[:, 2]]
    face = np.cross(b - a, c - a)

    normals = np.zeros_like(vertices)
    for column in range(3):
        np.add.at(normals, triangles[:, column], face)
    lengths = np.linalg.norm(normals, axis=1, keepdims=True)
    if np.any(lengths == 0):
        raise ValueError("degenerate apron vertex with zero accumulated normal")
    return normals / lengths


def build_apron_primitives(
    track,
    z_m: np.ndarray,
    terrain: TerrainGrid,
    material_left: int,
    material_right: int,
    runoff_width_m: float = DEFAULT_RUNOFF_WIDTH_M,
    decimation_m: float = APRON_DECIMATION_M,
) -> tuple[list[Primitive], dict[str, float]]:
    """(primitives, diagnostics) for the left and right aprons.

    diagnostics carry the worst gap between the apron's outer edge and the terrain it is meant
    to meet, which offline/validation/checks.py gates.
    """
    n = track.n_points - 1  # drop the closed duplicate, close by wraparound
    step = max(1, int(round(decimation_m / float(np.mean(np.diff(track.s_m))))))
    take = np.arange(0, n, step)

    centre = np.column_stack([track.x_m[:n], track.y_m[:n]])[take]
    road_z = z_m[:n][take]
    s_m = track.s_m[:n][take]

    primitives: list[Primitive] = []
    worst_gap = 0.0
    worst_slope = 0.0

    for name, bx, by, material in (
        ("apron_left", track.boundary_left_x_m, track.boundary_left_y_m, material_left),
        ("apron_right", track.boundary_right_x_m, track.boundary_right_y_m, material_right),
    ):
        boundary = np.column_stack([bx[:n], by[:n]])[take]
        outboard = _outboard_unit(centre, boundary)
        positions, offsets = _column_ring(
            boundary, outboard, road_z, terrain, runoff_width_m
        )
        vertices, triangles, normals, uvs = _ribbon_from_columns(
            positions, s_m, offsets, track.loop_length_m
        )

        # measure the gap from the *exported* positions, after the Y-up rotation, rather than
        # from the arrays that placed them. re-deriving it from the same expression would be a
        # tautology; going through the rotation means a sign error in z_up_to_y_up or a dropped
        # negation on y fails here instead of silently shipping an apron in the wrong place.
        exported = z_up_to_y_up(vertices)
        # the outer column of the grid rows only; the trailing rows are the seam duplicates
        outer_yup = exported[: len(take) * 4].reshape(-1, 4, 3)[:, 3, :]
        gap = np.abs(
            outer_yup[:, 1] - OUTER_LIFT_M - terrain.sample_triangulated(
                outer_yup[:, 0], outer_yup[:, 2]
            )
        )
        worst_gap = max(worst_gap, float(np.max(gap)))
        worst_slope = max(
            worst_slope,
            float(np.max(np.abs(positions[:, 3, 2] - road_z))) / TERRAIN_RAMP_M,
        )

        primitives.append(
            Primitive(
                name=name,
                indices=triangles.reshape(-1),
                attributes=[
                    Attribute("POSITION", exported),
                    Attribute("NORMAL", z_up_to_y_up(normals)),
                    Attribute("TEXCOORD_0", uvs, type_str="VEC2"),
                ],
                material=material,
            )
        )

    return primitives, {
        "worst_terrain_gap_m": worst_gap,
        "worst_apron_slope": worst_slope,
        "cross_sections": int(len(take)),
    }


def build_track_primitives(track, elevation, terrain: TerrainGrid):
    """(primitives, materials, diagnostics) for the whole drivable surface set.

    the single entry point the CLIs and the tests share, so the shipped GLB and every test
    fixture are assembled by the same code rather than by two call sites that drift.
    """
    ribbon = build_ribbon_mesh(track, elevation)
    primitives = ribbon_to_primitives(ribbon, MATERIAL_ASPHALT)

    apron_primitives, diagnostics = build_apron_primitives(
        track, elevation.z_m, terrain, MATERIAL_APRON_LEFT, MATERIAL_APRON_RIGHT
    )
    primitives.extend(apron_primitives)

    diagnostics["asphalt_triangles"] = int(len(ribbon.triangles))
    diagnostics["total_triangles"] = int(
        sum(len(p.indices) // 3 for p in primitives)
    )
    return primitives, SURFACE_MATERIALS, diagnostics
