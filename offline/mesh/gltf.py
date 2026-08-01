"""minimal glTF 2.0 binary (.glb) writer. stdlib + numpy only.

hand-written rather than pulling in trimesh/pygltflib: the need is a handful of indexed
triangle primitives with a few vertex attributes, which is a couple of hundred lines of a
well-specified binary container (12-byte header, JSON chunk, binary chunk, both 4-byte
aligned). The test suite round-trip parses the output with struct/json against a parser written
from the spec, so the format contract is enforced rather than assumed.

M9 made this generic. It used to take a RibbonMesh and emit exactly three hardcoded accessors;
it now takes a list of primitives, each with its own attribute list and material, so the track
surface, the aprons and anything later all go through one writer that knows nothing about any
of them. offline/mesh/ribbon.py holds the adapter from RibbonMesh to Primitive.

Materials are emitted as pbrMetallicRoughness slots with **no images, textures or samplers**:
the GLB carries UVs and material names, and appearance is generated procedurally at runtime in
src/render/textures.ts. That keeps the asset free of binary texture payloads entirely.

coordinate convention: the track frame is right-handed Z-up in metres; glTF mandates
right-handed Y-up. Positions and normals are rotated (x, y, z) -> (x, z, -y) on export. This is
a proper rotation (det +1), so triangle winding -- and therefore the up-facing orientation the
mesh builders established -- survives unchanged.
"""

from __future__ import annotations

import json
import struct
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

_GLB_MAGIC = 0x46546C67
_CHUNK_JSON = 0x4E4F534A
_CHUNK_BIN = 0x004E4942
_ARRAY_BUFFER = 34962
_ELEMENT_ARRAY_BUFFER = 34963
_UNSIGNED_BYTE = 5121
_UNSIGNED_SHORT = 5123
_UNSIGNED_INT = 5125
_FLOAT = 5126
_TRIANGLES = 4

_COMPONENT_DTYPE = {
    _UNSIGNED_BYTE: np.uint8,
    _UNSIGNED_SHORT: np.uint16,
    _UNSIGNED_INT: np.uint32,
    _FLOAT: np.float32,
}
_TYPE_WIDTH = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4}


@dataclass(frozen=True)
class Attribute:
    """one vertex attribute stream, e.g. POSITION or TEXCOORD_0."""

    semantic: str
    data: np.ndarray
    component_type: int = _FLOAT
    type_str: str = "VEC3"
    normalized: bool = False


@dataclass(frozen=True)
class Primitive:
    """one indexed triangle list sharing a single material."""

    name: str
    indices: np.ndarray
    attributes: list[Attribute]
    material: int


@dataclass(frozen=True)
class MaterialDef:
    """a pbrMetallicRoughness slot. no maps: appearance is generated at runtime."""

    name: str
    base_color: tuple[float, float, float, float] = (0.5, 0.5, 0.5, 1.0)
    metallic: float = 0.0
    roughness: float = 0.9
    double_sided: bool = False


@dataclass
class _BufferBuilder:
    """appends attribute blobs, recording (offset, length) and keeping every view aligned."""

    blobs: list[bytes] = field(default_factory=list)
    length: int = 0

    def append(self, raw: bytes) -> tuple[int, int]:
        # every bufferView start must sit on a 4-byte boundary. the spec only strictly requires
        # this for accessors whose component type demands it, but unaligned views are the
        # classic source of loaders that work in one viewer and not another, and the padding
        # costs at most 3 bytes per view.
        padding = (-self.length) % 4
        if padding:
            self.blobs.append(b"\x00" * padding)
            self.length += padding
        offset = self.length
        self.blobs.append(raw)
        self.length += len(raw)
        return offset, len(raw)

    def build(self) -> bytes:
        return b"".join(self.blobs)


def z_up_to_y_up(xyz: np.ndarray) -> np.ndarray:
    """rotate the track frame (Z-up) into the glTF frame (Y-up): (x, y, z) -> (x, z, -y)."""
    return np.column_stack([xyz[:, 0], xyz[:, 2], -xyz[:, 1]])


def _pad(data: bytes, alignment: int, fill: bytes) -> bytes:
    remainder = len(data) % alignment
    return data if remainder == 0 else data + fill * (alignment - remainder)


