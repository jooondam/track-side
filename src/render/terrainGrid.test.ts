import { describe, expect, it } from "vitest";
import { cameraLeashM } from "./cameraLeash";
import {
  SKIRT_REACH_M,
  SKIRT_RINGS,
  buildGridAxis,
  fadeRadii,
  skirtReach,
  solveSkirtRatio,
  terrainAnchorXz,
} from "./terrainGrid";

// the two shipped circuits, from public/<id>/terrain.json meta
const CIRCUITS = [
  { id: "spa", nCells: 200, x0: -844.69, z0: -1059.76, dx: 10.8484, dz: 17.428 },
  { id: "monza", nCells: 200, x0: -445.15, z0: -2449.63, dx: 10.7146, dz: 18.5444 },
];

/** Scene.tsx's `extent`: the racing line's widest bounding-box span, measured from line.json. */
const LINE_EXTENT_M: Record<string, number> = { spa: 2049, monza: 2173 };

describe("buildGridAxis", () => {
  for (const c of CIRCUITS) {
    for (const [axis, origin, d0] of [
      ["x", c.x0, c.dx],
      ["z", c.z0, c.dz],
    ] as const) {
      describe(`${c.id} ${axis}`, () => {
        const out = buildGridAxis(origin, c.nCells, d0);

        it("carries the heightfield plus a skirt on each side", () => {
          expect(out.length).toBe(c.nCells + 2 * SKIRT_RINGS);
        });

        it("is strictly increasing", () => {
          for (let i = 1; i < out.length; i++) expect(out[i]).toBeGreaterThan(out[i - 1]);
        });

        it("leaves the heightfield's own samples exactly where they were", () => {
          for (let i = 0; i < c.nCells; i++) {
            expect(out[SKIRT_RINGS + i]).toBeCloseTo(origin + i * d0, 9);
          }
        });

        it("starts the skirt at the heightfield's own cell size", () => {
          // SKIRT_RAMP eases the growth in from 1, so the first skirt cell must be
          // indistinguishable from the last real one. If this drifts, the density step it exists
          // to remove comes back as a visible rectangle on screen.
          const firstSkirt = out[SKIRT_RINGS] - out[SKIRT_RINGS - 1];
          expect(firstSkirt / d0).toBeGreaterThan(1.0);
          expect(firstSkirt / d0).toBeLessThan(1.06);
        });

        it("reaches SKIRT_REACH_M on both sides, within 1%", () => {
          const low = origin - out[0];
          const high = out[out.length - 1] - (origin + (c.nCells - 1) * d0);
          expect(low).toBeGreaterThan(SKIRT_REACH_M * 0.99);
          expect(low).toBeLessThan(SKIRT_REACH_M * 1.01);
          expect(high).toBeCloseTo(low, 6);
        });
      });
    }

    it(`${c.id}: the fade ends inside the geometry, on the tight axis`, () => {
      // **This is the boundary guarantee as an assertion.** The dots have to be gone before the
      // grid runs out, or the hard rectangular edge the skirt exists to hide becomes visible
      // again -- and only on whichever axis is tighter, which is exactly the sort of thing that
      // ships unnoticed.
      const { fadeEnd } = fadeRadii(c);
      const halfX = ((c.nCells - 1) * c.dx) / 2 + SKIRT_REACH_M;
      const halfZ = ((c.nCells - 1) * c.dz) / 2 + SKIRT_REACH_M;
      expect(fadeEnd).toBeLessThan(Math.min(halfX, halfZ));
    });

    it(`${c.id}: the camera cannot outrun the fade`, () => {
      // The other half of the squeeze on fadeEnd, and the half that is coupled across files:
      // CameraRig leashes the camera to cameraLeashM(extent) from the terrain anchor, while the
      // fade is anchored to that same point, so a camera further out than fadeEnd sits in a hole
      // with no field under it. At the original 2.55 Monza's two numbers were equal to the metre.
      // Raising the leash in cameraLeash.ts, a file that mentions no terrain, is what this
      // guards.
      const extent = LINE_EXTENT_M[c.id];
      expect(fadeRadii(c).fadeEnd).toBeGreaterThan(cameraLeashM(extent) + 250);
    });

    it(`${c.id}: the anchor is the centre of the heightfield`, () => {
      // TerrainMesh measures the fade from here and CameraRig measures the leash from here; the
      // two radii only compose because it is the same point.
      const { x, z } = terrainAnchorXz(c);
      expect(x).toBeCloseTo(c.x0 + ((c.nCells - 1) * c.dx) / 2, 9);
      expect(z).toBeCloseTo(c.z0 + ((c.nCells - 1) * c.dz) / 2, 9);
    });
  }

  it("solves a ratio inside the bisection bracket for both circuits", () => {
    for (const d0 of [10.7146, 10.8484, 17.428, 18.5444]) {
      const ratio = solveSkirtRatio(d0);
      expect(ratio).toBeGreaterThan(1.0);
      expect(ratio).toBeLessThan(1.6);
      expect(skirtReach(ratio, d0)).toBeCloseTo(SKIRT_REACH_M, 0);
    }
  });

  it("keeps the vertex count under the Uint16 index limit", () => {
    // crossing 65,536 silently promotes the surface and wire indices to Uint32
    const n = 200 + 2 * SKIRT_RINGS;
    expect(n * n).toBeLessThan(65536);
  });
});
