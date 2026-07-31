// named camera positions. The interesting ones are generated, not authored: every corner in
// TRACKS already carries an arc-length position, so for each one we can find the point on the
// racing line, work out which way the line is bending there, and stand the camera on the outside
// of the turn looking at the apex. "Show me Eau Rouge" costs one click and no new data.

import type { LineData } from "../assets";
import type { CornerLabel } from "../tracks";

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

function indexAtS(line: LineData, s: number): number {
  // sM is monotonic; a proportional guess then a short local walk beats a binary search here
  const n = line.nPoints;
  let i = Math.min(Math.max(Math.round((s / line.loopLengthM) * (n - 1)), 0), n - 1);
  while (i > 0 && line.sM[i] > s) i--;
  while (i < n - 2 && line.sM[i + 1] < s) i++;
  return i;
}

/**
 * Camera pose for a corner: stand on the outside of the turn, at apex height, looking in.
 * The outside direction comes from the discrete acceleration of the path (the second difference
 * of position), which points at the centre of curvature; the camera goes the other way.
 */
function cornerViewpoint(line: LineData, corner: CornerLabel, yScale: number): Viewpoint {
  const n = line.nPoints;
  const i = indexAtS(line, corner.sM);
  const prev = (i - 12 + n) % n;
  const next = (i + 12) % n;

  const px = line.positionYup[3 * i];
  const py = line.positionYup[3 * i + 1] * yScale;
  const pz = line.positionYup[3 * i + 2];

  // second difference in the ground plane: points toward the inside of the corner
  let ix = line.positionYup[3 * prev] + line.positionYup[3 * next] - 2 * px;
  let iz = line.positionYup[3 * prev + 2] + line.positionYup[3 * next + 2] - 2 * pz;
  const inLen = Math.hypot(ix, iz);

  if (inLen < 1e-6) {
    // effectively straight: fall back to the left-hand normal so the camera still frames the road
    const tx = line.positionYup[3 * next] - line.positionYup[3 * prev];
    const tz = line.positionYup[3 * next + 2] - line.positionYup[3 * prev + 2];
    const tLen = Math.max(Math.hypot(tx, tz), 1e-6);
    ix = -tz / tLen;
    iz = tx / tLen;
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
  corners: CornerLabel[],
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
    ...corners.map((c) => cornerViewpoint(line, c, yScale)),
  ];
}
