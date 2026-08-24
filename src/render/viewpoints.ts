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

/** the camera's vertical field of view. Scene.tsx sets this on the Canvas and the fitted
 *  viewpoints solve against it, so the two cannot drift apart. */
export const CAMERA_FOV_DEG = 50;

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

/**
 * The distance from `target`, along `dir`, at which every one of `corners` lands inside the
 * frustum.
 *
 * This replaces a hand-tuned scalar. The whole-circuit viewpoints used to stand at a fixed
 * multiple of the circuit's extent, `extent * 0.5` up and `extent * 0.6` back, with a single
 * `fit` number that was 1.7 in portrait and 1 everywhere else. That is not a fit: it never
 * consulted the frame it was composing for, so the same pose had to serve a 1600x900 window with
 * no panels and the much wider, much shorter rectangle left over when the rail and the dock are
 * both open. One of the two was always wrong, and at rest the circuit ran off the bottom edge.
 *
 * The solve is exact and closed-form rather than iterative, because the camera's own offset does
 * not move a point sideways in view space. Put the camera at `target + D * dir` and let
 * `q = P - target`. In the camera's basis the lateral coordinates of P are `q·right` and `q·up`,
 * neither of which contains D; only the depth does, at `D - q·dir`. So containment
 *
 *     |q·right| <= tanH * depth      and      |q·up| <= tanV * depth
 *
 * rearranges to a lower bound on D for each corner, and the answer is the largest of them.
 *
 * `margin` is applied to the tangents rather than to the result, so it is a true border in
 * frame-fraction terms at any aspect: 1.06 keeps the subject off the edge by about 3% a side.
 */
export function fitDistance(
  corners: readonly (readonly [number, number, number])[],
  target: readonly [number, number, number],
  dir: readonly [number, number, number],
  fovDeg: number,
  aspect: number,
  margin = 1.06,
): number {
  const dl = Math.hypot(dir[0], dir[1], dir[2]) || 1;
  const u: [number, number, number] = [dir[0] / dl, dir[1] / dl, dir[2] / dl];

  // a reference that is not parallel to the view direction, so the basis never degenerates. The
  // plan view looks straight down, which is exactly where world up would collapse the cross
  // product to zero.
  const ref: [number, number, number] = Math.abs(u[1]) > 0.999 ? [0, 0, 1] : [0, 1, 0];
  let rx = ref[1] * u[2] - ref[2] * u[1];
  let ry = ref[2] * u[0] - ref[0] * u[2];
  let rz = ref[0] * u[1] - ref[1] * u[0];
  const rl = Math.hypot(rx, ry, rz) || 1;
  rx /= rl;
  ry /= rl;
  rz /= rl;
  const vx = u[1] * rz - u[2] * ry;
  const vy = u[2] * rx - u[0] * rz;
  const vz = u[0] * ry - u[1] * rx;

  const tanV = Math.tan(((fovDeg / 2) * Math.PI) / 180) / margin;
  const tanH = tanV * aspect;

  let d = 0;
  for (const p of corners) {
    const qx = p[0] - target[0];
    const qy = p[1] - target[1];
    const qz = p[2] - target[2];
    const x = Math.abs(qx * rx + qy * ry + qz * rz);
    const y = Math.abs(qx * vx + qy * vy + qz * vz);
    const w = qx * u[0] + qy * u[1] + qz * u[2];
    d = Math.max(d, Math.max(x / tanH, y / tanV) + w);
  }
  return d;
}

/** the eight corners of the racing line's bounding box, with elevation scaled as it is drawn. */
export function lineBoxCorners(line: LineData, yScale: number): [number, number, number][] {
  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;
  let minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < line.nPoints; i++) {
    const x = line.positionYup[3 * i];
    const y = line.positionYup[3 * i + 1] * yScale;
    const z = line.positionYup[3 * i + 2];
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  const out: [number, number, number][] = [];
  for (const x of [minX, maxX]) for (const y of [minY, maxY]) for (const z of [minZ, maxZ]) out.push([x, y, z]);
  return out;
}

export function buildViewpoints(
  line: LineData,
  trackLines: TrackLines,
  corners: Corner[],
  center: readonly [number, number, number],
  yScale: number,
  /** the aspect of the rectangle the chrome leaves uncovered, not the canvas's. The whole-circuit
   *  viewpoints solve their own distance against it, which is what makes them fit a phone in
   *  portrait and a wide short strip between an open rail and an open dock without a hand-tuned
   *  number for either. */
  aspect: number,
  /** the camera's vertical field of view, in degrees */
  fovDeg: number,
): Viewpoint[] {
  const startX = line.positionYup[0];
  const startY = line.positionYup[1] * yScale;
  const startZ = line.positionYup[2];
  // look down the road from behind the line, using the first few metres as the direction
  const aheadIdx = Math.min(30, line.nPoints - 1);
  const dx = line.positionYup[3 * aheadIdx] - startX;
  const dz = line.positionYup[3 * aheadIdx + 2] - startZ;
  const dLen = Math.max(Math.hypot(dx, dz), 1e-6);

  // the two whole-circuit shots keep their composition angle and solve only their distance. The
  // angles are the ones the old fixed poses implied, normalised: a raised three-quarter for the
  // overview, and near vertical for the plan.
  const box = lineBoxCorners(line, yScale);
  const wholeTarget: [number, number, number] = [center[0], 0, center[2]];
  // the margin is larger than fitDistance's own default, and the reason is not taste. The box is
  // the racing line's, and the corner labels are drawn in screen space *outside* it, anchored
  // above their point. A geometric fit to the line alone is therefore not a fit to what is on
  // screen: at 1.06 the plan view put La Source hard against the top edge with its label over the
  // viewpoint pill. This buys back roughly 6% a side, which is the headroom the labels need.
  const LABEL_HEADROOM = 1.14;
  const fitted = (dir: [number, number, number]): [number, number, number] => {
    const d = fitDistance(box, wholeTarget, dir, fovDeg, aspect, LABEL_HEADROOM);
    const l = Math.hypot(dir[0], dir[1], dir[2]) || 1;
    return [
      wholeTarget[0] + (dir[0] / l) * d,
      wholeTarget[1] + (dir[1] / l) * d,
      wholeTarget[2] + (dir[2] / l) * d,
    ];
  };

  return [
    {
      id: "overview",
      label: "Overview",
      kind: "static",
      position: fitted([0, 0.5, 0.6]),
      target: wholeTarget,
    },
    {
      id: "top",
      label: "Plan",
      kind: "static",
      // a hair off vertical: exactly overhead makes the orbit controls gimbal-lock
      position: fitted([0, 1.1, 0.02]),
      target: wholeTarget,
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
