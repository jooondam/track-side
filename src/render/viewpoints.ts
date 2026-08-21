// named camera positions. The interesting ones are generated, not authored: every corner in
// landmarks.json already carries an arc-length position, so for each one we can find the point on
// the centreline, work out which way the road is bending there, and stand the camera on the
// outside of the turn looking at the apex. "Show me Eau Rouge" costs one click and no new data.
//
// The whole-circuit and start/finish shots are framed on the racing line, since they are about
// where the car goes. The corner shots are framed on the centreline, since a corner's arc length
// is a centreline arc length: see sampleCenterline in ./trackFrame for why those are not the same
// number.

import type { LineData, TrackLines } from "../assets";
import type { Corner } from "../assets";
import { leftNormal } from "./trackFrame";

export type ViewpointKind = "static" | "follow" | "chase";

export interface Viewpoint {
  id: string;
  label: string;
  kind: ViewpointKind;
  /** world position and look-at, for static viewpoints only */
  position?: [number, number, number];
  target?: [number, number, number];
}

const CORNER_OUT_M = 62; // how far outside the turn the camera stands
const CORNER_UP_M = 26;

/** index of the centreline point at an arc length. Corner data is in this frame. */
function indexAtCenterlineS(lines: TrackLines, s: number): number {
  const n = lines.nPoints;
  const loop = lines.centerlineSM[n - 1];
  let i = Math.min(Math.max(Math.round((s / loop) * (n - 1)), 0), n - 1);
  while (i > 0 && lines.centerlineSM[i] > s) i--;
  while (i < n - 2 && lines.centerlineSM[i + 1] < s) i++;
  return i;
}

/**
 * Camera pose for a corner: stand on the outside of the turn, at apex height, looking in.
 * The outside direction comes from the discrete acceleration of the path (the second difference
 * of position), which points at the centre of curvature; the camera goes the other way.
 *
 * Framed on the **centreline**, because corner.sM is a centreline arc length: see sampleCenterline
 * in ./trackFrame. Resolving it on the racing line aimed the camera up to 16 m along the road from
 * the apex it is named after, which at 62 m out is most of a corner's worth of framing error.
 */
function cornerViewpoint(lines: TrackLines, corner: Corner, yScale: number): Viewpoint {
  const n = lines.nPoints;
  const i = indexAtCenterlineS(lines, corner.sM);
  const prev = (i - 12 + n) % n;
  const next = (i + 12) % n;

  const px = lines.centerline[3 * i];
  const py = lines.centerline[3 * i + 1] * yScale;
  const pz = lines.centerline[3 * i + 2];

  // second difference in the ground plane: points toward the inside of the corner
  let ix = lines.centerline[3 * prev] + lines.centerline[3 * next] - 2 * px;
  let iz = lines.centerline[3 * prev + 2] + lines.centerline[3 * next + 2] - 2 * pz;
  const inLen = Math.hypot(ix, iz);

  if (inLen < 1e-6) {
    // effectively straight: fall back to the left-hand normal so the camera still frames the road
    const tx = lines.centerline[3 * next] - lines.centerline[3 * prev];
    const tz = lines.centerline[3 * next + 2] - lines.centerline[3 * prev + 2];
    const [lx, lz] = leftNormal(tx, tz);
    ix = lx;
    iz = lz;
  } else {
    ix /= inLen;
    iz /= inLen;
  }

  return {
    id: `corner:${corner.name}`,
    label: corner.name,
    kind: "static",
    position: [px - ix * CORNER_OUT_M, py + CORNER_UP_M, pz - iz * CORNER_OUT_M],
    target: [px, py, pz],
  };
}

export function buildViewpoints(
  line: LineData,
  trackLines: TrackLines,
  corners: Corner[],
  center: readonly [number, number, number],
  extent: number,
  yScale: number,
  /** >1 pulls the fitted viewpoints back. A portrait phone frames far less width than a desktop
   *  window at the same distance, so the whole-circuit shots have to stand further off. */
  fit = 1,
): Viewpoint[] {
  const startX = line.positionYup[0];
  const startY = line.positionYup[1] * yScale;
  const startZ = line.positionYup[2];
  // look down the road from behind the line, using the first few metres as the direction
  const aheadIdx = Math.min(30, line.nPoints - 1);
  const dx = line.positionYup[3 * aheadIdx] - startX;
  const dz = line.positionYup[3 * aheadIdx + 2] - startZ;
  const dLen = Math.max(Math.hypot(dx, dz), 1e-6);

  return [
    {
      id: "overview",
      label: "Overview",
      kind: "static",
      position: [center[0], extent * 0.5 * fit, center[2] + extent * 0.6 * fit],
      target: [center[0], 0, center[2]],
    },
    {
      id: "top",
      label: "Plan",
      kind: "static",
      // a hair off vertical: exactly overhead makes the orbit controls gimbal-lock
      position: [center[0], extent * 1.1 * fit, center[2] + extent * 0.02],
      target: [center[0], 0, center[2]],
    },
    {
      id: "start",
      label: "Start / finish",
      kind: "static",
      position: [startX - (dx / dLen) * 70, startY + 14, startZ - (dz / dLen) * 70],
      target: [startX + (dx / dLen) * 60, startY, startZ + (dz / dLen) * 60],
    },
    { id: "follow", label: "Follow", kind: "follow" },
    { id: "chase", label: "Chase (low)", kind: "chase" },
    ...corners.map((c) => cornerViewpoint(trackLines, c, yScale)),
  ];
}
