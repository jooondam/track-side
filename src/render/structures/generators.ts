// one geometry generator per structure `kind` in the landmark schema.
//
// Everything is built from schema parameters rather than loaded: there is no downloaded model in
// this project, for the same licensing reason the car is procedural (DESIGN_NOTES section 5).
// Each generator returns a BufferGeometry already positioned in world space, so Landmarks.tsx can
// merge every static structure on a circuit into a single draw call.
//
// Grandstand seating carries a per-tier colour ramp in COLOR_0, which is what makes it read as a
// crowd rather than as a grey wedge, without a texture and without a second draw call.

import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { Structure } from "../../assets";

/** where a structure sits and which way it faces, resolved from the track before generation. */
export interface Placement {
  x: number;
  y: number;
  z: number;
  /** unit tangent in the ground plane: the direction the road runs at this point. */
  tx: number;
  tz: number;
}

function coloured(geometry: THREE.BufferGeometry, r: number, g: number, b: number) {
  const count = geometry.attributes.position.count;
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    colors[3 * i] = r;
    colors[3 * i + 1] = g;
    colors[3 * i + 2] = b;
  }
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  return geometry;
}

/**
 * orient a geometry onto the road's tangent, then move it into place.
 *
 * **The local frame, because getting it backwards is what put a 380 m building across Monza.**
 * After the rotateY below:
 *
 *     local +x  ->  ALONG the road, in the direction of travel
 *     local +z  ->  ACROSS the road, toward the driver's right
 *     local +y  ->  up
 *
 * So anything with a `length_m` puts it on **x**, and anything sitting beside the road offsets
 * on **z**. Note that +z is the *right* normal while `offset_m` is positive to the *left*
 * (offline/landmarks/data.py), which is why the outboard offsets below are negated: Landmarks.tsx
 * has already moved the anchor to `centreline + leftNormal * offset_m`, and these push the body
 * further the same way.
 */
function place(geometry: THREE.BufferGeometry, p: Placement) {
  geometry.rotateY(Math.atan2(-p.tz, p.tx));
  geometry.translate(p.x, p.y, p.z);
  return geometry;
}

function gantry(s: Structure, p: Placement): THREE.BufferGeometry {
  const legRadius = 0.28;
  const parts: THREE.BufferGeometry[] = [];
  for (const side of [-1, 1]) {
    const leg = new THREE.CylinderGeometry(legRadius, legRadius, s.heightM, 8);
    leg.translate(0, s.heightM / 2, (side * s.spanM) / 2);
    parts.push(coloured(leg, 0.30, 0.32, 0.35));
  }
  const beam = new THREE.BoxGeometry(0.5, 0.6, s.spanM);
  beam.translate(0, s.heightM, 0);
  parts.push(coloured(beam, 0.26, 0.28, 0.31));
  return place(mergeGeometries(parts, false)!, p);
}

function bridge(s: Structure, p: Placement): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const deck = new THREE.BoxGeometry(3.2, 0.5, s.spanM);
  deck.translate(0, s.heightM, 0);
  parts.push(coloured(deck, 0.42, 0.42, 0.44));
  for (const side of [-1, 1]) {
    const rail = new THREE.BoxGeometry(0.16, 1.1, s.spanM);
    rail.translate(side * 1.5, s.heightM + 0.8, 0);
    parts.push(coloured(rail, 0.34, 0.35, 0.38));
    const pier = new THREE.BoxGeometry(2.0, s.heightM, 1.6);
    pier.translate(0, s.heightM / 2, (side * s.spanM) / 2);
    parts.push(coloured(pier, 0.30, 0.31, 0.33));
  }
  return place(mergeGeometries(parts, false)!, p);
}

/**
 * a tiered grandstand rising away from the road.
 *
 * No circuit authors one at the moment (7dfe9cd dropped them), but this carried the same
 * transposed axes as pitBuilding did, so a stand added tomorrow would have been laid across the
 * circuit exactly as Monza's pit building was. Fixed alongside rather than left as a trap.
 */
function grandstand(s: Structure, p: Placement): THREE.BufferGeometry {
  const tiers = 9;
  const depth = 2.0;
  const rise = s.heightM / tiers;
  const parts: THREE.BufferGeometry[] = [];
  const out = -(Math.sign(s.offsetM) || 1);

  for (let i = 0; i < tiers; i++) {
    const step = new THREE.BoxGeometry(s.lengthM, rise, depth);
    step.translate(0, i * rise + rise / 2, out * (i * depth + depth / 2));
    // seating varies tier to tier so a stand reads as crowd speckle rather than a flat block.
    // Kept on a warm neutral: an earlier version scaled the blue channel hardest, which turned
    // every grandstand on the circuit violet.
    const shade = 0.30 + 0.06 * (i % 3);
    parts.push(coloured(step, shade * 1.06, shade, shade * 0.92));
  }
  const roof = new THREE.BoxGeometry(s.lengthM + 2, 0.4, tiers * depth + 2);
  roof.translate(0, s.heightM + 3.4, out * ((tiers * depth) / 2));
  parts.push(coloured(roof, 0.38, 0.39, 0.41));
  for (const end of [-1, 1]) {
    const post = new THREE.BoxGeometry(0.4, s.heightM + 3.4, 0.4);
    post.translate((end * s.lengthM) / 2, (s.heightM + 3.4) / 2, out * (tiers * depth));
    parts.push(coloured(post, 0.34, 0.35, 0.37));
  }
  return place(mergeGeometries(parts, false)!, p);
}

