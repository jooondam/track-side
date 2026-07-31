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
from offline.mesh.gltf import write_glb
from offline.mesh.ribbon import build_ribbon_mesh

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
    write_glb(spa_mesh, path)

    raw = path.read_bytes()
    magic, version, total_length = struct.unpack_from("<III", raw, 0)
    assert magic == 0x46546C67 and version == 2 and total_length == len(raw)

    json_length = struct.unpack_from("<II", raw, 12)[0]
    gltf = json.loads(raw[20 : 20 + json_length])
    accessors = gltf["accessors"]
    primitive = gltf["meshes"][0]["primitives"][0]
    assert accessors[primitive["attributes"]["POSITION"]]["count"] == len(spa_mesh.vertices)
    assert accessors[primitive["indices"]]["count"] == spa_mesh.triangles.size
