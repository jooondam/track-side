"""minimal glTF 2.0 binary (.glb) writer for the track ribbon. stdlib + numpy only.

hand-written rather than pulling in trimesh/pygltflib: the need is exactly one indexed
triangle mesh with POSITION and NORMAL, which is ~a hundred lines of a well-specified binary
container (12-byte header, JSON chunk, binary chunk, both 4-byte aligned) -- a dependency for
that would outweigh the code. The test suite round-trip parses the output with struct/json,
so the format contract is enforced, not assumed.

coordinate convention: the track frame is right-handed Z-up in metres; glTF mandates
right-handed Y-up. Vertices and normals are rotated (x, y, z) -> (x, z, -y) on export. This is
a proper rotation (det +1), so triangle winding -- and therefore the up-facing orientation the
ribbon builder established -- survives unchanged.
"""

from __future__ import annotations

import json
import struct
from pathlib import Path

import numpy as np

from offline.mesh.ribbon import RibbonMesh

_GLB_MAGIC = 0x46546C67
_CHUNK_JSON = 0x4E4F534A
_CHUNK_BIN = 0x004E4942
_ARRAY_BUFFER = 34962
_ELEMENT_ARRAY_BUFFER = 34963
_UNSIGNED_INT = 5125
_FLOAT = 5126
_TRIANGLES = 4


def _z_up_to_y_up(xyz: np.ndarray) -> np.ndarray:
    return np.column_stack([xyz[:, 0], xyz[:, 2], -xyz[:, 1]])


def _pad(data: bytes, alignment: int, fill: bytes) -> bytes:
    remainder = len(data) % alignment
    return data if remainder == 0 else data + fill * (alignment - remainder)


def write_glb(mesh: RibbonMesh, output_path: Path) -> None:
    """write mesh as a self-contained glTF 2.0 binary file."""
    positions = np.ascontiguousarray(_z_up_to_y_up(mesh.vertices), dtype=np.float32)
    normals = np.ascontiguousarray(_z_up_to_y_up(mesh.normals), dtype=np.float32)
    indices = np.ascontiguousarray(mesh.triangles.reshape(-1), dtype=np.uint32)

    index_bytes = _pad(indices.tobytes(), 4, b"\x00")
    position_bytes = positions.tobytes()
    normal_bytes = normals.tobytes()
    binary = index_bytes + position_bytes + normal_bytes

    gltf = {
        "asset": {"version": "2.0", "generator": "track-side offline/mesh/gltf.py"},
        "scene": 0,
        "scenes": [{"nodes": [0], "name": mesh.circuit_name}],
        "nodes": [{"mesh": 0, "name": f"{mesh.circuit_name} track surface"}],
        "meshes": [
            {
                "name": f"{mesh.circuit_name} ribbon",
                "primitives": [
                    {
                        "attributes": {"POSITION": 1, "NORMAL": 2},
                        "indices": 0,
                        "mode": _TRIANGLES,
                    }
                ],
            }
        ],
        "buffers": [{"byteLength": len(binary)}],
        "bufferViews": [
            {
                "buffer": 0,
                "byteOffset": 0,
                "byteLength": len(indices) * 4,
                "target": _ELEMENT_ARRAY_BUFFER,
            },
            {
                "buffer": 0,
                "byteOffset": len(index_bytes),
                "byteLength": len(position_bytes),
                "target": _ARRAY_BUFFER,
            },
            {
                "buffer": 0,
                "byteOffset": len(index_bytes) + len(position_bytes),
                "byteLength": len(normal_bytes),
                "target": _ARRAY_BUFFER,
            },
        ],
        "accessors": [
            {
                "bufferView": 0,
                "componentType": _UNSIGNED_INT,
                "count": int(len(indices)),
                "type": "SCALAR",
            },
            {
                "bufferView": 1,
                "componentType": _FLOAT,
                "count": int(len(positions)),
                "type": "VEC3",
                # min/max on POSITION is mandatory per spec; loaders use it for bounding boxes
                "min": [float(v) for v in positions.min(axis=0)],
                "max": [float(v) for v in positions.max(axis=0)],
            },
            {
                "bufferView": 2,
                "componentType": _FLOAT,
                "count": int(len(normals)),
                "type": "VEC3",
            },
        ],
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
