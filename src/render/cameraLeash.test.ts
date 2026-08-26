import { describe, expect, it } from "vitest";
import { CAMERA_LEASH_K, cameraLeashM, leashScale } from "./cameraLeash";
import { fadeRadii, terrainAnchorXz } from "./terrainGrid";

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

describe("the leash against the terrain fade", () => {
  for (const c of CIRCUITS) {
    it(`${c.id}: a camera on the leash still has field under it`, () => {
      // **the guarantee the leash exists for.** The dots reach zero at fadeEnd, measured from
      // the same anchor, so a camera allowed past it stands in a hole with the occluder plate's
      // straight edge on show. This is the assertion that the two radii compose; the matching
      // one in terrainGrid.test.ts guards the other side of fadeEnd, the geometry boundary.
      const { fadeStart, fadeEnd } = fadeRadii(c);
      const leash = cameraLeashM(c.extent);
      expect(leash).toBeLessThan(fadeEnd);
      // and not by a hair: fadeEnd is tuned, and a metre of clearance is a rounding error away
      // from being none
      expect(fadeEnd - leash).toBeGreaterThan(250);
      // the leash is outside fadeStart, so it does not quietly cost the overview its reach
      expect(leash).toBeGreaterThan(fadeStart);
    });

    it(`${c.id}: the authored viewpoints all sit inside the leash`, () => {
      // buildViewpoints places the two whole-circuit shots off `center`, scaled by `fit`, which
      // is 1.7 on a portrait phone. If a shipped viewpoint were outside the leash, flyTo would
      // clamp it and the framing those numbers were chosen for would silently change.
      const anchor = terrainAnchorXz(c);
      const leash = cameraLeashM(c.extent);
      const fit = 1.7;
      // worst case for each: the leash is horizontal, so only the xz offsets count
      const overview = Math.hypot(0, c.extent * 0.6 * fit);
      const plan = Math.hypot(0, c.extent * 0.02);
      // `center` and the terrain anchor are a couple of metres apart at both circuits, which is
      // the slack these shots are measured with
      const centerOffset = 5;
      expect(overview + centerOffset).toBeLessThan(leash);
      expect(plan + centerOffset).toBeLessThan(leash);
      expect(Number.isFinite(anchor.x) && Number.isFinite(anchor.z)).toBe(true);
    });
  }

  it("keeps the leash constant where the fade was tuned for it", () => {
    // a bare guard on the constant itself: fadeEnd's 2.7 was picked against this 2.5, and the
    // two circuits' clearances (393 m and 320 m) are the whole margin.
    expect(CAMERA_LEASH_K).toBe(2.5);
    expect(cameraLeashM(2000)).toBe(5000);
  });
});
