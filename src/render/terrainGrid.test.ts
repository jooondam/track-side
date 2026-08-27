import { describe, expect, it } from "vitest";
import { cameraLeashM } from "./cameraLeash";
import {
  FIELD_SPACING_M,
  SKIRT_REACH_M,
  SKIRT_RINGS,
  SCATTER_GROWTH,
  buildFieldLayout,
  buildGridAxis,
  fieldRadii,
  plateHeightAt,
  plateVertexHeight,
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
  }

  it("solves a ratio inside the bisection bracket for both circuits", () => {
    for (const d0 of [10.7146, 10.8484, 17.428, 18.5444]) {
      const ratio = solveSkirtRatio(d0);
      expect(ratio).toBeGreaterThan(1.0);
      expect(ratio).toBeLessThan(1.6);
      expect(skirtReach(ratio, d0)).toBeCloseTo(SKIRT_REACH_M, 0);
    }
  });

  it("keeps the plate's vertex count under the Uint16 index limit", () => {
    // crossing 65,536 silently promotes the plate's index to Uint32
    const n = 200 + 2 * SKIRT_RINGS;
    expect(n * n).toBeLessThan(65536);
  });
});

describe("fieldRadii", () => {
  for (const c of CIRCUITS) {
    const r = fieldRadii(c, LINE_EXTENT_M[c.id]);

    it(`${c.id}: the field stops inside the occluder plate`, () => {
      // **The boundary guarantee, as an assertion.** A dot past the plate's edge is a dot with no
      // ground under it, hanging over the sky. The binding number is the plate's *inscribed*
      // radius, not its diagonal: the short axis is where the rectangle runs out first, which is
      // exactly the axis the old rectangular field got wrong.
      const halfX = ((c.nCells - 1) * c.dx) / 2;
      const halfZ = ((c.nCells - 1) * c.dz) / 2;
      expect(r.outerRadius).toBeLessThan(Math.min(halfX, halfZ) + SKIRT_REACH_M);
      expect(r.fadeEnd).toBeLessThanOrEqual(r.outerRadius);
    });

    it(`${c.id}: the camera cannot outrun the field`, () => {
      // Coupled across files: CameraRig leashes the camera to cameraLeashM(extent) from the
      // terrain anchor while the fade is anchored to that same point, so a camera further out
      // than fadeEnd sits in a hole with no field under it. Raising the leash in cameraLeash.ts,
      // a file that mentions no terrain, is what this guards.
      //
      // This used to read maxDistance, and that was the wrong number to guard: maxDistance caps
      // camera-to-target, and every way of moving here except zooming translates the pair
      // together, so the camera could walk past the fade with the cap never tripping.
      expect(r.fadeEnd).toBeGreaterThan(cameraLeashM(LINE_EXTENT_M[c.id]) + 250);
    });

    it(`${c.id}: the anchor is the centre of the heightfield`, () => {
      // TerrainMesh measures the fade from here and CameraRig measures the leash from here; the
      // two radii only compose because it is the same point.
      const { x, z } = terrainAnchorXz(c);
      expect(x).toBeCloseTo(c.x0 + ((c.nCells - 1) * c.dx) / 2, 9);
      expect(z).toBeCloseTo(c.z0 + ((c.nCells - 1) * c.dz) / 2, 9);
    });

    it(`${c.id}: the lattice covers the circuit`, () => {
      // the lattice is the part that reads as surveyed ground, so it has to reach around the
      // whole circuit rather than a disc in the middle of it
      expect(r.latticeRadius * 2).toBeGreaterThan(LINE_EXTENT_M[c.id]);
    });

    it(`${c.id}: the wire is gone before its own boundary`, () => {
      // the wire covers a disc, and a disc has an edge. It is only invisible because the fade
      // reaches zero at or inside the radius the geometry stops at.
      const layout = buildFieldLayout({
        centerX: 0,
        centerZ: 0,
        latticeRadiusM: r.latticeRadius,
        wireRadiusM: r.wireRadius,
        outerRadiusM: r.outerRadius,
      });
      expect(r.wireFadeEnd).toBeLessThanOrEqual(layout.wireRadiusM + 1e-9);
    });
  }
});

