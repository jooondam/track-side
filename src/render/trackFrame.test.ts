// nothing trackside may stand on the track.
//
// This is the regression test for the bug that motivated ./trackFrame. The outboard normal was
// inverted at three independent call sites, all commented as the left normal when they computed
// the right one, and the result was 463 of ~700 fence posts standing on the racing surface at
// Spa, up to 7.55 m inside the road edge, plus braking cones on the line they were annotating.
//
// A sign error like that is invisible to a type checker, survives review because the code reads
// exactly like the correct version, and is only obvious from a camera angle nobody had tried.
// So it gets asserted against the shipped geometry: every post the renderer would place, checked
// against the road edges it was placed from.

import monzaLandmarks from "../../public/monza/landmarks.json";
import monzaLines from "../../public/monza/track_lines.json";
import spaLandmarks from "../../public/spa/landmarks.json";
import spaLines from "../../public/spa/track_lines.json";
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import type { Structure } from "../assets";
import { buildStructure } from "./structures/generators";
import { leftNormal, outboard, sampleBoundary, sampleCenterline, type Side } from "./trackFrame";

interface StructureJson {
  id: string;
  kind: string;
  placement: string;
  s_m?: number;
  offset_m?: number;
  span_m?: number;
  height_m?: number;
  length_m?: number;
  bank_deg?: number;
  width_m?: number;
  polyline_xz?: number[][];
}

type LinesJson = {
  lines: {
    boundary_left_yup: number[][];
    boundary_right_yup: number[][];
    centerline_yup: number[][];
    centerline_s_m: number[];
  };
};

function toTrackLines(raw: LinesJson) {
  const flat = (rows: number[][]) => Float32Array.from(rows.flat());
  return {
    boundaryLeft: flat(raw.lines.boundary_left_yup),
    boundaryRight: flat(raw.lines.boundary_right_yup),
    centerline: flat(raw.lines.centerline_yup),
    centerlineSM: Float64Array.from(raw.lines.centerline_s_m),
    nPoints: raw.lines.centerline_yup.length,
  };
}

const CIRCUITS = [
  {
    id: "spa",
    lines: toTrackLines(spaLines as LinesJson),
    structures: spaLandmarks.structures as StructureJson[],
  },
  {
    id: "monza",
    lines: toTrackLines(monzaLines as LinesJson),
    structures: monzaLandmarks.structures as StructureJson[],
  },
];

/** index of the centreline point at an arc length; mirrors viewpoints.ts. */
function indexAtCenterlineS(lines: ReturnType<typeof toTrackLines>, s: number): number {
  const n = lines.nPoints;
  const loop = lines.centerlineSM[n - 1];
  let i = Math.min(Math.max(Math.round((s / loop) * (n - 1)), 0), n - 1);
  while (i > 0 && lines.centerlineSM[i] > s) i--;
  while (i < n - 2 && lines.centerlineSM[i + 1] < s) i++;
  return i;
}

/** the shipped JSON row as the Structure the renderer sees; absent fields default to zero. */
function toStructure(raw: StructureJson): Structure {
  return {
    id: raw.id,
    kind: raw.kind,
    placement: raw.placement,
    sM: raw.s_m,
    offsetM: raw.offset_m ?? 0,
    spanM: raw.span_m ?? 0,
    heightM: raw.height_m ?? 0,
    lengthM: raw.length_m ?? 0,
    bankDeg: raw.bank_deg ?? 0,
    widthM: raw.width_m ?? 0,
    polylineXz: (raw.polyline_xz ?? []) as [number, number][],
  } as Structure;
}

/** nearest centreline index to a world point, over the whole lap. */
function nearestIndex(lines: ReturnType<typeof toTrackLines>, x: number, z: number): number {
  let best = Infinity;
  let bestI = 0;
  for (let i = 0; i < lines.nPoints; i++) {
    const d =
      (lines.centerline[3 * i] - x) ** 2 + (lines.centerline[3 * i + 2] - z) ** 2;
    if (d < best) {
      best = d;
      bestI = i;
    }
  }
  return bestI;
}

