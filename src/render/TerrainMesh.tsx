// landscape context as a glowing point-and-wire field over a dark surface.
//
// Three layers, all sharing one position buffer so the whole landscape is three draw calls and
// one copy of the geometry:
//
//   1. a solid surface, coloured close to the background. It is there to *occlude*, not to be
//      seen: without it the circuit reads through its own hills and the far side of the lap
//      hangs in front of the near side.
//   2. the triangulated wireframe, indexed off the same positions, dim.
//   3. a point at every grid vertex, bright, coloured by elevation.
//
// This is the dot field the project started with, rebuilt properly. The original faded out below
// 60 m of camera altitude, so from the chase camera there was no ground at all; it had no wires,
// so the surface never read as a surface; and it sat on a point cloud with no depth occlusion.
// Nothing here fades, and the fog does the distance work instead.

import { useEffect, useMemo } from "react";
import * as THREE from "three";
import type { Terrain } from "../assets";
import { hexToRgb, useTheme, useThemeTokens } from "../ui/theme";

const DROP_BELOW_ROAD = 1.0; // sit under the ribbon so it never z-fights the apron

export function TerrainMesh({
  terrain,
  exaggeration,
}: {
  terrain: Terrain;
  exaggeration: number;
}) {
  const tokens = useThemeTokens();
  const { theme } = useTheme();
  const dark = theme === "dark";

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

  const { surface, wire, dots } = useMemo(() => {
    const n = terrain.nCells;
    const width = (n - 1) * terrain.dx;
    const depth = (n - 1) * terrain.dz;

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

    // the glow layers want more chroma than a shaded surface does, or the ramp reads as grey
    // once it is emissive. The light theme goes the other way: darker than the ground it sits on.
    const boost = dark ? 1.9 : 0.55;
    const rgb: [number, number, number] = [0, 0, 0];
    for (let iz = 0; iz < n; iz++) {
      for (let ix = 0; ix < n; ix++) {
        const v = iz * n + ix;
        const h = terrain.heights[v];
        position.setY(v, h - DROP_BELOW_ROAD);
        rampColor((h - hMin) / hSpan, rgb);
        colors[3 * v] = Math.min(rgb[0] * boost, 1);
        colors[3 * v + 1] = Math.min(rgb[1] * boost, 1);
        colors[3 * v + 2] = Math.min(rgb[2] * boost, 1);
      }
    }
    position.needsUpdate = true;
    geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    geo.translate(terrain.x0 + width / 2, 0, terrain.z0 + depth / 2);

    // the wireframe shares the surface's position and colour buffers and carries only its own
    // index, so the triangulated look costs an index buffer rather than a second copy of 40k
    // vertices. One diagonal per cell, matching the triangulation the surface actually uses.
    const segments: number[] = [];
    for (let iz = 0; iz < n; iz++) {
      for (let ix = 0; ix < n; ix++) {
        const v = iz * n + ix;
        if (ix < n - 1) segments.push(v, v + 1);
        if (iz < n - 1) segments.push(v, v + n);
        if (ix < n - 1 && iz < n - 1) segments.push(v + 1, v + n);
      }
    }
    const wireGeo = new THREE.BufferGeometry();
    wireGeo.setAttribute("position", geo.attributes.position);
    wireGeo.setAttribute("color", geo.attributes.color);
    wireGeo.setIndex(segments);

    // the dots need their own geometry with **no index**: an indexed one would draw a point per
    // index, so every vertex would be overdrawn once per edge that touches it
    const dotGeo = new THREE.BufferGeometry();
    dotGeo.setAttribute("position", geo.attributes.position);
    dotGeo.setAttribute("color", geo.attributes.color);

    return { surface: geo, wire: wireGeo, dots: dotGeo };
  }, [terrain, rampColor, dark]);

  useEffect(
    () => () => {
      surface.dispose();
      wire.dispose();
      dots.dispose();
    },
    [surface, wire, dots],
  );

  const scale: [number, number, number] = [1, exaggeration, 1];

  return (
    <group>
      {/* the occluder. Deliberately close to the background colour: its job is to stop the far
          side of the circuit showing through the near side's hills, not to be looked at. */}
      <mesh geometry={surface} scale={scale}>
        <meshBasicMaterial color={tokens.sceneBg} polygonOffset polygonOffsetFactor={1} polygonOffsetUnits={1} />
      </mesh>

      <lineSegments geometry={wire} scale={scale}>
        <lineBasicMaterial
          vertexColors
          transparent
          opacity={dark ? 0.22 : 0.30}
          blending={dark ? THREE.AdditiveBlending : THREE.NormalBlending}
          depthWrite={false}
        />
      </lineSegments>

      <points geometry={dots} scale={scale}>
        <pointsMaterial
          vertexColors
          transparent
          opacity={dark ? 0.95 : 0.6}
          size={dark ? 2.6 : 2.0}
          sizeAttenuation={false}
          blending={dark ? THREE.AdditiveBlending : THREE.NormalBlending}
          depthWrite={false}
        />
      </points>
    </group>
  );
}