describe("buildFieldLayout", () => {
  for (const c of CIRCUITS) {
    const r = fieldRadii(c, LINE_EXTENT_M[c.id]);
    const layout = buildFieldLayout({
      centerX: 0,
      centerZ: 0,
      latticeRadiusM: r.latticeRadius,
      wireRadiusM: r.wireRadius,
      outerRadiusM: r.outerRadius,
    });
    const radiusOf = (i: number) => Math.hypot(layout.xz[2 * i], layout.xz[2 * i + 1]);

    it(`${c.id}: keeps the lattice under the Uint16 index limit`, () => {
      // only the *lattice* matters here: the wire index references lattice points alone, and the
      // dots are drawn unindexed, so the scatter can push the total past 65,536 harmlessly.
      expect(layout.latticeCount).toBeLessThan(65536);
    });

    it(`${c.id}: puts no point outside the outer radius`, () => {
      for (let i = 0; i < layout.count; i++) {
        expect(radiusOf(i)).toBeLessThanOrEqual(r.outerRadius);
      }
    });

    it(`${c.id}: is isotropic, which is the whole point`, () => {
      // **This is the "not a rectangle" assertion.** Bin the field by bearing and compare how far
      // it reaches in each direction. A rectangle reaches sqrt(2) further into its corners than
      // across its faces, which is a 41% spread; a circular field is flat to within the jitter.
      const SECTORS = 36;
      const reach = new Float64Array(SECTORS);
      for (let i = 0; i < layout.count; i++) {
        const a = Math.atan2(layout.xz[2 * i + 1], layout.xz[2 * i]);
        const s = Math.min(SECTORS - 1, Math.floor(((a + Math.PI) / (2 * Math.PI)) * SECTORS));
        reach[s] = Math.max(reach[s], radiusOf(i));
      }
      const lo = Math.min(...reach);
      const hi = Math.max(...reach);
      expect(hi / lo, `reach varies ${(hi / lo).toFixed(3)}x between bearings`).toBeLessThan(1.03);
    });

    it(`${c.id}: thins outward with no step anywhere, including the seam`, () => {
      // **Asserted on the spacing sequence, not on binned counts.** Binning is a noisy estimator
      // here: the outer annuli hold only a handful of rings, so ring quantisation alone swings
      // adjacent bins by 50% and any threshold loose enough to pass would be too loose to catch a
      // real step. The spacing sequence is the thing that actually has to be smooth, and it can
      // be checked exactly.
      const steps = [...new Set(Array.from(layout.spread))].sort((a, b) => a - b);

      // the lattice is flat, and the first scatter ring is still at the lattice's own spacing:
      // growth is applied *after* a ring is placed. Growing first made the very first ring 3%
      // sparser than the lattice it joins, which is where a step would begin.
      expect(steps[0]).toBe(1);

      for (let i = 1; i < steps.length; i++) {
        expect(
          steps[i] / steps[i - 1],
          `spacing jumped ${(steps[i] / steps[i - 1]).toFixed(3)}x between rings`,
        ).toBeLessThanOrEqual(SCATTER_GROWTH + 1e-6);
      }

      // **The seam's slope, not just its value.** Density continuity alone left brightness flat
      // across the lattice and falling immediately outside it, and that kink drew the lattice's
      // own circumference as a bright disc at Monza: a circle in place of the rectangle. The
      // ramp is what removes it, so the first rings have to grow far slower than the full ratio.
      const firstGrowth = steps[1] / steps[0];
      expect(
        firstGrowth,
        `first scatter ring grows ${((firstGrowth - 1) * 100).toFixed(2)}%, which is not a ramp`,
      ).toBeLessThan(1 + (SCATTER_GROWTH - 1) * 0.2);
      // and it does reach the full ratio eventually, or the scatter never thins
      expect(steps[steps.length - 1] / steps[steps.length - 2]).toBeGreaterThan(
        1 + (SCATTER_GROWTH - 1) * 0.9,
      );

      // and it does recede: perceived brightness scales as 1/spread, so this is how much dimmer
      // the outermost field is than the lattice. Enough to read as distance, not so much that
      // the horizon is empty.
      const falloff = steps[steps.length - 1];
      expect(falloff, `outermost ring is ${falloff.toFixed(1)}x the lattice spacing`).toBeGreaterThan(3);
      expect(falloff).toBeLessThan(20);
    });

    it(`${c.id}: matches lattice density at the seam`, () => {
      // the two zones join without a crossfade, which only works because the last lattice cell
      // and the first scatter ring are the same size
      const band = layout.spacingM * 3;
      const inner = { n: 0, area: 0 };
      const outer = { n: 0, area: 0 };
      for (let i = 0; i < layout.count; i++) {
        const rad = radiusOf(i);
        if (rad > r.latticeRadius - band && rad <= r.latticeRadius) inner.n++;
        if (rad > r.latticeRadius && rad <= r.latticeRadius + band) outer.n++;
      }
      inner.area = Math.PI * (r.latticeRadius ** 2 - (r.latticeRadius - band) ** 2);
      outer.area = Math.PI * ((r.latticeRadius + band) ** 2 - r.latticeRadius ** 2);
      const ratio = outer.n / outer.area / (inner.n / inner.area);
      expect(
        ratio,
        `scatter is ${ratio.toFixed(2)}x the lattice density at the seam`,
      ).toBeGreaterThan(0.8);
      expect(ratio).toBeLessThan(1.25);
    });

    it(`${c.id}: is deterministic`, () => {
      // two loads, two screenshots, one field: the harness compares frames, so a randomised
      // layout would make every capture differ for the wrong reason
      const again = buildFieldLayout({
        centerX: 0,
        centerZ: 0,
        latticeRadiusM: r.latticeRadius,
        wireRadiusM: r.wireRadius,
        outerRadiusM: r.outerRadius,
      });
      expect(again.count).toBe(layout.count);
      expect(Array.from(again.xz.slice(0, 200))).toEqual(Array.from(layout.xz.slice(0, 200)));
    });

    it(`${c.id}: jitters the lattice off the exact grid`, () => {
      // an exact grid beats against the pixel raster into diagonal moire streaks, which is what
      // the old field showed. If the jitter is ever dropped this catches it.
      let onGrid = 0;
      for (let i = 0; i < layout.latticeCount; i++) {
        const rx = Math.abs(layout.xz[2 * i] % layout.spacingM);
        if (rx < 1e-6 || Math.abs(rx - layout.spacingM) < 1e-6) onGrid++;
      }
      expect(onGrid / layout.latticeCount).toBeLessThan(0.01);
    });
  }

  it("uses a spacing coarser than the heightfield: this is context, not data", () => {
    expect(FIELD_SPACING_M).toBeGreaterThan(10.8484);
  });
});

