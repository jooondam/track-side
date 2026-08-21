// the road must float above the landscape, everywhere, on every shipped circuit.
//
// This became a load-bearing guarantee the moment the apron stopped being drawn. Before that,
// 32 m of generated apron per side covered the join and hid any disagreement between the road's
// registered elevation and the terrain grid's interpolation of it. Now the heightfield runs
// straight up to the road edge, and the only thing keeping the ground from poking through the
// racing surface is DROP_BELOW_ROAD.
//
// Failure mode if this regresses: patches of terrain erupting through the track, in a handful of
// places, visible only from a low camera at one circuit. Nobody would find that by looking, which
// is what makes it worth a test. It runs against the real public/<id>/*.json rather than a
// fixture on purpose: the thing being asserted is a property of the shipped assets.

// the shipped assets themselves, imported the way velocity.test.ts imports its fixtures. No
// node:fs: the repo has no @types/node, and going through the bundler keeps the test reading the
// exact bytes the browser will.
import monzaLines from "../../public/monza/track_lines.json";
import monzaTerrain from "../../public/monza/terrain.json";
import spaLines from "../../public/spa/track_lines.json";
import spaTerrain from "../../public/spa/terrain.json";
import { describe, expect, it } from "vitest";
import { DROP_BELOW_ROAD, sampleTriangulated } from "./terrainGrid";

interface Grid {
  nCells: number;
  x0: number;
  z0: number;
  dx: number;
  dz: number;
  heights: Float64Array;
}

type TerrainJson = { meta: { n_cells: number; x0: number; z0: number; dx: number; dz: number }; heights: number[][] };
type LinesJson = {
  lines: { boundary_left_yup: number[][]; boundary_right_yup: number[][]; centerline_yup: number[][] };
};

function toGrid(raw: TerrainJson): Grid {
  return {
    nCells: raw.meta.n_cells,
    x0: raw.meta.x0,
    z0: raw.meta.z0,
    dx: raw.meta.dx,
    dz: raw.meta.dz,
    // row-major [iz][ix], flattened exactly as src/assets.ts does
    heights: Float64Array.from(raw.heights.flat()),
  };
}

/** every point of the road surface we have elevation for: both edges and the centreline. */
function toRoadPoints(raw: LinesJson): number[][] {
  return [
    ...raw.lines.boundary_left_yup,
    ...raw.lines.boundary_right_yup,
    ...raw.lines.centerline_yup,
  ];
}

const CIRCUITS = [
  { id: "spa", terrain: spaTerrain as TerrainJson, lines: spaLines as LinesJson },
  { id: "monza", terrain: monzaTerrain as TerrainJson, lines: monzaLines as LinesJson },
];

describe.each(CIRCUITS)("$id: terrain never pierces the road", ({ terrain, lines }) => {
  const grid = toGrid(terrain);
  const points = toRoadPoints(lines);

  it("samples the whole road inside the heightfield", () => {
    const outside = points.filter(([x, , z]) => sampleTriangulated(grid, x, z) === null);
    // the grid is built from the track's own bounding box, so a road point falling outside it
    // means the grid and the geometry were generated from different runs
    expect(outside.length).toBe(0);
  });

  it("clears the worst rise by at least the drop", () => {
    let worstRise = -Infinity;
    for (const [x, roadY, z] of points) {
      const ground = sampleTriangulated(grid, x, z);
      if (ground === null) continue;
      worstRise = Math.max(worstRise, ground - roadY);
    }
    // positive means the raw grid sits above the road there and the drop is the only thing
    // saving it. Reported on failure so the next person sees the number, not just a boolean.
    expect(worstRise, `worst raw rise above the road: ${worstRise.toFixed(3)} m`).toBeLessThan(
      DROP_BELOW_ROAD,
    );
  });

  it("keeps a working margin rather than only just clearing", () => {
    let worstRise = -Infinity;
    for (const [x, roadY, z] of points) {
      const ground = sampleTriangulated(grid, x, z);
      if (ground !== null) worstRise = Math.max(worstRise, ground - roadY);
    }
    // 25% of the drop. If a regenerated heightfield eats into this the road is still clear, but
    // the constant needs re-deriving rather than being left to fail later on a third circuit.
    expect(DROP_BELOW_ROAD - worstRise).toBeGreaterThan(DROP_BELOW_ROAD * 0.25);
  });
});