def write_glb(
    primitives: list[Primitive],
    materials: list[MaterialDef],
    output_path: Path,
    scene_name: str,
    node_name: str,
) -> None:
    """write primitives as a self-contained glTF 2.0 binary file.

    all primitives land in one mesh under one node in one scene: they are parts of a single
    static object, and splitting them across nodes would only add transforms that are all
    identity. Positions are expected already in the glTF Y-up frame; use z_up_to_y_up.
    """
    if not primitives:
        raise ValueError("write_glb needs at least one primitive")

    buffers = _BufferBuilder()
    accessors: list[dict] = []
    buffer_views: list[dict] = []
    json_primitives: list[dict] = []

    def add_accessor(data: np.ndarray, component_type: int, type_str: str, target: int,
                     normalized: bool, with_bounds: bool) -> int:
        dtype = _COMPONENT_DTYPE[component_type]
        width = _TYPE_WIDTH[type_str]
        array = np.ascontiguousarray(data, dtype=dtype)
        count = int(array.size // width)
        if array.size % width:
            raise ValueError(f"{type_str} data is not a multiple of {width} components")

        offset, length = buffers.append(array.tobytes())
        buffer_views.append(
            {"buffer": 0, "byteOffset": offset, "byteLength": length, "target": target}
        )
        accessor: dict = {
            "bufferView": len(buffer_views) - 1,
            "componentType": component_type,
            "count": count,
            "type": type_str,
        }
        if normalized:
            accessor["normalized"] = True
        if with_bounds:
            # min/max is mandatory on POSITION per spec; loaders use it for bounding boxes and
            # frustum culling. it is optional elsewhere, so it is not emitted elsewhere.
            reshaped = array.reshape(count, width)
            accessor["min"] = [float(v) for v in reshaped.min(axis=0)]
            accessor["max"] = [float(v) for v in reshaped.max(axis=0)]
        accessors.append(accessor)
        return len(accessors) - 1

    for primitive in primitives:
        vertex_counts = {
            int(np.asarray(a.data).size // _TYPE_WIDTH[a.type_str]) for a in primitive.attributes
        }
        if len(vertex_counts) != 1:
            raise ValueError(
                f"primitive {primitive.name!r} has attributes of differing vertex counts: "
                f"{sorted(vertex_counts)}"
            )
        n_vertices = vertex_counts.pop()

        indices = np.ascontiguousarray(primitive.indices, dtype=np.uint32).reshape(-1)
        if indices.size % 3:
            raise ValueError(f"primitive {primitive.name!r} index count is not a multiple of 3")
        if indices.size and int(indices.max()) >= n_vertices:
            raise ValueError(
                f"primitive {primitive.name!r} indexes vertex {int(indices.max())} of "
                f"{n_vertices}"
            )
        if not 0 <= primitive.material < len(materials):
            raise ValueError(
                f"primitive {primitive.name!r} references material {primitive.material}, "
                f"but {len(materials)} were supplied"
            )

        index_accessor = add_accessor(
            indices, _UNSIGNED_INT, "SCALAR", _ELEMENT_ARRAY_BUFFER, False, False
        )
        attribute_indices = {
            attribute.semantic: add_accessor(
                attribute.data,
                attribute.component_type,
                attribute.type_str,
                _ARRAY_BUFFER,
                attribute.normalized,
                attribute.semantic == "POSITION",
            )
            for attribute in primitive.attributes
        }
        json_primitives.append(
            {
                "attributes": attribute_indices,
                "indices": index_accessor,
                "material": primitive.material,
                "mode": _TRIANGLES,
                "extras": {"name": primitive.name},
            }
        )

    binary = buffers.build()
    gltf = {
        "asset": {"version": "2.0", "generator": "track-side offline/mesh/gltf.py"},
        "scene": 0,
        "scenes": [{"nodes": [0], "name": scene_name}],
        "nodes": [{"mesh": 0, "name": node_name}],
        "meshes": [{"name": node_name, "primitives": json_primitives}],
        "materials": [
            {
                "name": m.name,
                "pbrMetallicRoughness": {
                    "baseColorFactor": list(m.base_color),
                    "metallicFactor": m.metallic,
                    "roughnessFactor": m.roughness,
                },
                "doubleSided": m.double_sided,
            }
            for m in materials
        ],
        "buffers": [{"byteLength": len(binary)}],
        "bufferViews": buffer_views,
        "accessors": accessors,
    }

    json_bytes = _pad(json.dumps(gltf, separators=(",", ":")).encode("utf-8"), 4, b" ")
    binary = _pad(binary, 4, b"\x00")

    total_length = 12 + 8 + len(json_bytes) + 8 + len(binary)
    with output_path.open("wb") as f:
        f.write(struct.pack("<III", _GLB_MAGIC, 2, total_length))
        f.write(struct.pack("<II", len(json_bytes), _CHUNK_JSON))
        f.write(json_bytes)
        f.write(struct.pack("<II", len(binary), _CHUNK_BIN))
        f.write(binary)