describe("plateHeightAt", () => {
  // a tiny synthetic heightfield: a ramp, so interpolation errors show up as height errors
  const hf = {
    nCells: 4,
    x0: 0,
    z0: 0,
    dx: 10,
    dz: 10,
    heights: Float64Array.from({ length: 16 }, (_, i) => (i % 4) * 3 + Math.floor(i / 4) * 7),
  };
  const hMean = 15;
  const xs = buildGridAxis(hf.x0, hf.nCells, hf.dx);
  const zs = buildGridAxis(hf.z0, hf.nCells, hf.dz);

  it("reproduces the plate's own vertices exactly", () => {
    // the dots are sampled from this and the plate is built from plateVertexHeight, so any
    // disagreement puts the field above or below the surface that occludes it
    for (const [ix, iz] of [
      [SKIRT_RINGS, SKIRT_RINGS],
      [SKIRT_RINGS + 2, SKIRT_RINGS + 1],
      [SKIRT_RINGS - 5, SKIRT_RINGS + 2],
      [2, 40],
    ] as const) {
      const want = plateVertexHeight(hf, hMean, ix, iz).h;
      const got = plateHeightAt(hf, xs, zs, hMean, xs[ix], zs[iz]).h;
      expect(got).toBeCloseTo(want, 9);
    }
  });

  it("relaxes toward the mean out in the skirt", () => {
    const middle = plateVertexHeight(hf, hMean, SKIRT_RINGS + 1, SKIRT_RINGS + 1).h;
    const edge = plateVertexHeight(hf, hMean, 0, 0).h;
    expect(Math.abs(edge - hMean)).toBeLessThan(Math.abs(middle - hMean) + 1e-9);
  });

  it("keeps the raw sample for the colour ramp, unrelaxed", () => {
    // tinting by the relaxed height would wash the whole far field to one mid-ramp colour
    const outer = plateVertexHeight(hf, hMean, 0, 0);
    expect(outer.sampled).toBe(hf.heights[0]);
    expect(outer.h).not.toBeCloseTo(outer.sampled, 6);
  });
});