/**
 * the first point of the racing surface a structure occupies, or null if it keeps clear.
 *
 * Walks the road at 5 m intervals across its full width and asks, for each sample, whether any
 * triangle of the structure covers it in plan and sits lower than `clearanceM` above it. A gantry
 * beam covers plenty of road and passes, because it does so at 7.5 m; a slab at road height does
 * not.
 */
function firstRoadHit(
  lines: ReturnType<typeof toTrackLines>,
  geometry: THREE.BufferGeometry,
  clearanceM: number,
): { s: number; height: number } | null {
  const pos = geometry.attributes.position as THREE.BufferAttribute;
  const index = geometry.index;
  const triCount = index ? index.count / 3 : pos.count / 3;
  const vi = (t: number, k: number) => (index ? index.getX(3 * t + k) : 3 * t + k);

  const step = Math.max(1, Math.round(5 / (lines.centerlineSM[1] - lines.centerlineSM[0])));
  for (let i = 0; i < lines.nPoints; i += step) {
    const roadY = lines.centerline[3 * i + 1];
    // across the full width, edge to edge, so a structure clipping one side is not missed
    for (let f = 0; f <= 1; f += 0.25) {
      const px = lines.boundaryLeft[3 * i] + f * (lines.boundaryRight[3 * i] - lines.boundaryLeft[3 * i]);
      const pz =
        lines.boundaryLeft[3 * i + 2] +
        f * (lines.boundaryRight[3 * i + 2] - lines.boundaryLeft[3 * i + 2]);

      for (let t = 0; t < triCount; t++) {
        const a = vi(t, 0);
        const b = vi(t, 1);
        const c = vi(t, 2);
        const ax = pos.getX(a);
        const az = pos.getZ(a);
        const bx = pos.getX(b);
        const bz = pos.getZ(b);
        const cx = pos.getX(c);
        const cz = pos.getZ(c);

        // barycentric coverage in the ground plane
        const d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
        if (Math.abs(d) < 1e-9) continue;
        const w0 = ((bz - cz) * (px - cx) + (cx - bx) * (pz - cz)) / d;
        const w1 = ((cz - az) * (px - cx) + (ax - cx) * (pz - cz)) / d;
        const w2 = 1 - w0 - w1;
        if (w0 < 0 || w1 < 0 || w2 < 0) continue;

        const y = w0 * pos.getY(a) + w1 * pos.getY(b) + w2 * pos.getY(c);
        if (y - roadY < clearanceM) return { s: lines.centerlineSM[i], height: y - roadY };
      }
    }
  }
  return null;
}

/** half the road width at a centreline index. */
function halfWidthAt(lines: ReturnType<typeof toTrackLines>, i: number): number {
  return (
    Math.hypot(
      lines.boundaryLeft[3 * i] - lines.boundaryRight[3 * i],
      lines.boundaryLeft[3 * i + 2] - lines.boundaryRight[3 * i + 2],
    ) / 2
  );
}

/**
 * how far inside the road edge a world point lies. Negative is clear of the track, which is what
 * every trackside object has to be. Searches a window around the expected index rather than the
 * whole lap so a hairpin's far side cannot be mistaken for the near one.
 */
function intrusionM(
  lines: ReturnType<typeof toTrackLines>,
  x: number,
  z: number,
  nearIndex: number,
): number {
  let best = Infinity;
  let bestI = nearIndex;
  const n = lines.nPoints;
  for (let k = nearIndex - 80; k <= nearIndex + 80; k++) {
    const i = ((k % n) + n) % n;
    const d = Math.hypot(lines.centerline[3 * i] - x, lines.centerline[3 * i + 2] - z);
    if (d < best) {
      best = d;
      bestI = i;
    }
  }
  return halfWidthAt(lines, bestI) - best;
}

