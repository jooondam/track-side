"""triangulate the track surface as a closed ribbon between the two boundary polylines.

the ribbon reuses geometry that already exists and is already validated: TrackGeometry's
boundary_left/right arrays (M1's normal offsets, guarded by the normal-crossing assertion) and
ElevationProfile's z(s) (M5's registered OpenF1 profile). The cross-section is flat -- both
edges of a cross-section get the same z -- which is assumption #3 in docs/DESIGN_NOTES.md
section 6 (no camber data exists in any free source), now made literal in the mesh.

topology: the track arrays follow the project's closed-duplicate convention (last point ==
first point). The mesh drops the duplicate and closes by index wraparound instead -- coincident
duplicate vertices would create a degenerate seam quad and break per-vertex normal averaging
at exactly the start/finish line.

winding: triangles are wound so their right-hand-rule normals point up (+z), checked against
the actual left/right boundary orientation rather than assumed from naming.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from offline.elevation.profile import ElevationProfile
from offline.geometry.pipeline import TrackGeometry


@dataclass(frozen=True)
class RibbonMesh:
    """triangulated track surface. vertices (2n, 3) float32 in track frame (z up, metres);
    row layout [left_0, right_0, left_1, right_1, ...]. triangles (2n, 3) uint32."""

    circuit_name: str
    vertices: np.ndarray
    triangles: np.ndarray
    normals: np.ndarray

    @property
    def n_cross_sections(self) -> int:
        return len(self.vertices) // 2


def _vertex_normals(vertices: np.ndarray, triangles: np.ndarray) -> np.ndarray:
    """area-weighted per-vertex normals: accumulate each triangle's cross product onto its
    three vertices, then normalize. The cross product's magnitude is twice the triangle area,
    so plain accumulation *is* the area weighting."""
    a = vertices[triangles[:, 0]]
    b = vertices[triangles[:, 1]]
    c = vertices[triangles[:, 2]]
    face_normals = np.cross(b - a, c - a)

    normals = np.zeros_like(vertices)
    for column in range(3):
        np.add.at(normals, triangles[:, column], face_normals)

    lengths = np.linalg.norm(normals, axis=1, keepdims=True)
    if np.any(lengths == 0):
        raise ValueError("degenerate vertex with zero accumulated normal")
    return normals / lengths


def build_ribbon_mesh(track: TrackGeometry, elevation: ElevationProfile) -> RibbonMesh:
    """triangulate track's boundary ribbon with elevation's z attached, or raise.

    elevation must be built on this exact track (same arc-length grid) -- checked, not
    assumed, since the two artifacts travel through separate JSON files.
    """
    if len(elevation.z_m) != track.n_points or not np.allclose(elevation.s_m, track.s_m):
        raise ValueError(
            "elevation profile grid does not match the track grid; rebuild the profile on "
            "this track"
        )

    # drop the closed-duplicate last point, close by wraparound (see module docstring)
    n = track.n_points - 1
    left = np.column_stack(
        [track.boundary_left_x_m[:n], track.boundary_left_y_m[:n], elevation.z_m[:n]]
    )
    right = np.column_stack(
        [track.boundary_right_x_m[:n], track.boundary_right_y_m[:n], elevation.z_m[:n]]
    )

    vertices = np.empty((2 * n, 3), dtype=np.float64)
    vertices[0::2] = left
    vertices[1::2] = right

    triangles = np.empty((2 * n, 3), dtype=np.uint32)
    idx = np.arange(n)
    nxt = (idx + 1) % n
    left_i, right_i = 2 * idx, 2 * idx + 1
    left_n, right_n = 2 * nxt, 2 * nxt + 1
    triangles[0::2] = np.column_stack([left_i, right_i, left_n])
    triangles[1::2] = np.column_stack([right_i, right_n, left_n])

    # wind for +z normals: measure, don't assume which side "left" physically is
    a = vertices[triangles[:, 0]]
    b = vertices[triangles[:, 1]]
    c = vertices[triangles[:, 2]]
    z_component = np.cross(b - a, c - a)[:, 2]
    if np.mean(z_component > 0) < 0.5:
        triangles = triangles[:, [0, 2, 1]]
        z_component = -z_component
    if np.any(z_component == 0):
        raise ValueError("degenerate (zero-area) triangle in ribbon")

    normals = _vertex_normals(vertices, triangles)

    return RibbonMesh(
        circuit_name=track.circuit_name,
        vertices=vertices.astype(np.float32),
        triangles=triangles,
        normals=normals.astype(np.float32),
    )
