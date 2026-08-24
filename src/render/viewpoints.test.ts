// the fitted viewpoints replaced a hand-tuned scalar with a solve, so the solve gets pinned.
// fitDistance is pure and frame-independent, which is the whole reason it lives outside the
// component tree: it can be checked here without r3f, a GPU or a canvas.

import { describe, expect, it } from "vitest";
import { CAMERA_FOV_DEG, fitDistance } from "./viewpoints";

/** where a world point lands in normalised device coordinates, given the same camera the solve
 *  describes. |x| and |y| <= 1 is inside the frame. */
function project(
  p: readonly [number, number, number],
  camPos: readonly [number, number, number],
  target: readonly [number, number, number],
  fovDeg: number,
  aspect: number,
): { x: number; y: number; depth: number } {
  const f = [target[0] - camPos[0], target[1] - camPos[1], target[2] - camPos[2]];
  const fl = Math.hypot(f[0], f[1], f[2]);
  const fwd = [f[0] / fl, f[1] / fl, f[2] / fl];
  const ref = Math.abs(fwd[1]) > 0.999 ? [0, 0, 1] : [0, 1, 0];
  let r = [
    ref[1] * fwd[2] - ref[2] * fwd[1],
    ref[2] * fwd[0] - ref[0] * fwd[2],
    ref[0] * fwd[1] - ref[1] * fwd[0],
  ];
  const rl = Math.hypot(r[0], r[1], r[2]);
  r = [r[0] / rl, r[1] / rl, r[2] / rl];
  const u = [
    r[1] * fwd[2] - r[2] * fwd[1],
    r[2] * fwd[0] - r[0] * fwd[2],
    r[0] * fwd[1] - r[1] * fwd[0],
  ];
  const q = [p[0] - camPos[0], p[1] - camPos[1], p[2] - camPos[2]];
  const depth = q[0] * fwd[0] + q[1] * fwd[1] + q[2] * fwd[2];
  const tanV = Math.tan(((fovDeg / 2) * Math.PI) / 180);
  return {
    x: (q[0] * r[0] + q[1] * r[1] + q[2] * r[2]) / (tanV * aspect * depth),
    y: -(q[0] * u[0] + q[1] * u[1] + q[2] * u[2]) / (tanV * depth),
    depth,
  };
}

const TARGET = [0, 0, 0] as const;
// a deliberately lopsided box, so a solve that only ever looks at one axis cannot pass
const BOX: [number, number, number][] = [];
for (const x of [-900, 700]) for (const y of [-40, 120]) for (const z of [-1300, 400]) BOX.push([x, y, z]);

const DIRS: [string, [number, number, number]][] = [
  ["overview", [0, 0.5, 0.6]],
  ["plan", [0, 1.1, 0.02]],
];

// laptop, desktop, the wide short strip left by an open rail and dock, and a portrait phone
const ASPECTS = [1440 / 836, 1600 / 900, 1320 / 517, 390 / 780];

describe("fitDistance", () => {
  it.each(DIRS)("%s: every corner lands inside the frame, at every aspect", (_id, dir) => {
    for (const aspect of ASPECTS) {
      const d = fitDistance(BOX, TARGET, dir, CAMERA_FOV_DEG, aspect);
      const l = Math.hypot(dir[0], dir[1], dir[2]);
      const cam = [(dir[0] / l) * d, (dir[1] / l) * d, (dir[2] / l) * d] as const;
      for (const c of BOX) {
        const p = project(c, cam, TARGET, CAMERA_FOV_DEG, aspect);
        expect(p.depth, `corner behind the camera at aspect ${aspect}`).toBeGreaterThan(0);
        expect(Math.abs(p.x), `x at aspect ${aspect}`).toBeLessThanOrEqual(1);
        expect(Math.abs(p.y), `y at aspect ${aspect}`).toBeLessThanOrEqual(1);
      }
    }
  });

  it.each(DIRS)("%s: the fit is tight, not merely safe", (_id, dir) => {
    // the margin is 1.06, so the subject should reach ~94% of the frame on its binding axis.
    // Without this, "stand a mile back" would pass the containment test above.
    for (const aspect of ASPECTS) {
      const d = fitDistance(BOX, TARGET, dir, CAMERA_FOV_DEG, aspect);
      const l = Math.hypot(dir[0], dir[1], dir[2]);
      const cam = [(dir[0] / l) * d, (dir[1] / l) * d, (dir[2] / l) * d] as const;
      let worst = 0;
      for (const c of BOX) {
        const p = project(c, cam, TARGET, CAMERA_FOV_DEG, aspect);
        worst = Math.max(worst, Math.abs(p.x), Math.abs(p.y));
      }
      expect(worst, `aspect ${aspect} is framed too loosely`).toBeGreaterThan(0.9);
    }
  });

  it("stands further back as the frame gets narrower", () => {
    const wide = fitDistance(BOX, TARGET, [0, 0.5, 0.6], CAMERA_FOV_DEG, 2.55);
    const laptop = fitDistance(BOX, TARGET, [0, 0.5, 0.6], CAMERA_FOV_DEG, 1.72);
    const phone = fitDistance(BOX, TARGET, [0, 0.5, 0.6], CAMERA_FOV_DEG, 0.5);
    // this is the behaviour the old `portrait ? 1.7 : 1` scalar was standing in for, now derived
    expect(phone).toBeGreaterThan(laptop);
    expect(laptop).toBeGreaterThanOrEqual(wide);
  });

  it("does not degenerate when the view direction is straight down", () => {
    // world up is the natural basis reference and is parallel to this direction, which is where
    // a cross product collapses. The plan view is exactly this case, off by a hair.
    const d = fitDistance(BOX, TARGET, [0, 1, 0], CAMERA_FOV_DEG, 1.72);
    expect(Number.isFinite(d)).toBe(true);
    expect(d).toBeGreaterThan(0);
  });
});
