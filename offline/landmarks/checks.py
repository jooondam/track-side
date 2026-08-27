"""gates on hand-authored landmark data.

everything here exists because the landmark file is the one artifact in the project that is
typed by a human rather than computed. The geometry has a pipeline that would notice a wrong
number; a corner arc length that is 400 m off just puts a label in a field, and nobody sees it
until they look. These turn "I eyeballed it" into "I eyeballed it and it survived four checks
against the generated geometry".
"""

from __future__ import annotations

import numpy as np

from offline.landmarks.data import (
    PLACEMENTS,
    SIDES,
    STRUCTURE_KINDS,
    CircuitLandmarks,
)
from offline.landmarks.geometry import detect_corner_spans, nearest_span


def assert_corner_ids_unique(landmarks: CircuitLandmarks) -> None:
    """raise on a duplicate corner or structure id.

    ids key the viewpoint list and the URL state, so a duplicate silently makes one of the two
    corners unreachable by deep link.
    """
    for label, items in (
        ("corner", [c.id for c in landmarks.corners]),
        ("structure", [s.id for s in landmarks.structures]),
    ):
        seen: set[str] = set()
        duplicates = {i for i in items if i in seen or seen.add(i)}
        if duplicates:
            raise AssertionError(
                f"{landmarks.circuit_name}: duplicate {label} id(s) {sorted(duplicates)}"
            )


def assert_landmarks_on_track(landmarks: CircuitLandmarks, loop_length_m: float) -> None:
    """raise if any authored arc length falls outside the lap, or a corner turns in after it.

    catches the two mistakes this data invites: a number typed for a circuit of a different
    length, and a turn-in placed after its own apex (easy to do at a corner near s = 0, where
    the wrap makes the ordering non-obvious).
    """
    for corner in landmarks.corners:
        for field_name, value in (("s_m", corner.s_m), ("turn_in_s_m", corner.turn_in_s_m)):
            if not 0.0 <= value < loop_length_m:
                raise AssertionError(
                    f"{landmarks.circuit_name} corner {corner.id}: {field_name}={value} is "
                    f"outside the {loop_length_m:.0f} m lap"
                )
        gap = (corner.s_m - corner.turn_in_s_m) % loop_length_m
        if not 0.0 < gap < 400.0:
            raise AssertionError(
                f"{landmarks.circuit_name} corner {corner.id}: turn-in is {gap:.0f} m before "
                f"the apex, which is not a corner entry"
            )
        if corner.board_side not in SIDES:
            raise AssertionError(
                f"{landmarks.circuit_name} corner {corner.id}: board_side "
                f"{corner.board_side!r} is not one of {sorted(SIDES)}"
            )

    for structure in landmarks.structures:
        if structure.kind not in STRUCTURE_KINDS:
            raise AssertionError(
                f"{landmarks.circuit_name} structure {structure.id}: kind {structure.kind!r} "
                f"has no generator; expected one of {sorted(STRUCTURE_KINDS)}"
            )
        if structure.placement not in PLACEMENTS:
            raise AssertionError(
                f"{landmarks.circuit_name} structure {structure.id}: placement "
                f"{structure.placement!r} is not one of {sorted(PLACEMENTS)}"
            )
        if structure.placement == "track":
            if structure.s_m is None or not 0.0 <= structure.s_m < loop_length_m:
                raise AssertionError(
                    f"{landmarks.circuit_name} structure {structure.id}: track placement needs "
                    f"an s_m inside the {loop_length_m:.0f} m lap, got {structure.s_m}"
                )
        elif len(structure.polyline_xz) < 2:
            raise AssertionError(
                f"{landmarks.circuit_name} structure {structure.id}: world placement needs a "
                f"polyline of at least two points"
            )


# 25 m is a quarter of the shortest corner on either circuit and about a car length and a half of
# braking at GT3 speeds. Wide enough that a re-fit of the line moving an apex by a few metres is
# not a failure, narrow enough that no corner can drift onto the straight before it.
CORNER_MATCH_TOLERANCE_M = 25.0


