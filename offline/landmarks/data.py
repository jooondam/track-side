"""hand-authored circuit landmarks: corners, braking boards and trackside structures.

These are estimates placed from circuit maps and broadcast footage. There is no survey behind
any of them, and the schema says so in its own metadata rather than leaving a reader to find out
from a commit message. Arc lengths are in the frame of the *generated* racing line, which is why
this is written out in the same run as line.json instead of living in the frontend: the numbers
are only meaningful against the geometry that produced them.

Why not src/tracks.ts, where the corner list used to live:

  - it is 100+ entries per circuit once boards are counted, and a TS module ships every
    circuit's data to every visitor in the JS bundle
  - the arc lengths want validating against generated geometry, which is a Python job
  - the s frame has to be the generated line's frame, so it has to be written by the same run

**Board positions are derived, never authored.** Each corner carries a turn-in arc length and a
list of board distances, and the boards fall out as turn_in_s - distance. That removes about
forty hand-typed numbers per circuit and, more importantly, keeps the boards consistent with the
geometry by construction: regenerate the line and they move with it.

Licensing (docs/DESIGN_NOTES.md section 5): structures may carry **no text** other than turn
numbers and board distances. No sponsor boards, no circuit device marks, no wordmarks. Keeping
that rule in the schema makes it true by construction rather than by vigilance, and it is what
keeps the OpenF1 attribution clause clean.
"""

from __future__ import annotations

from dataclasses import dataclass, field

# the closed vocabulary of procedural generators src/render/structures/ implements. a kind that
# is not in this set has no generator and would silently render as nothing.
STRUCTURE_KINDS = frozenset(
    {
        "gantry",
        "bridge",
        # the generator exists and works, but no grandstand is authored on either circuit: the
        # lateral offsets here are eyeballed, and at 26 to 34 m they put a stand between the
        # corner cameras and the racing surface. Re-adding one needs a pass over the offsets
        # against the real boundary, not another guess.
        "grandstand",
        "pit_building",
        "banking_remnant",
        "tree_line",
        "marshal_post",
        "tyre_wall",
        "catch_fence",
    }
)

PLACEMENTS = frozenset({"track", "world"})
SIDES = frozenset({"left", "right"})

DEFAULT_BOARD_DISTANCES_M = (300.0, 200.0, 100.0, 50.0)
DEFAULT_RUNOFF_WIDTH_M = 12.0

AUTHORING_NOTE = (
    "hand-placed from circuit maps and broadcast footage; estimates, no survey. "
    "arc lengths are in the generated racing line's frame."
)


@dataclass(frozen=True)
class Corner:
    id: str
    number: int
    name: str
    s_m: float
    """apex, roughly: where the label hangs and where the corner camera looks."""
    turn_in_s_m: float
    """where the car starts turning. boards are measured back from here, not from the apex."""
    board_side: str = "right"
    board_distances_m: tuple[float, ...] = DEFAULT_BOARD_DISTANCES_M


@dataclass(frozen=True)
class Structure:
    id: str
    kind: str
    placement: str = "track"
    s_m: float | None = None
    offset_m: float = 0.0
    """signed lateral offset from the centreline; positive is left. 'track' placement only."""
    span_m: float = 10.0
    height_m: float = 6.0
    length_m: float = 30.0
    bank_deg: float = 0.0
    width_m: float = 10.0
    polyline_xz: tuple[tuple[float, float], ...] = ()
    """explicit world polyline for 'world' placement, in the glTF ground plane."""


@dataclass(frozen=True)
class CircuitLandmarks:
    circuit_id: str
    circuit_name: str
    corners: list[Corner]
    structures: list[Structure] = field(default_factory=list)
    runoff_width_m: float = DEFAULT_RUNOFF_WIDTH_M


# ---- Spa-Francorchamps -------------------------------------------------------------------
#
# every arc length below is measured from the shipped line, not read off a circuit map:
#
#     python -m offline.landmarks.geometry public/spa/line.json
#
# prints the span, apex and radius of every corner on the lap, and `assert_corners_match_
# geometry` holds these numbers to within 25 m of that measurement. The apex is the tightest
# point of the corner and the turn-in is where the road first bends past a 400 m radius. What is
# still hand-authored is which corners get a name, which apex of a complex carries it, and where
# the boards go. Eau Rouge and Raidillon are taken flat by a GT3 in the dry, so they carry none.
#
# Spa's numbers were close to begin with (La Source was 5 m out) because its source CSV happens
# to start near the start line. Monza's were not. See offline/landmarks/geometry.py.

