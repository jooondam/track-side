// The circuit's footprint in the ground plane, and the two numbers every camera in the app is
// framed against.
//
// One definition, because these are no longer just framing hints. `extent` sets the leash radius
// in cameraLeash.ts, and buildViewpoints places the whole-circuit shots off `center`; the
// assertion in cameraLeash.test.ts that the authored viewpoints all fit inside the leash is only
// meaningful if both sides were measured the same way. App.tsx and Scene.tsx each carried a
// private copy of this loop -- identical today, and nothing but luck keeping them that way.

import type { CircuitAssets } from "../assets";

export interface SceneBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

/** the racing line's bounding box in x/z. The line, not the track mesh: it is the thing the
 *  viewer is about, and it is the tighter of the two. */
export function sceneBounds(assets: CircuitAssets): SceneBounds {
  const p = assets.line.positionYup;
  let minX = Infinity,
    maxX = -Infinity,
    minZ = Infinity,
    maxZ = -Infinity;
  for (let i = 0; i < assets.line.nPoints; i++) {
    minX = Math.min(minX, p[3 * i]);
    maxX = Math.max(maxX, p[3 * i]);
    minZ = Math.min(minZ, p[3 * i + 2]);
    maxZ = Math.max(maxZ, p[3 * i + 2]);
  }
  return { minX, maxX, minZ, maxZ };
}

/** the centre of that box, at y = 0. */
export function sceneCenter(assets: CircuitAssets): readonly [number, number, number] {
  const b = sceneBounds(assets);
  return [(b.minX + b.maxX) / 2, 0, (b.minZ + b.maxZ) / 2] as const;
}

/** the box's widest span. Spa 2049 m, Monza 2174 m. */
export function sceneExtent(assets: CircuitAssets): number {
  const b = sceneBounds(assets);
  return Math.max(b.maxX - b.minX, b.maxZ - b.minZ);
}
