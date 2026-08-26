// the terrain field's grid maths, split out from TerrainMesh so it can be asserted in node
// without importing r3f or touching a GPU. The boundary guarantee below is the kind of thing
// that fails silently as a barely-visible edge, which is exactly what a test is for.

/**
 * extra grid rings outside the heightfield, per side.
 *
 * **24 is a ceiling, not a preference.** The grid is (200 + 2*24)^2 = 61,504 vertices, which is
 * 4,032 below the 65,536 limit of a Uint16 index. At 28 rings it crosses, and
 * BufferGeometry.setIndex silently promotes both the surface and the wire index to Uint32:
 * double the index memory, and a hard dependency on OES_element_index_uint. If this scene ever
 * needs to get cheaper, come down from here rather than touching the fade radii, which are
 * load-bearing for the boundary guarantee.
 */
export const SKIRT_RINGS = 24;

/** how far past the heightfield the skirt reaches, in metres. */
export const SKIRT_REACH_M = 5000;

/**
 * rings over which the growth ratio eases in from 1.
 *
 * Without this the *rate* of density change is discontinuous at the heightfield boundary: cell
 * size is constant inside and starts decaying immediately outside. The dots are a fixed pixel
 * size, so density is brightness, and that break can draw the heightfield's rectangle back onto
 * the screen. Easing the ratio in over 8 rings makes the first skirt cell the same size as the
 * last real one *and* changing size at the same rate.
 */
export const SKIRT_RAMP = 8;

export function smoothstep01(t: number): number {
  const c = Math.min(Math.max(t, 0), 1);
  return c * c * (3 - 2 * c);
}

/** the spacing multiplier applied at skirt ring k, ramped in from 1 toward the full ratio. */
function ringGrowth(ratio: number, k: number): number {
  return 1 + (ratio - 1) * smoothstep01(k / SKIRT_RAMP);
}

/** total skirt reach for a given growth ratio. Summed, not closed-form: the ramp above has no
 *  geometric-series form, and it keeps ratio = 1 from being a division by zero. */
export function skirtReach(ratio: number, d0: number): number {
  let step = d0;
  let sum = 0;
  for (let k = 1; k <= SKIRT_RINGS; k++) {
    step *= ringGrowth(ratio, k);
    sum += step;
  }
  return sum;
}

/**
 * the growth ratio that lands the skirt on SKIRT_REACH_M, by bisection.
 *
 * Solved **per axis**, not once: Spa's dx is 10.85 m and its dz is 17.43 m, a 60% difference,
 * and a shared ratio would overshoot on one axis and undershoot on the other. Undershooting is
 * the dangerous one, because it puts the geometry boundary inside the fade's outer radius and
 * the hard edge comes back on the tight axis only.
 */
export function solveSkirtRatio(d0: number): number {
  const MIN = 1.0;
  const MAX = 1.6;
  if (skirtReach(MAX, d0) < SKIRT_REACH_M) return MAX;
  if (skirtReach(MIN, d0) > SKIRT_REACH_M) return MIN;
  let lo = MIN;
  let hi = MAX;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (skirtReach(mid, d0) < SKIRT_REACH_M) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/**
 * one axis of the terrain grid: the heightfield's own `n` samples at uniform `d0`, with
 * SKIRT_RINGS extra samples on each side whose spacing grows geometrically outward.
 *
 * Geometric and not linear, because the point of the skirt is to have no visible boundary: a
 * linear skirt at 5000/24 = 208 m per ring puts a twentyfold density step right where the
 * heightfield ends, which is the hard edge we are removing, moved outward by 5 km.
 */
export function buildGridAxis(origin: number, n: number, d0: number): Float64Array {
  const out = new Float64Array(n + 2 * SKIRT_RINGS);
  for (let i = 0; i < n; i++) out[SKIRT_RINGS + i] = origin + i * d0;

  const ratio = solveSkirtRatio(d0);
  let lo = origin;
  let hi = origin + (n - 1) * d0;
  let step = d0;
  for (let k = 1; k <= SKIRT_RINGS; k++) {
    step *= ringGrowth(ratio, k);
    lo -= step;
    hi += step;
    out[SKIRT_RINGS - k] = lo;
    out[SKIRT_RINGS + n - 1 + k] = hi;
  }
  return out;
}

/**
 * the heightfield's centre in world x/z: the point every radius on this page is measured from.
 *
 * Exported rather than recomputed, because two files need it and they must not disagree:
 * TerrainMesh anchors the fade here, and CameraRig leashes the camera to the same point. A
 * private copy in either file is a silent way for the fade and the leash to drift apart.
 */
export function terrainAnchorXz(terrain: {
  nCells: number;
  x0: number;
  z0: number;
  dx: number;
  dz: number;
}): { x: number; z: number } {
  return {
    x: terrain.x0 + ((terrain.nCells - 1) * terrain.dx) / 2,
    z: terrain.z0 + ((terrain.nCells - 1) * terrain.dz) / 2,
  };
}

/** the radii the dot and wire fades run on. */
export function fadeRadii(terrain: { nCells: number; dx: number; dz: number }) {
  const coreHalfDiag = Math.hypot(
    ((terrain.nCells - 1) * terrain.dx) / 2,
    ((terrain.nCells - 1) * terrain.dz) / 2,
  );
  const fadeStart = coreHalfDiag * 1.12; // Spa 2287 m: the whole heightfield stays at full brightness
  // fadeEnd is squeezed from both sides and both are asserted in terrainGrid.test.ts:
  //
  //   below  the camera can reach cameraLeashM(extent) from *this anchor* (see cameraLeash.ts),
  //          and the fade is anchored to the scene, so a fadeEnd under that leaves a camera
  //          sitting in a hole with the field already gone underneath it.
  //   above  the grid physically ends at coreHalf + SKIRT_REACH_M on each axis, and the dots
  //          must be at zero before then or the rectangular edge is visible again.
  //
  // 2.55 satisfied the upper bound at both circuits but landed on Monza's lower bound *exactly*:
  // maxDistance 5434 m against fadeEnd 5434 m, no margin at all. 2.70 gives Monza 320 m of
  // clearance below and 312 m above, which is the tightest of the four numbers.
  const fadeEnd = coreHalfDiag * 2.7; // Spa 5515 m, Monza 5754 m
  return {
    coreHalfDiag,
    fadeStart,
    fadeEnd,
    // the lattice dies well before the dots do. That gradient, solid lattice then bare dots then
    // nothing, sells the recession better than one uniform fade on both layers would.
    wireFadeStart: fadeStart * 0.45,
    wireFadeEnd: fadeEnd * 0.62,
  };
}
