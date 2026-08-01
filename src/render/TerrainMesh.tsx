// landscape context as a displaced surface rather than a dot field.
//
// TerrainGrid drew one point per grid vertex and faded out below 60 m of camera altitude, which
// meant that from the chase camera -- the shot the whole project exists to sell -- there was
// literally no ground. The same terrain.json becomes a PlaneGeometry displaced at its vertices:
// 40k triangles, one draw call, zero new asset bytes, and visible at every altitude.
//
// The grid is 200 cells now (17 m at Spa), so up close the facets would read as facets. A
// roughness break-up in the material plus vertex colours off the elevation ramp is what keeps it
// looking like ground rather than like a mesh.

import { useEffect, useMemo } from "react";
import * as THREE from "three";
import type { Terrain } from "../assets";
import { hexToRgb, useThemeTokens } from "../ui/theme";
import { grassRoughness } from "./textures";

const DROP_BELOW_ROAD = 1.0; // sit under the ribbon so it never z-fights the apron

export function TerrainMesh({
  terrain,
  exaggeration,
}: {
  terrain: Terrain;
  exaggeration: number;
}) {
  const tokens = useThemeTokens();

  const rampColor = useMemo(() => {
    const lo: [number, number, number] = [0, 0, 0];
    const mid: [number, number, number] = [0, 0, 0];
    const hi: [number, number, number] = [0, 0, 0];
    hexToRgb(tokens.terrainLo, lo);
    hexToRgb(tokens.terrainMid, mid);
    hexToRgb(tokens.terrainHi, hi);
    return (t: number, out: [number, number, number]) => {
      const c = Math.min(Math.max(t, 0), 1);
      const [a, b, f] = c < 0.6 ? [lo, mid, c / 0.6] : [mid, hi, (c - 0.6) / 0.4];
      out[0] = a[0] + f * (b[0] - a[0]);
      out[1] = a[1] + f * (b[1] - a[1]);
      out[2] = a[2] + f * (b[2] - a[2]);
    };
  }, [tokens]);

  const geometry = useMemo(() => {
    const n = terrain.nCells;
    const width = (n - 1) * terrain.dx;
    const depth = (n - 1) * terrain.dz;

    // PlaneGeometry's vertex order runs +x across and -z down its local y, so it is laid out in
    // the same row-major order terrain.heights ships in once it is rotated flat. Building it
    // this way rather than by hand keeps the triangulation identical to the one
    // TerrainGrid.sample_triangulated models offline, which is what the apron was tied to.
    const geo = new THREE.PlaneGeometry(width, depth, n - 1, n - 1);
    geo.rotateX(-Math.PI / 2);

    const position = geo.attributes.position as THREE.BufferAttribute;
    const colors = new Float32Array(position.count * 3);

    let hMin = Infinity;
    let hMax = -Infinity;
    for (let i = 0; i < terrain.heights.length; i++) {
      hMin = Math.min(hMin, terrain.heights[i]);
      hMax = Math.max(hMax, terrain.heights[i]);
    }
    const hSpan = Math.max(hMax - hMin, 1e-9);

    const rgb: [number, number, number] = [0, 0, 0];
    for (let iz = 0; iz < n; iz++) {
      for (let ix = 0; ix < n; ix++) {
        const v = iz * n + ix;
        const h = terrain.heights[v];
        position.setY(v, h - DROP_BELOW_ROAD);
        rampColor((h - hMin) / hSpan, rgb);
        colors[3 * v] = rgb[0];
        colors[3 * v + 1] = rgb[1];
        colors[3 * v + 2] = rgb[2];
      }
    }
    position.needsUpdate = true;
    geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    geo.computeVertexNormals();

    // the plane is built centred on its own origin; move it onto the grid's world corner
    geo.translate(terrain.x0 + width / 2, 0, terrain.z0 + depth / 2);
    return geo;
  }, [terrain, rampColor]);

  useEffect(() => () => geometry.dispose(), [geometry]);

  return (
    <mesh geometry={geometry} scale={[1, exaggeration, 1]} receiveShadow={false}>
      <meshStandardMaterial
        vertexColors
        roughness={0.97}
        metalness={0}
        roughnessMap={grassRoughness()}
        // the far edge of the grid is a hard square; fog is what dissolves it into the sky,
        // which is why M10 retunes the fog range rather than growing the terrain
        fog
      />
    </mesh>
  );
}