SPA = CircuitLandmarks(
    circuit_id="spa",
    circuit_name="Spa",
    corners=[
        Corner("t1", 1, "La Source", s_m=414, turn_in_s_m=352),
        Corner("t2", 2, "Eau Rouge", s_m=1062, turn_in_s_m=1051, board_distances_m=()),
        Corner("t3", 3, "Raidillon", s_m=1167, turn_in_s_m=1117, board_distances_m=()),
        # the detector merges Les Combes with Malmedy and Bruxelles with Speaker's, because a
        # GT3 turns through each pair without the road straightening between them. The name and
        # the label go on the first apex, which is the one that sets the entry
        Corner("t5", 5, "Les Combes", s_m=2434, turn_in_s_m=2375, board_side="left"),
        Corner("t8", 8, "Bruxelles", s_m=3105, turn_in_s_m=2967),
        Corner("t10", 10, "Pouhon", s_m=3853, turn_in_s_m=3757, board_distances_m=(200, 100, 50)),
        Corner("t12", 12, "Stavelot", s_m=4959, turn_in_s_m=4888, board_side="left"),
        Corner("t14", 14, "Blanchimont", s_m=5909, turn_in_s_m=5850, board_distances_m=()),
        Corner("t18", 18, "Bus Stop", s_m=6748, turn_in_s_m=6715),
    ],
    structures=[
        Structure("start_gantry", "gantry", s_m=20, span_m=20.0, height_m=8.0),
        Structure("eau_rouge_gantry", "gantry", s_m=1050, span_m=18.0, height_m=7.5),
        Structure("kemmel_gantry", "gantry", s_m=2100, span_m=18.0, height_m=7.5),
        Structure("pit_building", "pit_building", s_m=250, offset_m=22.0, length_m=420.0,
                  height_m=11.0),
        Structure("bus_stop_bridge", "bridge", s_m=6700, span_m=22.0, height_m=9.0),
        Structure("kemmel_trees_left", "tree_line", s_m=1800, offset_m=-46.0, length_m=700.0),
        Structure("kemmel_trees_right", "tree_line", s_m=1800, offset_m=46.0, length_m=700.0),
        Structure("pouhon_trees", "tree_line", s_m=4300, offset_m=44.0, length_m=900.0),
        Structure("stavelot_trees", "tree_line", s_m=5200, offset_m=-44.0, length_m=800.0),
        Structure("blanchimont_trees", "tree_line", s_m=5800, offset_m=48.0, length_m=650.0),
    ],
)


# ---- Monza -------------------------------------------------------------------------------
#
# the old banked oval is 'world' placement, not 'track': it does not follow the modern circuit,
# which is the whole reason that placement mode exists. the polyline below is a coarse trace of
# the surviving north curve, in the glTF ground plane.

MONZA = CircuitLandmarks(
    circuit_id="monza",
    circuit_name="Monza",
    corners=[
        # measured, not mapped: every number here was between 100 m and 340 m short of its own
        # apex until 2026-08-27, because they were read off a circuit map in the map's frame
        # while this line's s = 0 sits wherever the source CSV starts. See geometry.py
        Corner("t1", 1, "Variante del Rettifilo", s_m=972, turn_in_s_m=905),
        Corner("t3", 3, "Curva Grande", s_m=1439, turn_in_s_m=1318, board_distances_m=(200, 100, 50)),
        Corner("t4", 4, "Variante della Roggia", s_m=2136, turn_in_s_m=2100, board_side="left"),
        # the Lesmos are 300 m apart and Lesmo 1's own 300 board lands 13 m past Roggia's apex,
        # which is as tight as the board gate allows and is also how the circuit really is
        Corner("t6", 6, "Lesmo 1", s_m=2551, turn_in_s_m=2449),
        # so Lesmo 2 gets a short board set: a 300 m board for it would stand before Lesmo 1's
        # apex, which is what the board gate caught here
        Corner("t7", 7, "Lesmo 2", s_m=2869, turn_in_s_m=2818, board_distances_m=(200, 100, 50)),
        Corner("t8", 8, "Variante Ascari", s_m=3929, turn_in_s_m=3894, board_side="left"),
        Corner("t11", 11, "Parabolica", s_m=5191, turn_in_s_m=5075),
    ],
    structures=[
        Structure("start_gantry", "gantry", s_m=15, span_m=22.0, height_m=8.5),
        # moved with the corners: at 500 it stood on the straight a third of a lap from the
        # chicane it is named for. structures carry no gate of their own, so the rest of this
        # list is still eyeballed, and only the ones named for a corner were corrected
        Structure("rettifilo_gantry", "gantry", s_m=820, span_m=20.0, height_m=8.0),
        Structure("pit_building", "pit_building", s_m=200, offset_m=24.0, length_m=380.0,
                  height_m=12.0),
        Structure("serraglio_bridge", "bridge", s_m=3400, span_m=24.0, height_m=9.0),
        Structure("park_trees_north", "tree_line", s_m=2600, offset_m=-50.0, length_m=1200.0),
        Structure("park_trees_south", "tree_line", s_m=3600, offset_m=50.0, length_m=1400.0),
        Structure(
            "old_banking",
            "banking_remnant",
            placement="world",
            bank_deg=21.0,
            width_m=10.0,
            polyline_xz=(
                (-260.0, -520.0),
                (-120.0, -640.0),
                (60.0, -690.0),
                (240.0, -660.0),
                (380.0, -560.0),
            ),
        ),
    ],
)


CIRCUITS = {"spa": SPA, "monza": MONZA}
