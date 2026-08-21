// every structure generator must produce the same attribute set.
//
// This is the guard for a failure mode with no visible cause. Landmarks.tsx merges all of a
// circuit's structures into one geometry for one draw call, and mergeGeometries requires every
// input to carry an identical set of attributes: give it one geometry missing a `uv` and it does
// not skip that geometry, it fails the *entire merge* and returns null. The circuit then renders
// with no gantries, no bridges and no pit building at all, and says so only through a single
// console warning nobody is watching for.
//
// That is exactly what happened. bankingRemnant is the one generator that assembles its geometry
// by hand instead of from a BoxGeometry or a CylinderGeometry, so it was the one without a uv,
// so Monza shipped with every structure missing while Spa (which has no banking remnant) looked
// fine. The asymmetry is what made it survive.

import { describe, expect, it } from "vitest";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { Structure } from "../../assets";
import { buildStructure, type Placement } from "./generators";

const PLACEMENT: Placement = { x: 10, y: 2, z: -30, tx: 1, tz: 0 };

function structure(over: Partial<Structure>): Structure {
  return {
    id: "test",
    kind: "gantry",
    placement: "track",
    sM: 100,
    offsetM: 0,
    spanM: 18,
    heightM: 7.5,
    lengthM: 30,
    bankDeg: 0,
    widthM: 10,
    polylineXz: [],
    ...over,
  } as Structure;
}

/** every kind that has a generator, with parameters that make it produce real geometry. */
const RENDERED: { kind: string; over: Partial<Structure> }[] = [
  { kind: "gantry", over: { kind: "gantry" } },
  { kind: "bridge", over: { kind: "bridge" } },
  { kind: "grandstand", over: { kind: "grandstand" } },
  { kind: "pit_building", over: { kind: "pit_building", offsetM: 22 } },
  {
    kind: "banking_remnant",
    over: {
      kind: "banking_remnant",
      placement: "world",
      bankDeg: 38,
      polylineXz: [
        [0, 0],
        [50, 10],
        [100, 40],
        [130, 90],
      ],
    },
  },
];

describe("structure generators", () => {
  it.each(RENDERED)("$kind produces geometry", ({ over }) => {
    const g = buildStructure(structure(over), PLACEMENT);
    expect(g).not.toBeNull();
    expect(g!.attributes.position.count).toBeGreaterThan(0);
  });

  it.each(RENDERED)("$kind carries position, normal, uv and color", ({ over }) => {
    const g = buildStructure(structure(over), PLACEMENT)!;
    // the exact set the merge requires. Sorted so the assertion message names what is missing.
    expect(Object.keys(g.attributes).sort()).toEqual(["color", "normal", "position", "uv"]);
  });

  it("merges every kind together, which is what the renderer actually does", () => {
    const parts = RENDERED.map(({ over }) => buildStructure(structure(over), PLACEMENT)!);
    const merged = mergeGeometries(parts, false);
    // null is the failure signal: mergeGeometries warns and returns null rather than throwing,
    // which is precisely why this needs asserting instead of being noticed
    expect(merged).not.toBeNull();
    expect(merged!.attributes.position.count).toBe(
      parts.reduce((n, p) => n + p.attributes.position.count, 0),
    );
  });

  it("returns null for kinds that are deliberately not rendered", () => {
    for (const kind of ["tree_line", "marshal_post", "tyre_wall", "catch_fence"]) {
      expect(buildStructure(structure({ kind } as Partial<Structure>), PLACEMENT)).toBeNull();
    }
  });
});
