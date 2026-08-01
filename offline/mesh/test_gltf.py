"""tests for the GLB writer: round-trip parse the binary with stdlib struct/json.

the parser here is written from the glTF 2.0 spec independently of the writer, so a shared
misunderstanding would have to be made twice to pass -- the closest thing to an external
validator without adding a dependency.

M9 made the writer generic, so most of this file now exercises it directly on small synthetic
primitives rather than only through a track ribbon. That matters: the writer is the piece every
future surface goes through, and testing it only via the ribbon would leave its multi-primitive,
multi-material and alignment behaviour covered by nothing.
"""

from __future__ import annotations

import json
import struct

import numpy as np
import pytest

from offline.elevation.profile import ElevationProfile
from offline.geometry.pipeline import build_track
from offline.mesh.gltf import (
    Attribute,
    MaterialDef,
    Primitive,
    write_glb,
    z_up_to_y_up,
)
from offline.mesh.ribbon import build_ribbon_mesh, ribbon_to_primitives

HEADER = "# x_m,y_m,w_tr_right_m,w_tr_left_m\n"

_COMPONENT_DTYPE = {5121: np.uint8, 5123: np.uint16, 5125: np.uint32, 5126: np.float32}
_TYPE_WIDTH = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4}


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


def _quad(offset: float = 0.0):
    """a two-triangle square with position, normal and uv, for writer-level tests."""
    positions = np.array(
        [[0.0, 0.0, offset], [1.0, 0.0, offset], [1.0, 1.0, offset], [0.0, 1.0, offset]]
    )
    normals = np.tile([0.0, 1.0, 0.0], (4, 1))
    uvs = np.array([[0.0, 0.0], [1.0, 0.0], [1.0, 5.0], [0.0, 5.0]])
    indices = np.array([0, 1, 2, 0, 2, 3], dtype=np.uint32)
    return positions, normals, uvs, indices


def _quad_primitive(name: str, material: int, offset: float = 0.0) -> Primitive:
    positions, normals, uvs, indices = _quad(offset)
    return Primitive(
        name=name,
        indices=indices,
        attributes=[
            Attribute("POSITION", positions),
            Attribute("NORMAL", normals),
            Attribute("TEXCOORD_0", uvs, type_str="VEC2"),
        ],
        material=material,
    )


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
    dtype = _COMPONENT_DTYPE[accessor["componentType"]]
    width = _TYPE_WIDTH[accessor["type"]]
    array = np.frombuffer(data, dtype=dtype)
    return array.reshape(-1, width) if width > 1 else array


def _write(primitives, materials, tmp_path, name="out.glb"):
    path = tmp_path / name
    write_glb(primitives, materials, path, scene_name="Scene", node_name="Node")
    return path


# ---- writer-level, on synthetic primitives ---------------------------------------------


def test_multiple_primitives_round_trip_independently(tmp_path) -> None:
    materials = [MaterialDef("a"), MaterialDef("b")]
    primitives = [_quad_primitive("first", 0), _quad_primitive("second", 1, offset=3.0)]
    gltf, binary = _parse_glb(_write(primitives, materials, tmp_path))

    json_primitives = gltf["meshes"][0]["primitives"]
    assert len(json_primitives) == 2
    # one mesh, one node, one scene: these are parts of one static object
    assert len(gltf["meshes"]) == 1 and len(gltf["nodes"]) == 1 and len(gltf["scenes"]) == 1

    for source, written in zip(primitives, json_primitives):
        positions = _read_accessor(gltf, binary, written["attributes"]["POSITION"])
        uvs = _read_accessor(gltf, binary, written["attributes"]["TEXCOORD_0"])
        indices = _read_accessor(gltf, binary, written["indices"])
        np.testing.assert_allclose(positions, source.attributes[0].data, atol=1e-6)
        np.testing.assert_allclose(uvs, source.attributes[2].data, atol=1e-6)
        np.testing.assert_array_equal(indices, source.indices)
        assert written["extras"]["name"] == source.name


def test_each_primitive_references_its_own_material(tmp_path) -> None:
    materials = [MaterialDef("asphalt", roughness=0.94), MaterialDef("grass", roughness=0.99)]
    primitives = [_quad_primitive("road", 0), _quad_primitive("verge", 1)]
    gltf, _ = _parse_glb(_write(primitives, materials, tmp_path))

    assert [p["material"] for p in gltf["meshes"][0]["primitives"]] == [0, 1]
    assert [m["name"] for m in gltf["materials"]] == ["asphalt", "grass"]
    assert gltf["materials"][0]["pbrMetallicRoughness"]["roughnessFactor"] == 0.94


