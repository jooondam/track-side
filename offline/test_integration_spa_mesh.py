"""end-to-end ribbon mesh + glTF export against real Spa geometry + the real elevation artifact.

the automated half of M5's mesh deliverable: the committed artifacts/spa/elevation.json is
turned into a triangulated surface and a structurally valid GLB, and the mesh's z content is
checked against the same Eau Rouge/Raidillon figures the elevation tests use -- the climb has
to survive all the way into the vertex buffer, not just the profile JSON.
"""

from __future__ import annotations

import json
import struct
from pathlib import Path

import numpy as np
import pytest

from offline.elevation.profile import load_elevation_profile
from offline.geometry.pipeline import build_track
from offline.mesh.gltf import MaterialDef, write_glb
from offline.mesh.ribbon import build_ribbon_mesh, ribbon_to_primitives
from offline.mesh.surfaces import build_track_primitives
from offline.mesh.terrain import build_terrain_grid
from offline.validation.checks import (
    assert_apron_meets_terrain,
    assert_apron_slope_plausible,
)

SPA_CSV = Path(__file__).resolve().parent.parent / "third_party" / "Spa.csv"
ELEVATION_JSON = Path(__file__).resolve().parent.parent / "artifacts" / "spa" / "elevation.json"


@pytest.fixture(scope="module")
def spa_track():
    return build_track(SPA_CSV, circuit_name="Spa", spacing_m=1.0, gps_noise_std_m=0.1)


@pytest.fixture(scope="module")
def spa_mesh(spa_track):
    return build_ribbon_mesh(spa_track, load_elevation_profile(ELEVATION_JSON))


def test_committed_elevation_artifact_matches_current_track_grid(spa_mesh) -> None:
    # build_ribbon_mesh raises on grid mismatch, so the fixture resolving at all proves the
    # committed elevation.json is in sync with the vendored Spa.csv + current pipeline.
    assert spa_mesh.n_cross_sections > 6000


def test_mesh_carries_the_full_elevation_range(spa_mesh) -> None:
    z = spa_mesh.vertices[:, 2]
    assert 70.0 < float(z.max() - z.min()) < 140.0


def test_all_faces_point_up(spa_mesh) -> None:
    a = spa_mesh.vertices[spa_mesh.triangles[:, 0]].astype(np.float64)
    b = spa_mesh.vertices[spa_mesh.triangles[:, 1]].astype(np.float64)
    c = spa_mesh.vertices[spa_mesh.triangles[:, 2]].astype(np.float64)
    assert np.all(np.cross(b - a, c - a)[:, 2] > 0)


def test_glb_export_is_structurally_valid(spa_mesh, tmp_path) -> None:
    path = tmp_path / "spa.glb"
    write_glb(
        ribbon_to_primitives(spa_mesh, 0),
        [MaterialDef("asphalt")],
        path,
        scene_name="Spa",
        node_name="Spa track surface",
    )

    raw = path.read_bytes()
    magic, version, total_length = struct.unpack_from("<III", raw, 0)
    assert magic == 0x46546C67 and version == 2 and total_length == len(raw)

    json_length = struct.unpack_from("<II", raw, 12)[0]
    gltf = json.loads(raw[20 : 20 + json_length])
    accessors = gltf["accessors"]
    primitive = gltf["meshes"][0]["primitives"][0]
    assert accessors[primitive["attributes"]["POSITION"]]["count"] == len(spa_mesh.vertices)
    assert accessors[primitive["indices"]]["count"] == spa_mesh.triangles.size


@pytest.fixture(scope="module")
def spa_surfaces(spa_track):
    elevation = load_elevation_profile(ELEVATION_JSON)
    terrain = build_terrain_grid(spa_track, elevation.z_m)
    primitives, materials, diagnostics = build_track_primitives(spa_track, elevation, terrain)
    return primitives, materials, diagnostics, terrain


def test_the_full_surface_set_ships_asphalt_and_both_aprons(spa_surfaces) -> None:
    primitives, materials, _, _ = spa_surfaces
    assert [p.name for p in primitives] == ["asphalt", "apron_left", "apron_right"]
    # each surface gets its own material slot so the runtime can key its generated textures
    assert len({p.material for p in primitives}) == 3
    assert [m.name for m in materials] == ["asphalt", "apron_left", "apron_right"]


def test_apron_ties_into_the_terrain_it_will_be_rendered_against(spa_surfaces) -> None:
    """the cross-artifact check: the apron edge lands on the grid terrain.json actually ships.

    the build-time gate measures the same thing from the exported positions, but only against
    the grid it just built. this rebuilds the grid the way build_viewer_assets.py does and
    checks the apron against that, which is the failure the plan was actually worried about:
    two artifacts generated from grids that quietly disagree.
    """
    primitives, _, diagnostics, terrain = spa_surfaces
    assert_apron_meets_terrain(diagnostics["worst_terrain_gap_m"])
    assert_apron_slope_plausible(diagnostics["worst_apron_slope"])

    for primitive in primitives[1:]:
        positions = primitive.attributes[0].data  # already Y-up
        outer = positions[: diagnostics["cross_sections"] * 4].reshape(-1, 4, 3)[:, 3, :]
        gap = np.abs(outer[:, 1] - terrain.sample_triangulated(outer[:, 0], outer[:, 2]))
        # the outer edge rides a quarter metre proud, turning any residual into a small berm
        # rather than z-fighting along the length of the circuit
        np.testing.assert_allclose(gap, 0.25, atol=1e-4)


def test_apron_lip_sits_just_above_the_road(spa_surfaces) -> None:
    # the piece that stops the ribbon ending in mid-air and gives the instanced kerbs a base
    primitives, _, diagnostics, _ = spa_surfaces
    m = diagnostics["cross_sections"]
    for primitive in primitives[1:]:
        columns = primitive.attributes[0].data[: m * 4].reshape(-1, 4, 3)
        rise = columns[:, 1, 1] - columns[:, 0, 1]
        drop = columns[:, 2, 1] - columns[:, 0, 1]
        np.testing.assert_allclose(rise, 0.06, atol=1e-4)
        np.testing.assert_allclose(drop, -0.18, atol=1e-4)


def test_triangle_budget_matches_the_planned_cost(spa_surfaces) -> None:
    # the apron is decimated to 8 m precisely so this stays affordable; if it ever creeps back
    # toward the 1 m racing surface the number to notice is this one
    _, _, diagnostics, _ = spa_surfaces
    assert diagnostics["asphalt_triangles"] == 14000
    assert 24000 < diagnostics["total_triangles"] < 25500
