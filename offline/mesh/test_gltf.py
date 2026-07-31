"""tests for the GLB writer: round-trip parse the binary with stdlib struct/json.

the parser here is written from the glTF 2.0 spec independently of the writer, so a shared
misunderstanding would have to be made twice to pass -- the closest thing to an external
validator without adding a dependency.
"""

from __future__ import annotations

import json
import struct

import numpy as np
import pytest

from offline.elevation.profile import ElevationProfile
from offline.geometry.pipeline import build_track
from offline.mesh.gltf import write_glb
from offline.mesh.ribbon import build_ribbon_mesh

HEADER = "# x_m,y_m,w_tr_right_m,w_tr_left_m\n"


@pytest.fixture()
def mesh(tmp_path):
    theta = np.linspace(0.0, 2 * np.pi, 200, endpoint=False)
    x, y = 80.0 * np.cos(theta), 80.0 * np.sin(theta)
    lines = [f"{xi:.6f},{yi:.6f},4.000,4.000" for xi, yi in zip(x, y)]
    csv = tmp_path / "circle.csv"
    csv.write_text(HEADER + "\n".join(lines) + "\n")
    track = build_track(csv, circuit_name="TestCircle", spacing_m=2.0, gps_noise_std_m=0.0)
    z = 5.0 * np.sin(2 * np.pi * track.s_m / track.loop_length_m)
    elevation = ElevationProfile(
        circuit_name=track.circuit_name,
        source_path=track.source_path,
        bin_size_m=25.0,
        n_samples_used=0,
        n_samples_rejected=0,
        s_m=track.s_m,
        z_m=z - np.min(z),
    )
    return build_ribbon_mesh(track, elevation)


def _parse_glb(path):
    raw = path.read_bytes()
    magic, version, total_length = struct.unpack_from("<III", raw, 0)
    assert magic == 0x46546C67
    assert version == 2
    assert total_length == len(raw)

    json_length, json_type = struct.unpack_from("<II", raw, 12)
    assert json_type == 0x4E4F534A
    gltf = json.loads(raw[20 : 20 + json_length])

    bin_offset = 20 + json_length
    bin_length, bin_type = struct.unpack_from("<II", raw, bin_offset)
    assert bin_type == 0x004E4942
    binary = raw[bin_offset + 8 : bin_offset + 8 + bin_length]
    return gltf, binary


def _read_accessor(gltf, binary, accessor_index):
    accessor = gltf["accessors"][accessor_index]
    view = gltf["bufferViews"][accessor["bufferView"]]
    start = view.get("byteOffset", 0)
    data = binary[start : start + view["byteLength"]]
    dtype = {5125: np.uint32, 5126: np.float32}[accessor["componentType"]]
    width = {"SCALAR": 1, "VEC3": 3}[accessor["type"]]
    array = np.frombuffer(data, dtype=dtype)
    return array.reshape(-1, width) if width > 1 else array


def test_glb_structure_and_round_trip(mesh, tmp_path) -> None:
    path = tmp_path / "track.glb"
    write_glb(mesh, path)

    gltf, binary = _parse_glb(path)

    assert gltf["asset"]["version"] == "2.0"
    assert gltf["buffers"][0]["byteLength"] <= len(binary)  # binary chunk may carry padding

    primitive = gltf["meshes"][0]["primitives"][0]
    indices = _read_accessor(gltf, binary, primitive["indices"])
    positions = _read_accessor(gltf, binary, primitive["attributes"]["POSITION"])
    normals = _read_accessor(gltf, binary, primitive["attributes"]["NORMAL"])

    np.testing.assert_array_equal(indices, mesh.triangles.reshape(-1))
    assert positions.shape == mesh.vertices.shape
    assert normals.shape == mesh.normals.shape

    # z-up -> y-up rotation round-trips back to the original track-frame vertices
    restored = np.column_stack([positions[:, 0], -positions[:, 2], positions[:, 1]])
    np.testing.assert_allclose(restored, mesh.vertices, atol=1e-6)


def test_position_min_max_matches_data(mesh, tmp_path) -> None:
    path = tmp_path / "track.glb"
    write_glb(mesh, path)
    gltf, binary = _parse_glb(path)

    accessor = gltf["accessors"][gltf["meshes"][0]["primitives"][0]["attributes"]["POSITION"]]
    positions = _read_accessor(gltf, binary, gltf["meshes"][0]["primitives"][0]["attributes"]["POSITION"])
    np.testing.assert_allclose(accessor["min"], positions.min(axis=0), rtol=1e-6)
    np.testing.assert_allclose(accessor["max"], positions.max(axis=0), rtol=1e-6)


def test_normals_point_up_in_gltf_frame(mesh, tmp_path) -> None:
    path = tmp_path / "track.glb"
    write_glb(mesh, path)
    gltf, binary = _parse_glb(path)

    normals = _read_accessor(gltf, binary, gltf["meshes"][0]["primitives"][0]["attributes"]["NORMAL"])
    # up in glTF is +y
    assert np.all(normals[:, 1] > 0.5)


def test_chunks_are_four_byte_aligned(mesh, tmp_path) -> None:
    path = tmp_path / "track.glb"
    write_glb(mesh, path)
    raw = path.read_bytes()
    json_length = struct.unpack_from("<II", raw, 12)[0]
    assert json_length % 4 == 0
    assert (20 + json_length) % 4 == 0
    assert len(raw) % 4 == 0
