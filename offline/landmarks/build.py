"""turn the authored landmark data into the JSON the viewer loads.

the only computation here is deriving board arc lengths from turn-in distances, which is the
whole reason boards are not authored directly: author 4 numbers per corner, get 4 positions that
stay consistent with the geometry when the line is regenerated.
"""

from __future__ import annotations

from offline.landmarks.data import AUTHORING_NOTE, CircuitLandmarks


def _board_positions(corner, loop_length_m: float) -> list[dict]:
    """board arc lengths, measured back along the lap from the corner's turn-in point."""
    return [
        {
            "distance_m": float(distance),
            "s_m": round((corner.turn_in_s_m - distance) % loop_length_m, 2),
        }
        for distance in corner.board_distances_m
    ]


def landmarks_to_json_dict(landmarks: CircuitLandmarks, loop_length_m: float) -> dict:
    return {
        "schema_version": 1,
        "meta": {
            "circuit_name": landmarks.circuit_name,
            "loop_length_m": round(loop_length_m, 2),
            "authoring_note": AUTHORING_NOTE,
        },
        "corners": [
            {
                "id": corner.id,
                "number": corner.number,
                "name": corner.name,
                "s_m": float(corner.s_m),
                "turn_in_s_m": float(corner.turn_in_s_m),
                "board_side": corner.board_side,
                "board_distances_m": [float(d) for d in corner.board_distances_m],
                # derived, not authored: see the module docstring
                "boards": _board_positions(corner, loop_length_m),
            }
            for corner in sorted(landmarks.corners, key=lambda c: c.s_m)
        ],
        "structures": [
            {
                key: value
                for key, value in (
                    ("id", s.id),
                    ("kind", s.kind),
                    ("placement", s.placement),
                    ("s_m", s.s_m),
                    ("offset_m", s.offset_m),
                    ("span_m", s.span_m),
                    ("height_m", s.height_m),
                    ("length_m", s.length_m),
                    ("bank_deg", s.bank_deg),
                    ("width_m", s.width_m),
                    ("polyline_xz", [list(p) for p in s.polyline_xz]),
                )
                if value not in (None, (), [])
            }
            for s in landmarks.structures
        ],
        "runoff": {"default_width_m": landmarks.runoff_width_m, "overrides": []},
    }
