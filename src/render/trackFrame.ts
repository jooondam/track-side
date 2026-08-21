// where "left of the road" is, and how to find the road edge at an arc length.
//
// **This module exists because the sign was wrong in three places at once.** Landmarks and
// BrakingMarkers each derived an outboard normal inline, both wrote `(-dz, dx)`, and both
// commented it as the left normal. It is the right normal, and the effect was not subtle:
// measured against the shipped Spa geometry, 463 of ~700 fence posts stood *inside* the road
// edges, up to 7.55 m deep, and braking cones sat on the racing surface. Three call sites
// deriving the same quantity independently is how that survived.
//
// The frame, derived once so it does not have to be re-argued:
//
//   The track pipeline works z-up with the left normal of a tangent (tx, ty) at (-ty, tx)
//   (offline/geometry/boundaries.py). Assets are exported (x, y, z) -> (x, z, -y)
//   (offline/build_viewer_assets.py), which mirrors the ground plane and by itself would swap
//   left and right. In three's y-up right-handed frame, left is up x forward = (Tz, -Tx). Push
//   the z-up left normal through the export and you get (-ty, -tx); with T = (tx, -ty) the y-up
//   formula gives the same (-ty, -tx). The two flips cancel: **left really is (tz, -tx)**, and
//   boundaryLeft really is the driver's left.

/** left of a ground-plane heading, in the glTF y-up frame. Not normalised; the input need not be. */
export function leftNormal(dx: number, dz: number): [number, number] {
  const len = Math.max(Math.hypot(dx, dz), 1e-6);
  return [dz / len, -dx / len];
}

export type Side = "left" | "right";

/** a point on the track with its ground-plane heading. */
export interface Frame {
  x: number;
  y: number;
  z: number;
  /** unit heading */
  tx: number;
  tz: number;
}

interface BoundarySource {
  nPoints: number;
  centerline: Float64Array | Float32Array;
  centerlineSM: Float64Array | Float32Array;
  boundaryLeft: Float64Array | Float32Array;
  boundaryRight: Float64Array | Float32Array;
}

/** largest index i with s[i] <= value, on a monotone array. */
function indexAtS(s: ArrayLike<number>, value: number, n: number): number {
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (s[mid] <= value) lo = mid;
    else hi = mid;
  }
  return lo;
}

/**
 * a point on a polyline at an arc length, with the heading there.
 *
 * `stride` selects which polyline: they all share the centreline's index and arc length, which is
 * the whole reason landmark data can be a list of arc lengths and nothing else.
 */
function sampleAt(
  lines: BoundarySource,
  s: number,
  points: Float64Array | Float32Array,
): Frame {
  const n = lines.nPoints;
  const sm = lines.centerlineSM;
  const loop = sm[n - 1];
  const q = ((s % loop) + loop) % loop;

  const i = indexAtS(sm, q, n);
  const j = Math.min(i + 1, n - 1);
  const f = (q - sm[i]) / Math.max(sm[j] - sm[i], 1e-9);

  const x = points[3 * i] + f * (points[3 * j] - points[3 * i]);
  const y = points[3 * i + 1] + f * (points[3 * j + 1] - points[3 * i + 1]);
  const z = points[3 * i + 2] + f * (points[3 * j + 2] - points[3 * i + 2]);

  // heading from a span rather than one segment: at 1 m point spacing a single segment is mostly
  // quantisation noise, and the objects placed with this are metres long
  const ahead = Math.min(i + 8, n - 1);
  const back = Math.max(i - 8, 0);
  const dx = points[3 * ahead] - points[3 * back];
  const dz = points[3 * ahead + 2] - points[3 * back + 2];
  const len = Math.max(Math.hypot(dx, dz), 1e-6);
  return { x, y, z, tx: dx / len, tz: dz / len };
}

/**
 * the middle of the road at an arc length.
 *
 * **Landmark arc lengths are centreline arc lengths.** They are authored against the track
 * geometry in offline/landmarks/data.py and gated against it by offline/landmarks/checks.py, so
 * this is the frame they mean. Resolving them on the racing line instead — which is what the
 * viewer used to do — is wrong by up to 16 m: the two are different parameterisations of the same
 * lap (Spa 6999.70 m of centreline against 7005.28 m of line) and the drift between them is
 * mostly longitudinal, since the line runs short through apexes and long down the straights.
 *
 * 16 m is a car and a half. It stood gantry legs on the racing surface, put turn signs past their
 * own corner, and aimed the corner cameras down the road from the apex.
 */
export function sampleCenterline(lines: BoundarySource, s: number): Frame {
  return sampleAt(lines, s, lines.centerline);
}

/**
 * the road edge at an arc length, on a given side, with the heading there.
 *
 * Trackside objects hang off this rather than off the racing line. The racing line is not the
 * middle of the road: at Spa it wanders up to 7.44 m from the centreline (median 2.96 m) while
 * the mean half-width is only 4.9 m, so a fixed offset from the line lands on the far side of
 * the road at every apex. Offsetting from the edge is the only version that cannot.
 */
export function sampleBoundary(lines: BoundarySource, s: number, side: Side): Frame {
  return sampleAt(lines, s, side === "left" ? lines.boundaryLeft : lines.boundaryRight);
}

/**
 * move a frame outboard, away from the road.
 *
 * Outboard is left of travel on the left edge and right of travel on the right edge, which is
 * the sign that was inverted. Returns ground-plane offsets only; callers own the height.
 */
export function outboard(frame: Frame, side: Side, metres: number): [number, number] {
  const [lx, lz] = leftNormal(frame.tx, frame.tz);
  const sign = side === "left" ? 1 : -1;
  return [frame.x + lx * sign * metres, frame.z + lz * sign * metres];
}