/**
 * the pit building: a long block down one side of the start straight.
 *
 * **Length on x, depth on z.** It used to be the other way round, which meant Monza's 380 m
 * building and Spa's 420 m one were laid *across* their circuits rather than along them: both
 * reached about 4.5 m inside the far road edge, so the racing line ran straight through a wall.
 * It went unseen for two reasons. The structure band only draws below 900 m of camera altitude
 * while the overview sits above it, and at Monza the whole merged batch was being dropped by the
 * missing-uv bug in bankingRemnant, so the building was not drawn there at all.
 */
function pitBuilding(s: Structure, p: Placement): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  // outboard is -z, since offset_m is positive to the left and local +z is the right normal
  const out = -(Math.sign(s.offsetM) || 1);
  const body = new THREE.BoxGeometry(s.lengthM, s.heightM, 14);
  body.translate(0, s.heightM / 2, out * 7);
  parts.push(coloured(body, 0.52, 0.53, 0.55));
  // an overhanging upper deck, which is what makes a pit building read as one
  const deck = new THREE.BoxGeometry(s.lengthM, 0.6, 18);
  deck.translate(0, s.heightM * 0.62, out * 6);
  parts.push(coloured(deck, 0.40, 0.41, 0.44));
  const roof = new THREE.BoxGeometry(s.lengthM, 0.5, 16);
  roof.translate(0, s.heightM, out * 7);
  parts.push(coloured(roof, 0.36, 0.37, 0.39));
  return place(mergeGeometries(parts, false)!, p);
}

/**
 * a surviving stretch of banked oval, from an explicit world polyline.
 *
 * 'world' placement because Monza's old banking does not follow the modern circuit and cannot be
 * positioned by arc length at all. It genuinely *crosses* the Grand Prix track, which is not a
 * data error and is the same crossing the serraglio_bridge structure exists for.
 *
 * **It has to be drawn elevated, and it was not.** The ribbon used to sit at y = 0, so where it
 * crossed the circuit it passed straight through the racing surface, cutting 2.1 m into the road
 * near (61, -680). The structure it represents is carried on an embankment, and `height_m` was
 * already authored for exactly this and simply never read.
 *
 * `height_m` is a height **above the ground**, not an absolute y, which is the second half of the
 * same bug: Monza's road is itself at about 6 m where the banking crosses it, so lifting to an
 * absolute 6 m cleared precisely nothing. The base comes in through `p.y`, which Landmarks.tsx
 * fills from the circuit's own surface. One constant base for the whole ribbon is honest here:
 * Monza's total elevation range is 11.5 m over a 5.8 km lap, so the ground under a 640 m polyline
 * is flat to well within the embankment's own height.
 */
function bankingRemnant(s: Structure, p: Placement | null): THREE.BufferGeometry {
  const points = s.polylineXz;
  if (points.length < 2) return new THREE.BufferGeometry();
  const baseY = (p?.y ?? 0) + s.heightM;

  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const lift = Math.tan((s.bankDeg * Math.PI) / 180) * s.widthM;

  for (let i = 0; i < points.length; i++) {
    const [x, z] = points[i];
    const [px, pz] = points[Math.max(i - 1, 0)];
    const [nx, nz] = points[Math.min(i + 1, points.length - 1)];
    const tx = nx - px;
    const tz = nz - pz;
    const len = Math.max(Math.hypot(tx, tz), 1e-6);
    const ox = -tz / len;
    const oz = tx / len;
    // inner lip on the embankment, outer one rising with the bank angle
    positions.push(x, baseY, z, x + ox * s.widthM, baseY + lift, z + oz * s.widthM);
    // **The UVs are not for texturing.** Nothing samples them: this is the only generator that
    // builds its geometry by hand rather than from a box or a cylinder, and those primitives all
    // carry a uv. mergeGeometries requires an identical attribute set across every input and
    // fails the whole merge otherwise, so omitting it here cost Monza *all* of its structures,
    // silently, with one console warning and an empty circuit.
    const v = i / Math.max(points.length - 1, 1);
    uvs.push(0, v, 1, v);
    if (i < points.length - 1) {
      const a = 2 * i;
      indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return coloured(geometry, 0.46, 0.45, 0.42);
}

/**
 * geometry for one authored structure, or null for a kind with no generator.
 *
 * Returning null is a supported outcome, not a gap: tree_line entries stay in landmarks.json
 * because both circuits really are lined with trees and the schema should record that, but
 * nothing renders them (see the note in Landmarks.tsx). marshal_post, tyre_wall and catch_fence
 * are the same, valid in the schema and deliberately unrendered.
 */
export function buildStructure(s: Structure, p: Placement | null): THREE.BufferGeometry | null {
  // banking is the one kind that positions itself, from its own world polyline. It still takes
  // the placement, but only for the ground height in p.y.
  if (s.kind === "banking_remnant") return bankingRemnant(s, p);
  if (!p) return null;
  switch (s.kind) {
    case "gantry":
      return gantry(s, p);
    case "bridge":
      return bridge(s, p);
    case "grandstand":
      return grandstand(s, p);
    case "pit_building":
      return pitBuilding(s, p);
    default:
      return null;
  }
}
