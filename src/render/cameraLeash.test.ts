import { describe, expect, it } from "vitest";
import { CAMERA_LEASH_K, cameraLeashM, leashScale } from "./cameraLeash";
import { fieldRadii, terrainAnchorXz } from "./terrainGrid";
import { CAMERA_FOV_DEG, fitDistance, lineBoxCorners } from "./viewpoints";
import monzaLine from "../../public/monza/line.json";
import spaLine from "../../public/spa/line.json";

// the two shipped circuits, from public/<id>/terrain.json meta, and Scene.tsx's `extent`
// (the racing line's widest bounding-box span) measured from line.json
const CIRCUITS = [
  { id: "spa", nCells: 200, x0: -844.69, z0: -1059.76, dx: 10.8484, dz: 17.428, extent: 2048.6 },
  { id: "monza", nCells: 200, x0: -445.15, z0: -2449.6, dx: 10.7146, dz: 18.5444, extent: 2173.5 },
];

describe("leashScale", () => {
  it("leaves a camera inside the circle alone", () => {
    expect(leashScale(100, 200, 5000)).toBe(1);
    expect(leashScale(0, 0, 5000)).toBe(1);
    // exactly on the boundary is inside: the clamp must not chatter there
    expect(leashScale(5000, 0, 5000)).toBe(1);
  });

  it("puts a camera outside the circle exactly on it", () => {
    const leash = 5000;
    for (const [dx, dz] of [
      [9000, 0],
      [-12000, 3000],
      [1, 40000],
      [-700, -700],
    ]) {
      const k = leashScale(dx, dz, leash);
      const pulled = Math.hypot(dx * k, dz * k);
      if (Math.hypot(dx, dz) > leash) expect(pulled).toBeCloseTo(leash, 6);
      else expect(k).toBe(1);
    }
  });

  it("never returns NaN for a degenerate offset or leash", () => {
    // a camera exactly over the anchor has no radial direction to be pulled along, and a
    // zero leash would otherwise divide by a zero distance. Both must be no-ops, because the
    // caller multiplies camera.position by this and a NaN there loses the frame.
    expect(leashScale(0, 0, 0)).toBe(1);
    expect(Number.isFinite(leashScale(0, 0, 5000))).toBe(true);
    expect(Number.isFinite(leashScale(10, 10, 0))).toBe(true);
  });

  it("is direction-preserving", () => {
    // the clamp slides the camera along the boundary rather than swinging it: the pulled-back
    // offset has to point the same way as the original
    const k = leashScale(8000, 6000, 5000);
    expect((8000 * k) / (6000 * k)).toBeCloseTo(8000 / 6000, 9);
    expect(k).toBeGreaterThan(0);
  });
});

/** the racing line as the viewer holds it, from the JSON that ships. */
function lineOf(json: { line: { position_yup: number[][] } }) {
  const rows = json.line.position_yup;
  const positionYup = new Float32Array(rows.length * 3);
  for (let i = 0; i < rows.length; i++) {
    positionYup[3 * i] = rows[i][0];
    positionYup[3 * i + 1] = rows[i][1];
    positionYup[3 * i + 2] = rows[i][2];
  }
  return { positionYup, nPoints: rows.length };
}

const LINES: Record<string, { positionYup: Float32Array; nPoints: number }> = {
  spa: lineOf(spaLine),
  monza: lineOf(monzaLine),
};

describe("the leash against the terrain fade", () => {
  for (const c of CIRCUITS) {
    it(`${c.id}: a camera on the leash still has field under it`, () => {
      // **the guarantee the leash exists for.** The dots reach zero at fadeEnd, measured from
      // the same anchor, so a camera allowed past it stands in a hole with the occluder plate's
      // straight edge on show. This is the assertion that the two radii compose; the matching
      // one in terrainGrid.test.ts guards the other side, the geometry boundary.
      const { fadeStart, fadeEnd } = fieldRadii(c, c.extent);
      const leash = cameraLeashM(c.extent);
      expect(leash).toBeLessThan(fadeEnd);
      // and not by a hair: fadeEnd is derived from the plate's inscribed radius, and a metre of
      // clearance is a rounding error away from being none.
      //
      // **Monza is the binding case at 256 m**, which is 6 m over this floor. Spa has 581 m.
      // The asymmetry is the heightfield's: outerRadius comes off min(halfX, halfZ), and Monza's
      // short axis is the shorter of the two. Anything that moves CAMERA_LEASH_K, SKIRT_REACH_M
      // or fieldRadii's 0.97 will trip this at Monza first, which is the point of it.
      expect(fadeEnd - leash).toBeGreaterThan(250);
      // the leash is outside fadeStart, so it does not quietly cost the overview its reach
      expect(leash).toBeGreaterThan(fadeStart);
    });

    it(`${c.id}: the shipped whole-circuit shots sit inside the leash`, () => {
      // If a shipped viewpoint were outside the leash, flyTo would clamp it and the framing
      // fitDistance solved for would silently change. Solved here from the same line box and the
      // same fit the app uses, rather than modelled, because the poses stopped being a scalar
      // times the extent when the viewpoints started solving for the frame they land in.
      //
      // Every aspect the app can present, including a portrait phone with both panels open. The
      // worst case is the overview at 0.46, and it is 3802 m at Spa against a 5122 m leash.
      const anchor = terrainAnchorXz(c);
      const leash = cameraLeashM(c.extent);
      const line = LINES[c.id];
      const p = line.positionYup;
      let minX = Infinity,
        maxX = -Infinity,
        minZ = Infinity,
        maxZ = -Infinity;
      for (let i = 0; i < line.nPoints; i++) {
        minX = Math.min(minX, p[3 * i]);
        maxX = Math.max(maxX, p[3 * i]);
        minZ = Math.min(minZ, p[3 * i + 2]);
        maxZ = Math.max(maxZ, p[3 * i + 2]);
      }
      const center = [(minX + maxX) / 2, 0, (minZ + maxZ) / 2] as const;
      const box = lineBoxCorners(line as never, 1);

      for (const dir of [
        [0, 0.55, 1],
        [0, 1, 0.02],
      ] as const) {
        for (const aspect of [0.46, 0.65, 1.0, 1.6, 2.0, 2.9]) {
          const d = fitDistance(box, center, dir, CAMERA_FOV_DEG, aspect, 1.15);
          const dl = Math.hypot(dir[0], dir[1], dir[2]);
          const fromAnchor = Math.hypot(
            center[0] + (dir[0] / dl) * d - anchor.x,
            center[2] + (dir[2] / dl) * d - anchor.z,
          );
          expect(fromAnchor).toBeLessThan(leash);
        }
      }
    });
  }

  it("keeps the leash constant where the fade was tuned for it", () => {
    // a bare guard on the constant itself: the clearances above are the whole margin.
    expect(CAMERA_LEASH_K).toBe(2.5);
    expect(cameraLeashM(2000)).toBe(5000);
  });
});
