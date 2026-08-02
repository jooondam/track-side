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

/** orient a geometry built along +x onto the road's tangent, then move it into place. */
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

function grandstand(s: Structure, p: Placement): THREE.BufferGeometry {
  const tiers = 9;
  const depth = 2.0;
  const rise = s.heightM / tiers;
  const parts: THREE.BufferGeometry[] = [];
  const facing = Math.sign(s.offsetM) || 1;

  for (let i = 0; i < tiers; i++) {
    const step = new THREE.BoxGeometry(depth, rise, s.lengthM);
    step.translate(facing * (i * depth + depth / 2), i * rise + rise / 2, 0);
    // seating varies tier to tier so a stand reads as crowd speckle rather than a flat block.
    // Kept on a warm neutral: an earlier version scaled the blue channel hardest, which turned
    // every grandstand on the circuit violet.
    const shade = 0.30 + 0.06 * (i % 3);
    parts.push(coloured(step, shade * 1.06, shade, shade * 0.92));
  }
  const roof = new THREE.BoxGeometry(tiers * depth + 2, 0.4, s.lengthM + 2);
  roof.translate(facing * ((tiers * depth) / 2), s.heightM + 3.4, 0);
  parts.push(coloured(roof, 0.38, 0.39, 0.41));
  for (const end of [-1, 1]) {
    const post = new THREE.BoxGeometry(0.4, s.heightM + 3.4, 0.4);
    post.translate(facing * (tiers * depth), (s.heightM + 3.4) / 2, (end * s.lengthM) / 2);
    parts.push(coloured(post, 0.34, 0.35, 0.37));
  }
  return place(mergeGeometries(parts, false)!, p);
}

function pitBuilding(s: Structure, p: Placement): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const facing = Math.sign(s.offsetM) || 1;
  const body = new THREE.BoxGeometry(14, s.heightM, s.lengthM);
  body.translate(facing * 7, s.heightM / 2, 0);
  parts.push(coloured(body, 0.52, 0.53, 0.55));
  // an overhanging upper deck, which is what makes a pit building read as one
  const deck = new THREE.BoxGeometry(18, 0.6, s.lengthM);
  deck.translate(facing * 6, s.heightM * 0.62, 0);
  parts.push(coloured(deck, 0.40, 0.41, 0.44));
  const roof = new THREE.BoxGeometry(16, 0.5, s.lengthM);
  roof.translate(facing * 7, s.heightM, 0);
  parts.push(coloured(roof, 0.36, 0.37, 0.39));
  return place(mergeGeometries(parts, false)!, p);
}

function bankingRemnant(s: Structure): THREE.BufferGeometry {
  // 'world' placement: an explicit polyline, because Monza's old banking does not follow the
  // modern circuit and cannot be positioned by arc length at all
  const points = s.polylineXz;
  if (points.length < 2) return new THREE.BufferGeometry();

  const positions: number[] = [];
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
    positions.push(x, 0, z, x + ox * s.widthM, lift, z + oz * s.widthM);
    if (i < points.length - 1) {
      const a = 2 * i;
      indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
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
  if (s.kind === "banking_remnant") return bankingRemnant(s);
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