def test_no_image_texture_or_sampler_is_emitted(tmp_path) -> None:
    # appearance is generated procedurally at runtime; the asset carries UVs and slots only,
    # which is what keeps it free of binary texture payloads
    gltf, _ = _parse_glb(_write([_quad_primitive("q", 0)], [MaterialDef("m")], tmp_path))
    assert "images" not in gltf
    assert "textures" not in gltf
    assert "samplers" not in gltf
    assert "baseColorTexture" not in gltf["materials"][0]["pbrMetallicRoughness"]


def test_every_buffer_view_starts_four_byte_aligned(tmp_path) -> None:
    """unaligned views are the classic works-in-one-viewer-not-another bug.

    the uint8 attribute here is the case that would break it: without explicit padding the next
    view would start at an arbitrary offset.
    """
    positions, normals, uvs, indices = _quad()
    primitive = Primitive(
        name="odd",
        indices=indices,
        attributes=[
            Attribute("POSITION", positions),
            Attribute("NORMAL", normals),
            Attribute("TEXCOORD_0", uvs, type_str="VEC2"),
            Attribute(
                "COLOR_0",
                np.arange(12, dtype=np.uint8).reshape(4, 3),
                component_type=5121,
                normalized=True,
            ),
        ],
        material=0,
    )
    gltf, _ = _parse_glb(_write([primitive, _quad_primitive("after", 0)], [MaterialDef("m")], tmp_path))

    for view in gltf["bufferViews"]:
        assert view.get("byteOffset", 0) % 4 == 0


def test_uint8_and_uint16_attributes_survive_the_round_trip(tmp_path) -> None:
    positions, normals, uvs, indices = _quad()
    colors = np.array([[255, 0, 0], [0, 255, 0], [0, 0, 255], [128, 128, 128]], dtype=np.uint8)
    joints = np.arange(16, dtype=np.uint16).reshape(4, 4)
    primitive = Primitive(
        name="typed",
        indices=indices,
        attributes=[
            Attribute("POSITION", positions),
            Attribute("COLOR_0", colors, component_type=5121, normalized=True),
            Attribute("JOINTS_0", joints, component_type=5123, type_str="VEC4"),
        ],
        material=0,
    )
    gltf, binary = _parse_glb(_write([primitive], [MaterialDef("m")], tmp_path))
    written = gltf["meshes"][0]["primitives"][0]

    np.testing.assert_array_equal(
        _read_accessor(gltf, binary, written["attributes"]["COLOR_0"]), colors
    )
    np.testing.assert_array_equal(
        _read_accessor(gltf, binary, written["attributes"]["JOINTS_0"]), joints
    )
    assert gltf["accessors"][written["attributes"]["COLOR_0"]]["normalized"] is True


def test_min_max_is_on_position_only(tmp_path) -> None:
    gltf, _ = _parse_glb(_write([_quad_primitive("q", 0)], [MaterialDef("m")], tmp_path))
    written = gltf["meshes"][0]["primitives"][0]

    assert "min" in gltf["accessors"][written["attributes"]["POSITION"]]
    # mandatory on POSITION per spec, optional elsewhere, so not emitted elsewhere
    assert "min" not in gltf["accessors"][written["attributes"]["TEXCOORD_0"]]
    assert "min" not in gltf["accessors"][written["indices"]]


def test_out_of_range_index_is_rejected(tmp_path) -> None:
    positions, normals, uvs, _ = _quad()
    primitive = Primitive(
        name="bad",
        indices=np.array([0, 1, 9], dtype=np.uint32),
        attributes=[Attribute("POSITION", positions)],
        material=0,
    )
    with pytest.raises(ValueError, match="indexes vertex 9"):
        _write([primitive], [MaterialDef("m")], tmp_path)


def test_mismatched_attribute_lengths_are_rejected(tmp_path) -> None:
    positions, normals, uvs, indices = _quad()
    primitive = Primitive(
        name="ragged",
        indices=indices,
        attributes=[
            Attribute("POSITION", positions),
            Attribute("NORMAL", normals[:3]),
        ],
        material=0,
    )
    with pytest.raises(ValueError, match="differing vertex counts"):
        _write([primitive], [MaterialDef("m")], tmp_path)


