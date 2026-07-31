// landscape context as a hologram-style dot field: one dot per terrain grid vertex, coloured
// by a natural elevation ramp (valley green rising through brown to high-ground tan), heights
// from the IDW interpolation of the track's registered elevation in terrain.json. A small
// deterministic per-dot brightness jitter keeps it organic instead of screen-door flat.
// Fades out as the camera descends into it, so it reads as landscape from above and gets out
// of the way in follow cam / low orbit.

import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import type { Terrain } from "../assets";

const BASE_OPACITY = 0.6;
const DROP_BELOW_ROAD = 1.0; // sit under the ribbon so it never z-fights
const DOT_SIZE = 9; // world-ish units with sizeAttenuation

// natural elevation ramp: deep green -> green -> earth brown -> dry tan
const RAMP: [number, [number, number, number]][] = [
  [0.0, [0.08, 0.2, 0.12]],
  [0.45, [0.2, 0.38, 0.18]],
  [0.75, [0.42, 0.37, 0.24]],
  [1.0, [0.62, 0.55, 0.42]],
];

function rampColor(t: number, out: [number, number, number]): void {
  const clamped = Math.min(Math.max(t, 0), 1);
  let i = 0;
  while (i < RAMP.length - 2 && clamped > RAMP[i + 1][0]) i++;
  const [t0, c0] = RAMP[i];
  const [t1, c1] = RAMP[i + 1];
  const f = (clamped - t0) / Math.max(t1 - t0, 1e-9);
  out[0] = c0[0] + f * (c1[0] - c0[0]);
  out[1] = c0[1] + f * (c1[1] - c0[1]);
  out[2] = c0[2] + f * (c1[2] - c0[2]);
}

export function TerrainGrid({ terrain, exaggeration }: { terrain: Terrain; exaggeration: number }) {
  const materialRef = useRef<THREE.PointsMaterial>(null);

  const { geometry, meanHeight } = useMemo(() => {
    const n = terrain.nCells;
    const positions = new Float32Array(n * n * 3);
    const colors = new Float32Array(n * n * 3);

    let hMin = Infinity;
    let hMax = -Infinity;
    let hSum = 0;
    for (let i = 0; i < terrain.heights.length; i++) {
      hMin = Math.min(hMin, terrain.heights[i]);
      hMax = Math.max(hMax, terrain.heights[i]);
      hSum += terrain.heights[i];
    }
    const hSpan = Math.max(hMax - hMin, 1e-9);

    const rgb: [number, number, number] = [0, 0, 0];
    let v = 0;
    for (let iz = 0; iz < n; iz++) {
      for (let ix = 0; ix < n; ix++) {
        const h = terrain.heights[iz * n + ix];
        positions[3 * v] = terrain.x0 + ix * terrain.dx;
        positions[3 * v + 1] = h - DROP_BELOW_ROAD;
        positions[3 * v + 2] = terrain.z0 + iz * terrain.dz;

        rampColor((h - hMin) / hSpan, rgb);
        // deterministic brightness jitter (hash of the index) for an organic look
        const jitter = 0.85 + 0.3 * (((v * 2654435761) >>> 16) % 1000) / 1000;
        colors[3 * v] = Math.min(rgb[0] * jitter, 1);
        colors[3 * v + 1] = Math.min(rgb[1] * jitter, 1);
        colors[3 * v + 2] = Math.min(rgb[2] * jitter, 1);
        v++;
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    return { geometry: geo, meanHeight: hSum / terrain.heights.length };
  }, [terrain]);

  useFrame(({ camera }) => {
    if (!materialRef.current) return;
    // fade as the camera approaches terrain height: full at 400 m above, gone at 60 m
    const above = camera.position.y - meanHeight * exaggeration;
    const t = Math.min(Math.max((above - 60) / 340, 0), 1);
    materialRef.current.opacity = BASE_OPACITY * t;
  });

  return (
    <points geometry={geometry} scale={[1, exaggeration, 1]}>
      <pointsMaterial
        ref={materialRef}
        vertexColors
        transparent
        opacity={BASE_OPACITY}
        size={DOT_SIZE}
        sizeAttenuation
        depthWrite={false}
      />
    </points>
  );
}
