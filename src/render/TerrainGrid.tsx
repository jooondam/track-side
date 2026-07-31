// landscape context: a translucent wireframe grid displaced by the IDW terrain heights from
// terrain.json: accurate where the track's registered elevation constrains it, honestly
// smoothed elsewhere. Fades out as the camera descends into it (reads as landscape from
// above, gets out of the way in follow cam / low orbit).

import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import type { Terrain } from "../assets";

const BASE_OPACITY = 0.16;
const DROP_BELOW_ROAD = 1.0; // sit under the ribbon so it never z-fights

export function TerrainGrid({ terrain, exaggeration }: { terrain: Terrain; exaggeration: number }) {
  const materialRef = useRef<THREE.LineBasicMaterial>(null);

  const geometry = useMemo(() => {
    const n = terrain.nCells;
    const positions: number[] = [];
    const at = (ix: number, iz: number): [number, number, number] => [
      terrain.x0 + ix * terrain.dx,
      terrain.heights[iz * n + ix] - DROP_BELOW_ROAD,
      terrain.z0 + iz * terrain.dz,
    ];
    // grid lines along x and along z, as line segments
    for (let iz = 0; iz < n; iz += 2) {
      for (let ix = 0; ix < n - 1; ix++) {
        positions.push(...at(ix, iz), ...at(ix + 1, iz));
      }
    }
    for (let ix = 0; ix < n; ix += 2) {
      for (let iz = 0; iz < n - 1; iz++) {
        positions.push(...at(ix, iz), ...at(ix, iz + 1));
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    return geo;
  }, [terrain]);

  // mean terrain height, for the camera-proximity fade reference
  const meanHeight = useMemo(() => {
    let sum = 0;
    for (let i = 0; i < terrain.heights.length; i++) sum += terrain.heights[i];
    return sum / terrain.heights.length;
  }, [terrain]);

  useFrame(({ camera }) => {
    if (!materialRef.current) return;
    // fade as the camera approaches terrain height: full at 400 m above, gone at 60 m
    const above = camera.position.y - meanHeight * exaggeration;
    const t = Math.min(Math.max((above - 60) / 340, 0), 1);
    materialRef.current.opacity = BASE_OPACITY * t;
  });

  return (
    <lineSegments geometry={geometry} scale={[1, exaggeration, 1]}>
      <lineBasicMaterial
        ref={materialRef}
        color="#3ec8d8"
        transparent
        opacity={BASE_OPACITY}
        depthWrite={false}
      />
    </lineSegments>
  );
}