describe("leftNormal", () => {
  it("is the left of the heading in the glTF y-up frame", () => {
    // left = up x forward. Heading +x gives (0,1,0) x (1,0,0) = (0,0,-1), so left is -z.
    const [ax, az] = leftNormal(1, 0);
    expect(ax).toBeCloseTo(0, 12);
    expect(az).toBeCloseTo(-1, 12);
    // heading +z gives (0,1,0) x (0,0,1) = (1,0,0), so left is +x
    const [bx, bz] = leftNormal(0, 1);
    expect(bx).toBeCloseTo(1, 12);
    expect(bz).toBeCloseTo(0, 12);
  });

  it("is a unit vector regardless of input length", () => {
    const [x, z] = leftNormal(300, -400);
    expect(Math.hypot(x, z)).toBeCloseTo(1, 12);
  });

  it("is perpendicular to the heading, and to the left rather than the right", () => {
    const dx = 0.6;
    const dz = 0.8;
    const [lx, lz] = leftNormal(dx, dz);
    expect(lx * dx + lz * dz).toBeCloseTo(0, 12);
    // cross product (forward x left) about +y is negative for a left turn in this frame; the
    // point of the assertion is that flipping the sign would break it
    expect(dx * lz - dz * lx).toBeCloseTo(-1, 12);
  });
});