def assert_corners_match_geometry(
    landmarks: CircuitLandmarks,
    s_m,
    kappa_1pm,
    loop_length_m: float,
    tolerance_m: float = CORNER_MATCH_TOLERANCE_M,
) -> None:
    """raise if an authored corner is not on the corner it names.

    This is the gate that was missing, and its absence is the reason the module docstring above
    is written the way it is. Every check here used to be internal to the landmark file: ids
    unique, arc lengths inside the lap, boards ordered, structures off the road. All of them
    passed on Monza corner data that sat up to 340 m short of the corners it named, because
    nothing compared the numbers to the road.

    A corner matches when its apex is within `tolerance_m` of a detected apex and its turn-in is
    within `tolerance_m` of where that corner's curvature begins. Two named corners may not
    claim the same stretch of road, which is what catches a plausible-looking number that has
    landed on its neighbour.
    """
    spans = detect_corner_spans(s_m, kappa_1pm)
    if not spans:
        raise AssertionError(
            f"{landmarks.circuit_name}: no corners detected in the generated line, so the "
            f"authored ones cannot be checked against anything"
        )

    claimed: dict[float, str] = {}
    for corner in landmarks.corners:
        span = nearest_span(spans, corner.s_m, loop_length_m)
        assert span is not None  # spans is non-empty
        apex_error = abs((span.apex_s_m - corner.s_m + loop_length_m / 2) % loop_length_m - loop_length_m / 2)
        if apex_error > tolerance_m:
            raise AssertionError(
                f"{landmarks.circuit_name} corner {corner.id} ({corner.name}): apex authored at "
                f"s={corner.s_m:.0f} but the nearest corner in the geometry apexes at "
                f"s={span.apex_s_m:.0f}, {apex_error:.0f} m away. Measure it with "
                f"`python -m offline.landmarks.geometry` rather than off a circuit map"
            )

        owner = claimed.get(span.apex_s_m)
        if owner is not None:
            raise AssertionError(
                f"{landmarks.circuit_name} corners {owner} and {corner.id} ({corner.name}) both "
                f"claim the corner apexing at s={span.apex_s_m:.0f}"
            )
        claimed[span.apex_s_m] = corner.id

        turn_in_error = abs(
            (span.start_s_m - corner.turn_in_s_m + loop_length_m / 2) % loop_length_m - loop_length_m / 2
        )
        if turn_in_error > tolerance_m:
            raise AssertionError(
                f"{landmarks.circuit_name} corner {corner.id} ({corner.name}): turn-in authored "
                f"at s={corner.turn_in_s_m:.0f} but the road starts bending at "
                f"s={span.start_s_m:.0f}, {turn_in_error:.0f} m away. Every braking board hangs "
                f"off this number"
            )


def assert_boards_do_not_cross_previous_corner(
    landmarks: CircuitLandmarks, loop_length_m: float
) -> None:
    """raise if a braking board would sit before the preceding corner's apex.

    a 300 m board for a corner that is only 250 m past the last one belongs to neither, and on
    track it would stand in a place a driver reads as the exit of the corner before. this is the
    check that makes deriving boards from turn-in distances safe: the derivation cannot know
    that two corners are close together, but this does.
    """
    ordered = sorted(landmarks.corners, key=lambda c: c.s_m)
    for index, corner in enumerate(ordered):
        if not corner.board_distances_m:
            continue
        previous = ordered[index - 1]  # wraps to the last corner for index 0
        available = (corner.turn_in_s_m - previous.s_m) % loop_length_m
        furthest = max(corner.board_distances_m)
        if furthest > available:
            raise AssertionError(
                f"{landmarks.circuit_name} corner {corner.id}: its {furthest:.0f} m board "
                f"would sit {furthest - available:.0f} m before {previous.id}'s apex, which is "
                f"only {available:.0f} m back"
            )


def assert_structure_offsets_clear_the_boundary(
    landmarks: CircuitLandmarks, track, clearance_m: float = 2.0
) -> None:
    """raise if a track-placed structure would stand on the road.

    the offset is from the centreline, so the check needs the local half width rather than a
    constant: Spa's road ranges from about 10 m to 20 m across, and a 12 m offset is roadside in
    one place and on the racing line in another.
    """
    half_width = 0.5 * (track.w_tr_left_m + track.w_tr_right_m)
    for structure in landmarks.structures:
        if structure.placement != "track":
            continue
        # gantries and bridges span the road on purpose; they are overhead, not beside it
        if structure.kind in ("gantry", "bridge"):
            continue
        index = int(np.argmin(np.abs(track.s_m - structure.s_m)))
        limit = float(half_width[index]) + clearance_m
        if abs(structure.offset_m) < limit:
            raise AssertionError(
                f"{landmarks.circuit_name} structure {structure.id}: offset "
                f"{structure.offset_m:+.1f} m is inside the road edge at s={structure.s_m:.0f} "
                f"(needs at least {limit:.1f} m of clearance)"
            )


def assert_no_text_on_structures(landmarks: CircuitLandmarks) -> None:
    """the licensing rule, made mechanical.

    docs/DESIGN_NOTES.md section 5: structures carry no text other than turn numbers and board
    distances. No sponsor boards, no circuit device marks, no wordmarks. The schema has no field
    that could carry a string onto a surface, and this asserts that stays true, so the rule
    holds by construction rather than by remembering it during the next authoring pass.
    """
    allowed = {
        "id", "kind", "placement", "s_m", "offset_m", "span_m", "height_m",
        "length_m", "bank_deg", "width_m", "polyline_xz",
    }
    for structure in landmarks.structures:
        extra = set(vars(structure)) - allowed
        if extra:
            raise AssertionError(
                f"{landmarks.circuit_name} structure {structure.id}: unexpected field(s) "
                f"{sorted(extra)}; anything that could render text needs a licensing review"
            )


def run_all_landmark_checks(landmarks: CircuitLandmarks, track, line) -> None:
    """every gate, against the geometry that was just generated.

    takes the fitted line rather than only its length, because the corner gate needs the road's
    curvature and not just the lap's size.
    """
    assert_corner_ids_unique(landmarks)
    assert_landmarks_on_track(landmarks, line.loop_length_m)
    assert_corners_match_geometry(landmarks, line.s_m, line.kappa_1pm, line.loop_length_m)
    assert_boards_do_not_cross_previous_corner(landmarks, line.loop_length_m)
    assert_structure_offsets_clear_the_boundary(landmarks, track)
    assert_no_text_on_structures(landmarks)
