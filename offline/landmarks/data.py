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
        "grandstand",
        "bridge",
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
# turn-in estimates sit ahead of each apex by roughly the length of the entry phase: short for a
# hairpin like La Source, long for a fast entry like Pouhon. Eau Rouge and Raidillon are taken
# flat by a GT3 in the dry, so they carry no boards.

SPA = CircuitLandmarks(
    circuit_id="spa",
    circuit_name="Spa",
    corners=[
        Corner("t1", 1, "La Source", s_m=420, turn_in_s_m=395),
        Corner("t2", 2, "Eau Rouge", s_m=1050, turn_in_s_m=1010, board_distances_m=()),
        Corner("t3", 3, "Raidillon", s_m=1250, turn_in_s_m=1215, board_distances_m=()),
        Corner("t5", 5, "Les Combes", s_m=2650, turn_in_s_m=2610, board_side="left"),
        Corner("t8", 8, "Bruxelles", s_m=3350, turn_in_s_m=3305),
        Corner("t10", 10, "Pouhon", s_m=4100, turn_in_s_m=4030, board_distances_m=(200, 100, 50)),
        Corner("t12", 12, "Stavelot", s_m=5000, turn_in_s_m=4955, board_side="left"),
        Corner("t14", 14, "Blanchimont", s_m=5900, turn_in_s_m=5850, board_distances_m=()),
        Corner("t18", 18, "Bus Stop", s_m=6800, turn_in_s_m=6750),
    ],
    structures=[
        Structure("start_gantry", "gantry", s_m=20, span_m=20.0, height_m=8.0),
        Structure("eau_rouge_gantry", "gantry", s_m=1050, span_m=18.0, height_m=7.5),
        Structure("kemmel_gantry", "gantry", s_m=2100, span_m=18.0, height_m=7.5),
        Structure("pit_building", "pit_building", s_m=250, offset_m=22.0, length_m=420.0,
                  height_m=11.0),
        Structure("main_grandstand", "grandstand", s_m=300, offset_m=-30.0, length_m=180.0,
                  height_m=14.0),
        Structure("source_grandstand", "grandstand", s_m=430, offset_m=26.0, length_m=90.0,
                  height_m=11.0),
        Structure("raidillon_grandstand", "grandstand", s_m=1200, offset_m=-34.0,
                  length_m=140.0, height_m=12.0),
        Structure("combes_grandstand", "grandstand", s_m=2680, offset_m=30.0, length_m=110.0,
                  height_m=11.0),
        Structure("pouhon_grandstand", "grandstand", s_m=4130, offset_m=-32.0, length_m=95.0,
                  height_m=10.0),
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
        Corner("t1", 1, "Variante del Rettifilo", s_m=620, turn_in_s_m=580),
        Corner("t3", 3, "Curva Grande", s_m=1100, turn_in_s_m=1040, board_distances_m=(200, 100, 50)),
        Corner("t4", 4, "Variante della Roggia", s_m=1850, turn_in_s_m=1810, board_side="left"),
        Corner("t6", 6, "Lesmo 1", s_m=2450, turn_in_s_m=2410),
        # the Lesmos are only 300 m apart, so Lesmo 2 gets a short board set: a 300 m board for
        # it would stand before Lesmo 1's apex, which is what the board gate caught here
        Corner("t7", 7, "Lesmo 2", s_m=2750, turn_in_s_m=2715, board_distances_m=(200, 100, 50)),
        Corner("t8", 8, "Variante Ascari", s_m=4000, turn_in_s_m=3955, board_side="left"),
        Corner("t11", 11, "Parabolica", s_m=5000, turn_in_s_m=4930),
    ],
    structures=[
        Structure("start_gantry", "gantry", s_m=15, span_m=22.0, height_m=8.5),
        Structure("rettifilo_gantry", "gantry", s_m=500, span_m=20.0, height_m=8.0),
        Structure("pit_building", "pit_building", s_m=200, offset_m=24.0, length_m=380.0,
                  height_m=12.0),
        Structure("main_grandstand", "grandstand", s_m=250, offset_m=-32.0, length_m=200.0,
                  height_m=15.0),
        Structure("rettifilo_grandstand", "grandstand", s_m=640, offset_m=28.0, length_m=120.0,
                  height_m=12.0),
        Structure("ascari_grandstand", "grandstand", s_m=4030, offset_m=-30.0, length_m=100.0,
                  height_m=10.0),
        Structure("parabolica_grandstand", "grandstand", s_m=5050, offset_m=34.0, length_m=160.0,
                  height_m=13.0),
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
