"""where the corners actually are, measured from the generated racing line.

This exists because the authored arc lengths were wrong, and wrong in the one way the earlier
gates were built to miss. `checks.py` opens by saying that "a corner arc length that is 400 m
off just puts a label in a field, and nobody sees it until they look", and then checked only
that the number was inside the lap. Every Monza corner was between 100 m and 340 m short of its
own apex, because the arc lengths were read off a circuit map, in the map's frame, while the
generated line's s = 0 sits wherever the source CSV happened to start.

Nothing sees that until something depends on it. The braking report does: a braking point is
reported against boards derived from a turn-in, so a turn-in on the wrong part of the road
reports a braking point on the wrong part of the road, with two decimal places on it.

So the corners are measured here, against the geometry that ships, and `assert_corners_match_
geometry` holds them there. The arc lengths stay hand-authored rather than becoming another
derived field: which corner deserves a name is a human call, and so is which apex of a chicane
carries its label. What is not a human call is where that apex is.

Run `python -m offline.landmarks.geometry public/monza/line.json` to print the measurements.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

# a 400 m radius is where geometry starts costing a GT3 speed: sqrt(mu*g*r) at mu 1.2 is 68 m/s,
# about 245 km/h, under the 280 km/h these cars reach down Monza's straight. Above that radius
# the road is bending but the car is not cornering, and calling it a corner would put a turn-in
# marker in the middle of a straight.
CORNER_KAPPA_THRESHOLD_1PM = 1.0 / 400.0

# the line is resampled at 1 m and its curvature comes from spline second derivatives, so it
# carries resampling ripple that crosses any threshold several times. 15 m is short enough not
# to move an apex (the tightest corner here, La Source, is 94 m long) and long enough that the
# ripple stops deciding where a corner begins.
CURVATURE_SMOOTH_M = 15.0

# two stretches of curvature closer than this are elements of one corner, not two corners.
# Ascari is three separate spans 11 m and 14 m apart; Eau Rouge and Raidillon are 45 m apart and
# stay two corners, which is also how they are driven and named.
CORNER_MERGE_GAP_M = 40.0


@dataclass(frozen=True)
class CornerSpan:
    """a stretch of road the car has to turn for."""

    start_s_m: float
    apex_s_m: float
    end_s_m: float
    peak_kappa_1pm: float
    turns_left: bool

    @property
    def length_m(self) -> float:
        return self.end_s_m - self.start_s_m


def smoothed_curvature(
    s_m: np.ndarray, kappa_1pm: np.ndarray, smooth_m: float = CURVATURE_SMOOTH_M
) -> np.ndarray:
    """|kappa| through a circular boxcar, on the open lap (the closing duplicate dropped)."""
    n = len(s_m) - 1
    spacing = (s_m[-1] - s_m[0]) / n
    window = max(1, int(round(smooth_m / spacing)))
    if window % 2 == 0:
        window += 1
    kernel = np.ones(window) / window
    # wrap the ends rather than pad: the lap is a loop, and a corner on the start line is a
    # corner
    padded = np.concatenate(
        [np.abs(kappa_1pm[:n])[-window:], np.abs(kappa_1pm[:n]), np.abs(kappa_1pm[:n])[:window]]
    )
    return np.convolve(padded, kernel, mode="same")[window : window + n]


def detect_corner_spans(
    s_m: np.ndarray,
    kappa_1pm: np.ndarray,
    threshold_1pm: float = CORNER_KAPPA_THRESHOLD_1PM,
    merge_gap_m: float = CORNER_MERGE_GAP_M,
) -> list[CornerSpan]:
    """every corner on the lap, in lap order, with its apex at the tightest point.

    The apex is the maximum of smoothed |kappa|, which is also the minimum of the geometric
    speed cap: v_cap = sqrt(mu*g/|kappa|) is monotone in |kappa|, so the slowest point the
    geometry allows is the same point at every grip level. That is what makes it a property of
    the road rather than of a solve.
    """
    n = len(s_m) - 1
    smooth = smoothed_curvature(s_m, kappa_1pm)
    loop = float(s_m[-1])

    above = smooth > threshold_1pm
    if not above.any():
        return []

    # walk from a point that is not cornering, so a corner crossing the start line comes out as
    # one span instead of one at each end of the array
    origin = int(np.argmin(smooth))
    order = [(origin + k) % n for k in range(n)]

    runs: list[list[int]] = []
    current: list[int] | None = None
    for i in order:
        if above[i]:
            if current is None:
                current = [i, i]
            else:
                current[1] = i
        elif current is not None:
            runs.append(current)
            current = None
    if current is not None:
        runs.append(current)

    # merge elements of one corner
    merged: list[list[int]] = []
    for run in runs:
        if merged and (s_m[run[0]] - s_m[merged[-1][1]]) % loop < merge_gap_m:
            merged[-1][1] = run[1]
        else:
            merged.append(run)
    # the pair straddling the walk's origin, which the linear pass above cannot see
    if len(merged) > 1 and (s_m[merged[0][0]] - s_m[merged[-1][1]]) % loop < merge_gap_m:
        merged[-1][1] = merged[0][1]
        merged.pop(0)

    spans: list[CornerSpan] = []
    for start, end in merged:
        steps = (end - start) % n
        indices = [(start + k) % n for k in range(steps + 1)]
        apex = max(indices, key=lambda i: smooth[i])
        spans.append(
            CornerSpan(
                start_s_m=float(s_m[start]),
                apex_s_m=float(s_m[apex]),
                end_s_m=float(s_m[end]),
                peak_kappa_1pm=float(smooth[apex]),
                turns_left=bool(kappa_1pm[apex] > 0),
            )
        )
    return sorted(spans, key=lambda span: span.apex_s_m)


def nearest_span(spans: list[CornerSpan], s: float, loop_length_m: float) -> CornerSpan | None:
    """the corner whose apex is nearest an arc length, the short way round the lap."""
    if not spans:
        return None
    return min(
        spans, key=lambda span: abs((span.apex_s_m - s + loop_length_m / 2) % loop_length_m - loop_length_m / 2)
    )


def _main(argv: list[str] | None = None) -> int:
    import argparse
    import json
    from pathlib import Path

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("line_json", type=Path, help="a generated line.json")
    args = parser.parse_args(argv)

    line = json.loads(args.line_json.read_text())["line"]
    s_m = np.asarray(line["s_m"])
    kappa = np.asarray(line["kappa_1pm"])
    print(f"{args.line_json}: {s_m[-1]:.1f} m lap")
    print(f"{'turn-in':>9} {'apex':>9} {'end':>9} {'length':>8} {'radius':>8}  side")
    for span in detect_corner_spans(s_m, kappa):
        print(
            f"{span.start_s_m:9.0f} {span.apex_s_m:9.0f} {span.end_s_m:9.0f} "
            f"{span.length_m:7.0f}m {1.0 / span.peak_kappa_1pm:7.0f}m  "
            f"{'left' if span.turns_left else 'right'}"
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(_main())