describe.each(CIRCUITS)("$id", ({ lines, structures }) => {
  const loop = lines.centerlineSM[lines.nPoints - 1];

  it("puts the boundary sample on the correct edge", () => {
    for (let s = 0; s < loop; s += 137) {
      const left = sampleBoundary(lines, s, "left");
      const right = sampleBoundary(lines, s, "right");
      // the two edges must be a road apart, not the same point
      expect(Math.hypot(left.x - right.x, left.z - right.z)).toBeGreaterThan(5);
    }
  });

  it("stands every fence post clear of the racing surface", () => {
    // mirrors Landmarks.tsx's fence walk exactly: 20 m pitch, 9 m outboard, both sides
    let worst = -Infinity;
    let onTrack = 0;
    let total = 0;
    for (const side of ["left", "right"] as Side[]) {
      for (let s = 0; s < loop; s += 20) {
        const frame = sampleBoundary(lines, s, side);
        const [px, pz] = outboard(frame, side, 9);
        const near = Math.min(Math.round((s / loop) * (lines.nPoints - 1)), lines.nPoints - 1);
        const intrusion = intrusionM(lines, px, pz, near);
        worst = Math.max(worst, intrusion);
        total++;
        if (intrusion > 0) onTrack++;
      }
    }
    expect(onTrack, `${onTrack}/${total} posts on the track, worst ${worst.toFixed(2)} m`).toBe(0);
    // clear by a real margin, not by a centimetre: 9 m outboard of an edge should leave several
    // metres of daylight even where the road is at its widest
    expect(worst).toBeLessThan(-2);
  });

  it("stands every board and sign clear of the racing surface", () => {
    let onTrack = 0;
    let total = 0;
    for (const side of ["left", "right"] as Side[]) {
      for (let s = 0; s < loop; s += 23) {
        const frame = sampleBoundary(lines, s, side);
        const [px, pz] = outboard(frame, side, 4); // BOARD_OUTBOARD_M
        const near = Math.min(Math.round((s / loop) * (lines.nPoints - 1)), lines.nPoints - 1);
        total++;
        if (intrusionM(lines, px, pz, near) > 0) onTrack++;
      }
    }
    expect(onTrack, `${onTrack}/${total} boards on the track`).toBe(0);
  });

  it("straddles the road with every gantry and bridge", () => {
    // structures are placed from the centreline at their authored offset, and their legs sit at
    // +/- spanM/2 either side. Sampling the racing line instead put the near leg of three of
    // Spa's four span structures on the racing surface, worst 6.9 m inside the edge.
    for (const s of structures) {
      if (s.kind !== "gantry" && s.kind !== "bridge") continue;
      // the schema omits zero-valued fields, so a missing offset is an offset of zero
      const sM = s.s_m ?? 0;
      const offsetM = s.offset_m ?? 0;
      const spanM = s.span_m ?? 0;
      const base = sampleCenterline(lines, sM);
      const [lx, lz] = leftNormal(base.tx, base.tz);
      const near = indexAtCenterlineS(lines, sM);
      for (const legSide of [-1, 1]) {
        // legs straddle perpendicular to the road, about the structure's own centre
        const cx = base.x + lx * offsetM;
        const cz = base.z + lz * offsetM;
        const px = cx + lx * legSide * (spanM / 2);
        const pz = cz + lz * legSide * (spanM / 2);
        const intrusion = intrusionM(lines, px, pz, near);
        expect(intrusion, `${s.id} leg is ${intrusion.toFixed(2)} m inside the road`).toBeLessThan(
          0,
        );
      }
    }
  });

  it("keeps every structure out of the road volume", () => {
    // The real invariant, and the one the plan-only checks above miss: a gantry and a bridge are
    // *supposed* to be over the road, so "clear in plan" is too strong, while "anywhere at all"
    // is too weak. What must hold is that nothing occupies the space a car drives through.
    //
    // This is the check that would have caught all three structure bugs at once: the pit
    // building laid across the circuit (4.5 m inside the far edge at road height), Monza's
    // banking passing through the racing surface at y = 0, and any future generator that gets
    // the local frame backwards the same way.
    const CLEARANCE_M = 3.5; // a GT3 is ~1.2 m tall; gantry beams sit at 7.5 m
    for (const raw of structures) {
      const s = toStructure(raw);
      // mirrors Landmarks.tsx: track structures anchor on the centreline at their offset, world
      // structures take only a ground height from the circuit
      const placement =
        raw.placement === "track" && raw.s_m !== undefined
          ? (() => {
              const base = sampleCenterline(lines, raw.s_m);
              const [lx, lz] = leftNormal(base.tx, base.tz);
              return { ...base, x: base.x + lx * s.offsetM, z: base.z + lz * s.offsetM };
            })()
          : s.polylineXz.length > 0
            ? (() => {
                const pts = s.polylineXz;
                const cx = pts.reduce((a, [x]) => a + x / pts.length, 0);
                const cz = pts.reduce((a, [, z]) => a + z / pts.length, 0);
                const i = nearestIndex(lines, cx, cz);
                return { x: 0, y: lines.centerline[3 * i + 1], z: 0, tx: 1, tz: 0 };
              })()
            : null;
      const geometry = buildStructure(s, placement);
      if (!geometry) continue;

      // **Test road points against structure triangles, not the other way round.** The first
      // version of this walked the structures' vertices and found nothing, because a box has
      // vertices only at its corners: a 380 m slab laid across the circuit passes through the
      // road hundreds of metres from any vertex of its own. Sampling the road instead means the
      // thing being protected is what gets checked, and it is cheaper too.
      const hit = firstRoadHit(lines, geometry, CLEARANCE_M);
      expect(
        hit && `${raw.id} (${raw.kind}) blocks the road at s = ${hit.s.toFixed(0)} m, ` +
          `${hit.height.toFixed(1)} m above the surface`,
      ).toBeNull();
    }
  });

  it("would catch the inverted sign it was written for", () => {
    // the old behaviour: outboard computed with the right normal instead of the left
    let onTrack = 0;
    for (let s = 0; s < loop; s += 20) {
      const frame = sampleBoundary(lines, s, "left");
      const [lx, lz] = leftNormal(frame.tx, frame.tz);
      const px = frame.x - lx * 9; // note the minus: this is the bug
      const pz = frame.z - lz * 9;
      const near = Math.min(Math.round((s / loop) * (lines.nPoints - 1)), lines.nPoints - 1);
      if (intrusionM(lines, px, pz, near) > 0) onTrack++;
    }
    // a guard on the guard: if this ever reaches zero the intrusion measure has stopped working
    // and the assertions above are passing for the wrong reason
    expect(onTrack).toBeGreaterThan(50);
  });
});
