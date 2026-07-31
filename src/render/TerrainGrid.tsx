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
import { hexToRgb, useThemeTokens } from "../ui/theme";

const BASE_OPACITY = 0.42; // context, not texture: the dots must never outweigh the circuit
const DROP_BELOW_ROAD = 1.0; // sit under the ribbon so it never z-fights
const DOT_SIZE = 9; // world-ish units with sizeAttenuation

export function TerrainGrid({ terrain, exaggeration }: { terrain: Terrain; exaggeration: number }) {
  const materialRef = useRef<THREE.PointsMaterial>(null);
  const tokens = useThemeTokens();

  // low-to-high elevation ramp, from the theme so the terrain and the elevation chart under it
  // describe the same thing in the same colours
  const ramp = useMemo(() => {
    const lo: [number, number, number] = [0, 0, 0];
    const mid: [number, number, number] = [0, 0, 0];
    const hi: [number, number, number] = [0, 0, 0];
    hexToRgb(tokens.terrainLo, lo);
    hexToRgb(tokens.terrainMid, mid);
    hexToRgb(tokens.terrainHi, hi);
    return [lo, mid, hi];
  }, [tokens]);

  const rampColor = useMemo(() => {
    return (t: number, out: [number, number, number]) => {
      const c = Math.min(Math.max(t, 0), 1);
      const [lo, mid, hi] = ramp;
      const [a, b, f] = c < 0.6 ? [lo, mid, c / 0.6] : [mid, hi, (c - 0.6) / 0.4];
      out[0] = a[0] + f * (b[0] - a[0]);
      out[1] = a[1] + f * (b[1] - a[1]);
      out[2] = a[2] + f * (b[2] - a[2]);
    };
  }, [ramp]);

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
  }, [terrain, rampColor]);

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
