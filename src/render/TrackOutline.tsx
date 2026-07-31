// the accurate road outline: white edge lines along both real boundary polylines (TUMFTM
// widths, the same geometry the ribbon mesh uses), a faint dashed centerline, and a
// checkered start/finish strip: what makes the ribbon read as a road and the car's lateral
// position on it legible.

import { Line } from "@react-three/drei";
import { useMemo } from "react";
import * as THREE from "three";
import type { TrackLines } from "../assets";

const EDGE_LIFT = 0.15; // just above the ribbon, below the racing line's 0.4

function toPoints(flat: Float32Array, lift: number): [number, number, number][] {
  const pts: [number, number, number][] = [];
  for (let i = 0; i < flat.length / 3; i++) {
    pts.push([flat[3 * i], flat[3 * i + 1] + lift, flat[3 * i + 2]]);
  }
  return pts;
}

function StartFinishStrip({ trackLines }: { trackLines: TrackLines }) {
  // checkered strip spanning the road width at s=0, built from the first boundary
  // cross-section; two rows of alternating quads
  const mesh = useMemo(() => {
    const left = new THREE.Vector3(
      trackLines.boundaryLeft[0],
      trackLines.boundaryLeft[1],
      trackLines.boundaryLeft[2],
    );
    const right = new THREE.Vector3(
      trackLines.boundaryRight[0],
      trackLines.boundaryRight[1],
      trackLines.boundaryRight[2],
    );
    const across = right.clone().sub(left);
    // direction of travel from the centerline's first segment
    const ahead = new THREE.Vector3(
      trackLines.centerline[3] - trackLines.centerline[0],
      trackLines.centerline[4] - trackLines.centerline[1],
      trackLines.centerline[5] - trackLines.centerline[2],
    )
      .normalize()
      .multiplyScalar(1.1);

    const nCheck = 8;
    const white = new THREE.BufferGeometry();
    const black = new THREE.BufferGeometry();
    const whiteVerts: number[] = [];
    const blackVerts: number[] = [];
    for (let row = 0; row < 2; row++) {
      for (let i = 0; i < nCheck; i++) {
        const a = left
          .clone()
          .addScaledVector(across, i / nCheck)
          .addScaledVector(ahead, row);
        const b = left
          .clone()
          .addScaledVector(across, (i + 1) / nCheck)
          .addScaledVector(ahead, row);
        const c = b.clone().add(ahead);
        const d = a.clone().add(ahead);
        const target = (i + row) % 2 === 0 ? whiteVerts : blackVerts;
        for (const v of [a, b, c, a, c, d]) target.push(v.x, v.y + EDGE_LIFT, v.z);
      }
    }
    white.setAttribute("position", new THREE.Float32BufferAttribute(whiteVerts, 3));
    black.setAttribute("position", new THREE.Float32BufferAttribute(blackVerts, 3));
    return { white, black };
  }, [trackLines]);

  return (
    <>
      <mesh geometry={mesh.white}>
        <meshBasicMaterial color="#e8e8ee" side={THREE.DoubleSide} />
      </mesh>
      <mesh geometry={mesh.black}>
        <meshBasicMaterial color="#111116" side={THREE.DoubleSide} />
      </mesh>
    </>
  );
}

export function TrackOutline({ trackLines }: { trackLines: TrackLines }) {
  const left = useMemo(() => toPoints(trackLines.boundaryLeft, EDGE_LIFT), [trackLines]);
  const right = useMemo(() => toPoints(trackLines.boundaryRight, EDGE_LIFT), [trackLines]);
  const center = useMemo(() => toPoints(trackLines.centerline, EDGE_LIFT * 0.7), [trackLines]);

  return (
    <>
      <Line points={left} color="#c8c8d0" lineWidth={1.5} />
      <Line points={right} color="#c8c8d0" lineWidth={1.5} />
      <Line points={center} color="#45454f" lineWidth={1} dashed dashSize={4} gapSize={6} />
      <StartFinishStrip trackLines={trackLines} />
    </>
  );
}