def test_missing_material_is_rejected(tmp_path) -> None:
    with pytest.raises(ValueError, match="references material 3"):
        _write([_quad_primitive("q", 3)], [MaterialDef("m")], tmp_path)


def test_index_count_must_be_whole_triangles(tmp_path) -> None:
    positions, _, _, _ = _quad()
    primitive = Primitive(
        name="partial",
        indices=np.array([0, 1, 2, 3], dtype=np.uint32),
        attributes=[Attribute("POSITION", positions)],
        material=0,
    )
    with pytest.raises(ValueError, match="not a multiple of 3"):
        _write([primitive], [MaterialDef("m")], tmp_path)


# ---- through the real ribbon ------------------------------------------------------------


def test_ribbon_round_trips_through_the_writer(mesh, tmp_path) -> None:
    gltf, binary = _parse_glb(
        _write(ribbon_to_primitives(mesh, 0), [MaterialDef("asphalt")], tmp_path)
    )
    written = gltf["meshes"][0]["primitives"][0]

    indices = _read_accessor(gltf, binary, written["indices"])
    positions = _read_accessor(gltf, binary, written["attributes"]["POSITION"])
    normals = _read_accessor(gltf, binary, written["attributes"]["NORMAL"])
    uvs = _read_accessor(gltf, binary, written["attributes"]["TEXCOORD_0"])

    np.testing.assert_array_equal(indices, mesh.triangles.reshape(-1))
    assert positions.shape == mesh.vertices.shape
    assert normals.shape == mesh.normals.shape
    assert uvs.shape == mesh.uvs.shape

    # z-up -> y-up rotation round-trips back to the original track-frame vertices
    restored = np.column_stack([positions[:, 0], -positions[:, 2], positions[:, 1]])
    np.testing.assert_allclose(restored, mesh.vertices, atol=1e-6)


def test_position_min_max_matches_data(mesh, tmp_path) -> None:
    gltf, binary = _parse_glb(
        _write(ribbon_to_primitives(mesh, 0), [MaterialDef("asphalt")], tmp_path)
    )
    attributes = gltf["meshes"][0]["primitives"][0]["attributes"]
    accessor = gltf["accessors"][attributes["POSITION"]]
    positions = _read_accessor(gltf, binary, attributes["POSITION"])

    np.testing.assert_allclose(accessor["min"], positions.min(axis=0), rtol=1e-6)
    np.testing.assert_allclose(accessor["max"], positions.max(axis=0), rtol=1e-6)


def test_normals_point_up_in_gltf_frame(mesh, tmp_path) -> None:
    gltf, binary = _parse_glb(
        _write(ribbon_to_primitives(mesh, 0), [MaterialDef("asphalt")], tmp_path)
    )
    normals = _read_accessor(
        gltf, binary, gltf["meshes"][0]["primitives"][0]["attributes"]["NORMAL"]
    )
    assert np.all(normals[:, 1] > 0.5)  # up in glTF is +y


def test_uv_seam_is_continuous_across_the_start_line(mesh, tmp_path) -> None:
    """the seam pair must arrive in the asset, not just in the RibbonMesh.

    a texture applied to this GLB should run the whole lap once; if the duplicates were dropped
    on export the final quad would carry the entire v range.
    """
    gltf, binary = _parse_glb(
        _write(ribbon_to_primitives(mesh, 0), [MaterialDef("asphalt")], tmp_path)
    )
    written = gltf["meshes"][0]["primitives"][0]
    positions = _read_accessor(gltf, binary, written["attributes"]["POSITION"])
    uvs = _read_accessor(gltf, binary, written["attributes"]["TEXCOORD_0"])
    n = mesh.n_cross_sections

    np.testing.assert_allclose(positions[2 * n :], positions[0:2], atol=1e-6)
    assert float(uvs[0, 1]) == pytest.approx(0.0)
    assert float(uvs[2 * n, 1]) > 0.9 * float(uvs[:, 1].max())


def test_chunks_are_four_byte_aligned(mesh, tmp_path) -> None:
    path = _write(ribbon_to_primitives(mesh, 0), [MaterialDef("asphalt")], tmp_path)
    raw = path.read_bytes()
    json_length = struct.unpack_from("<II", raw, 12)[0]

    assert json_length % 4 == 0
    assert (20 + json_length) % 4 == 0
    assert len(raw) % 4 == 0


def test_empty_primitive_list_is_rejected(tmp_path) -> None:
    with pytest.raises(ValueError, match="at least one primitive"):
        _write([], [MaterialDef("m")], tmp_path)
