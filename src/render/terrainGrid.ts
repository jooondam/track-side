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

/**
 * how far under the road the heightfield sits, in metres.
 *
 * It was 1.0 m, sized to clear the apron. With the apron no longer drawn (see TrackMesh.tsx) the
 * terrain runs straight up to the road edge, and the drop is doing one job only: guaranteeing the
 * landscape never pierces the road ribbon. That is a measurable quantity rather than a taste one.
 * The terrain grid is an IDW of the track's own registered elevation, so it is near-exact at the
 * road. Sampled under all 21,003 boundary and centreline points of Spa and 17,373 of Monza,
 * in metres of raw grid height above the road:
 *
 *              p50      p99     p999    worst
 *     spa     0.000    0.035    0.120    0.432
 *     monza   0.000    0.005    0.014    0.041
 *
 * The distribution is the whole argument. The grid tracks the road to under a millimetre almost
 * everywhere and the constant is sized entirely by a thin tail, so anything picked off the
 * median would look right at both circuits and still tear open at Eau Rouge. 0.75 m is the worst
 * case plus about 40%, and still a quarter of the 1.0 m the apron needed.
 *
 * **Measure this triangulated, not bilinear.** The rendered surface is triangles and the two only
 * agree along cell edges: bilinear puts Spa's worst case at 0.298 m, which is 0.13 m of clearance
 * that does not exist. roadClearance.test.ts asserts against the shipped assets using the same
 * split the grid is wound with, so regenerating terrain.json with a worse cliff fails the suite
 * rather than shipping ground poking through the track.
 *
 * The drop is in unexaggerated metres, so the elevation slider multiplies it: at 3x the gap under
 * the road edge is 2.25 m. Holding it constant would mean rebuilding a 61k-vertex grid on every
 * slider change, which costs more than the gap is worth.
 */
export const DROP_BELOW_ROAD = 0.75;

export function smoothstep01(t: number): number {
  const c = Math.min(Math.max(t, 0), 1);
  return c * c * (3 - 2 * c);
}

/**
 * height of the *rendered* terrain surface at a world (x, z), or null outside the heightfield.
 *
 * Bilinear is the wrong answer here and by more than it looks: the surface is triangles, and a
 * triangulated quad and its bilinear patch only agree on the cell's edges. This mirrors the
 * anti-diagonal split TerrainMesh winds its index with, which is also the split
 * offline/mesh/terrain.py's sample_triangulated replicates, so all three agree on where the
 * ground is. Heights are row-major [iz][ix], matching assets.ts.
 */
export function sampleTriangulated(
  grid: { nCells: number; x0: number; z0: number; dx: number; dz: number; heights: ArrayLike<number> },
  x: number,
  z: number,
): number | null {
  const n = grid.nCells;
  const fx = (x - grid.x0) / grid.dx;
  const fz = (z - grid.z0) / grid.dz;
  const ix = Math.floor(fx);
  const iz = Math.floor(fz);
  if (ix < 0 || iz < 0 || ix >= n - 1 || iz >= n - 1) return null;

  const u = fx - ix;
  const v = fz - iz;
  const h00 = grid.heights[iz * n + ix];
  const h10 = grid.heights[iz * n + ix + 1];
  const h01 = grid.heights[(iz + 1) * n + ix];
  const h11 = grid.heights[(iz + 1) * n + ix + 1];

  // the shared edge runs from (ix, iz+1) to (ix+1, iz), so u + v <= 1 is the lower triangle
  return u + v <= 1
    ? h00 + u * (h10 - h00) + v * (h01 - h00)
    : h11 + (1 - u) * (h01 - h11) + (1 - v) * (h10 - h11);
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
 * Exported rather than recomputed, because three files need it and they must not disagree:
 * TerrainMesh anchors the fade here, CameraRig leashes the camera to the same point, and
 * fieldRadii's bounds are radii from it. A private copy in any of them is a silent way for the
 * fade and the leash to drift apart.
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

export interface Heightfield {
  nCells: number;
  x0: number;
  z0: number;
  dx: number;
  dz: number;
  heights: ArrayLike<number>;
}

/**
 * a plate vertex's height, at a grid index into the skirted N x N grid.
 *
 * Edge-clamped and relaxed toward the global mean across the skirt. A pure clamp extrudes Eau
 * Rouge's relief straight out to 5 km and reads as a wall; a pure mean is a table-flat plate
 * meeting the real terrain at a crease. Smoothstepped, so neither end of the ramp is a break.
 *
 * Returns the relaxed height *and* the raw sample, because the elevation colour ramp is keyed to
 * the real terrain rather than to the relaxed skirt: tinting by the relaxed value would wash the
 * whole far field toward one mid-ramp colour.
 */
export function plateVertexHeight(
  hf: Heightfield,
  hMean: number,
  ix: number,
  iz: number,
): { h: number; sampled: number } {
  const n = hf.nCells;
  const R = SKIRT_RINGS;
  const ringX = ix < R ? R - ix : ix >= R + n ? ix - (R + n - 1) : 0;
  const ringZ = iz < R ? R - iz : iz >= R + n ? iz - (R + n - 1) : 0;
  const coreIx = Math.min(Math.max(ix - R, 0), n - 1);
  const coreIz = Math.min(Math.max(iz - R, 0), n - 1);
  const sampled = hf.heights[coreIz * n + coreIx];
  const relax = smoothstep01(Math.max(ringX, ringZ) / R);
  return { h: sampled + relax * (hMean - sampled), sampled };
}

/** largest index i with axis[i] <= v, on a monotone increasing array. */
function axisIndex(axis: Float64Array, v: number): number {
  let lo = 0;
  let hi = axis.length - 1;
  if (v <= axis[0]) return 0;
  if (v >= axis[hi]) return hi - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (axis[mid] <= v) lo = mid;
    else hi = mid;
  }
  return lo;
}

/**
 * the height of the *rendered occluder plate* at a world (x, z).
 *
 * **The visible field is sampled from this and not from the raw heightfield**, and that is load
 * bearing rather than tidy: the dots have to sit exactly on the plate. Inside the heightfield the
 * two agree anyway, but out in the skirt the plate's height is edge-clamped and relaxed, so a dot
 * placed from the raw grid would sink beneath the plate and be occluded by the very surface that
 * is supposed to be invisible. Reproducing the plate's own vertices, and its own anti-diagonal
 * split, means the field lies on the ground by construction at every radius.
 */
export function plateHeightAt(
  hf: Heightfield,
  xs: Float64Array,
  zs: Float64Array,
  hMean: number,
  x: number,
  z: number,
): { h: number; sampled: number } {
  const ix = axisIndex(xs, x);
  const iz = axisIndex(zs, z);
  const u = Math.min(Math.max((x - xs[ix]) / (xs[ix + 1] - xs[ix]), 0), 1);
  const v = Math.min(Math.max((z - zs[iz]) / (zs[iz + 1] - zs[iz]), 0), 1);

  const c00 = plateVertexHeight(hf, hMean, ix, iz);
  const c10 = plateVertexHeight(hf, hMean, ix + 1, iz);
  const c01 = plateVertexHeight(hf, hMean, ix, iz + 1);
  const c11 = plateVertexHeight(hf, hMean, ix + 1, iz + 1);

  // the shared edge runs (ix, iz+1) -> (ix+1, iz), matching the wind order TerrainMesh uses
  const pick = (a: number, b: number, c: number, d: number) =>
    u + v <= 1 ? a + u * (b - a) + v * (c - a) : d + (1 - u) * (c - d) + (1 - v) * (b - d);

  return {
    h: pick(c00.h, c10.h, c01.h, c11.h),
    sampled: pick(c00.sampled, c10.sampled, c01.sampled, c11.sampled),
  };
}

// ---------------------------------------------------------------------------------------------
// the visible field: a circular lattice that dissolves into scatter
//
// **The dots and the wire no longer live on the heightfield's grid, and that is the whole point.**
// They used to, and it drew the heightfield's rectangle onto the screen. The mechanism, measured
// at Spa: the fade was anchored on the grid's half-diagonal (2043 m) while the core heightfield
// ends at 1079 m on its short axis, and the skirt's spacing grows geometrically past it:
//
//        ring   radius   spacing   vs core   dot alpha
//           8     1217      30 m      2.7x      1.00
//          12     1429      71 m      6.6x      1.00
//          16     1937     171 m     15.8x      1.00
//
// Dots are a fixed pixel size, so density *is* brightness. By ring 16 the field was 16x sparser
// along one axis and 250x sparser by area, with the alpha still at exactly 1.00: a bright uniform
// plateau ending in a hard rectangular step. No choice of radii fixes that, because the density
// contour follows the grid's 1:1.6 rectangle and the fade contour is a circle. They cannot agree.
//
// So the visible layers get their own geometry, laid out in circles around the scene anchor:
// density and alpha now fall off in the same shape at every radius, on any circuit, whatever the
// heightfield's aspect ratio. A straight edge is no longer expressible.
//
// The occluder plate keeps the rectangular grid and skirt above. It is sceneBg-coloured and
// fogged to sceneFog, so its edge was never the problem and its geometry still backs the road
// clearance guarantee (see DROP_BELOW_ROAD).
// ---------------------------------------------------------------------------------------------

/** lattice spacing, in metres. Coarser than the 10.85 m heightfield: this is context, not data. */
export const FIELD_SPACING_M = 16;

/** the lattice radius, as a fraction of the circuit's own extent. Covers the whole circuit. */
export const LATTICE_EXTENT_K = 0.85;

/**
 * how far the wireframe reaches, as a fraction of the circuit's extent.
 *
 * **A short fade on a bright layer is an edge.** At 0.64 the wire went from full opacity to zero
 * across 174 m, and since the lattice carries three segments per cell it is the brightest thing
 * in the field: that 174 m drew its own circumference as a hard disc at Monza, which is how the
 * rectangle came back as a circle. Reaching to 0.95 of extent instead puts the whole fade outside
 * the racing line (furthest point 0.55 of extent at both circuits) and spreads it over 870 m.
 *
 * Affordable only because of WIRE_STRIDE: a wider disc at the lattice's own pitch would have cost
 * 157,000 segments, more than the rectangular field it replaced.
 */
export const WIRE_EXTENT_K = 0.95;

/**
 * draw the wire on every Nth lattice node.
 *
 * A 32 m survey grid rather than a 16 m one. This is not only a saving: at 16 m the lattice was
 * dense enough to read as a texture rather than as a grid, and the dots already carry the fine
 * detail. Striding by two cuts the segment count fourfold, which is what buys the wide gentle
 * fade above -- 39,000 segments over a 2,064 m disc against the old 183,521 over a rectangle.
 */
export const WIRE_STRIDE = 2;

/**
 * growth per scatter ring.
 *
 * This is a three-way trade and the numbers are worth keeping. Density falls as 1/spacing^2, so
 * growth compounds hard: at the 5.5% first tried, the field lost 2.8x of its density inside a
 * single 245 m band just outside the lattice, which is itself a visible ring. At 3% the worst
 * band-to-band step is 0.73 of the one inside it, which reads as recession rather than as an edge,
 * and the whole scatter costs about 30,000 points.
 *
 * The 0.73 is *perceived* brightness, not raw density: `spread` below lets the renderer grow a
 * sparse dot to cover more of its own cell, which is what keeps a 3% ring from needing 100,000
 * points to look smooth.
 */
export const SCATTER_GROWTH = 1.03;

/**
 * scatter rings over which the growth ratio eases in from 1.
 *
 * **The seam was density-continuous and still visible, because continuity is not enough.**
 * Brightness was exactly flat across the lattice and began falling the instant the scatter
 * started, and a kink in the *rate* draws a ring just as a step draws an edge: at Monza the
 * lattice's own circumference showed up as a bright disc, having replaced the rectangle with a
 * circle. Easing the ratio in over 30 rings takes the slope at the seam from -12% per 100 m to
 * -4.2%, and the dot fade starting inside the lattice (see fieldRadii) supplies the rest by
 * having the lattice already dimming when the scatter takes over.
 *
 * This is the same fix, for the same reason, as SKIRT_RAMP above.
 */
const SCATTER_RAMP = 30;

/** deterministic hash in [0,1). Seeded by integer coordinates so the field is identical on every
 *  load and in every screenshot, which is what makes it comparable between runs. */
function hash01(a: number, b: number): number {
  let h = Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export interface FieldLayout {
  /** interleaved x, z. Lattice points first, then scatter. */
  xz: Float64Array;
  /**
   * local spacing / lattice spacing, per point: 1 across the lattice, rising through the scatter.
   *
   * The renderer grows a dot's pixel size by sqrt of this, so its pixel *area* scales with the
   * ground area it stands for. Density falls as 1/spacing^2 and area rises as spacing, so what
   * the eye integrates falls as 1/spacing instead: a 13x thinning reads as 13x dimmer rather
   * than 170x, and the scatter can be sparse enough to afford without looking like it died.
   */
  spread: Float32Array;
  /** how many leading entries are lattice; the remainder are scatter. */
  latticeCount: number;
  /** total points */
  count: number;
  /** side of the square the lattice was clipped out of, in cells */
  latticeCols: number;
  /** lattice grid cell -> point index, or -1 where the cell fell outside the circle */
  latticeAt: Int32Array;
  latticeRadiusM: number;
  wireRadiusM: number;
  outerRadiusM: number;
  spacingM: number;
}

/**
 * the visible field's ground-plane layout.
 *
 * Two zones with **matched density at the seam**, which is what lets them join without a
 * crossfade: the last lattice cell and the first scatter ring are both `spacingM` across, so the
 * areal density is continuous and the jitter on both sides hides the join.
 *
 *   lattice   a square grid clipped to `latticeRadiusM`, jittered up to 30% of a cell. The jitter
 *             is not decoration: an exact grid moires against the pixel raster into the diagonal
 *             streaks that were visible across the old field.
 *   scatter   concentric rings whose spacing grows by SCATTER_GROWTH each step, with a hashed
 *             angular offset per ring and a radial jitter per point. Without the offset it reads
 *             as a bullseye; without the jitter, as spokes.
 */
export function buildFieldLayout(opts: {
  centerX: number;
  centerZ: number;
  latticeRadiusM: number;
  wireRadiusM: number;
  outerRadiusM: number;
  spacingM?: number;
}): FieldLayout {
  const s = opts.spacingM ?? FIELD_SPACING_M;
  const { centerX, centerZ, latticeRadiusM, outerRadiusM } = opts;

  const half = Math.ceil(latticeRadiusM / s);
  const cols = 2 * half + 1;
  const latticeAt = new Int32Array(cols * cols).fill(-1);

  const xs: number[] = [];
  const zs: number[] = [];
  const spread: number[] = [];

  const r2 = latticeRadiusM * latticeRadiusM;
  for (let j = 0; j < cols; j++) {
    for (let i = 0; i < cols; i++) {
      const gx = (i - half) * s;
      const gz = (j - half) * s;
      if (gx * gx + gz * gz > r2) continue;
      // +/-30% of a cell. Large enough to break the raster beat, small enough that the wire
      // connecting neighbours cannot cross itself.
      const jx = (hash01(i, j) - 0.5) * 0.6 * s;
      const jz = (hash01(j + 9871, i + 1237) - 0.5) * 0.6 * s;
      latticeAt[j * cols + i] = xs.length;
      xs.push(centerX + gx + jx);
      zs.push(centerZ + gz + jz);
      spread.push(1);
    }
  }
  const latticeCount = xs.length;

  // Scatter. **Growth is applied after placing a ring, not before**, so the first ring sits one
  // full lattice cell out at the lattice's own spacing and the areal density is continuous across
  // the seam. Growing first made the first ring 5.5% sparser than the lattice it joins, which is
  // the beginning of a step, and a step in density is a visible edge.
  const RADIAL_JITTER = 0.35; // of a step, either way
  let step = s;
  let r = latticeRadiusM;
  let ring = 0;
  for (;;) {
    r += step;
    // stop while the *jittered* outermost point still fits: the cap is the occluder plate's
    // edge, and a dot past it hangs over the sky with no ground under it
    if (r + RADIAL_JITTER * step > outerRadiusM) break;
    const n = Math.max(8, Math.round((2 * Math.PI * r) / step));
    const theta0 = hash01(ring, 5501) * Math.PI * 2;
    for (let k = 0; k < n; k++) {
      const theta = theta0 + ((k + (hash01(ring, k) - 0.5) * 0.8) / n) * Math.PI * 2;
      const rr = r + (hash01(k, ring + 77) - 0.5) * 2 * RADIAL_JITTER * step;
      xs.push(centerX + Math.cos(theta) * rr);
      zs.push(centerZ + Math.sin(theta) * rr);
      spread.push(step / s);
    }
    // eased, not constant: see SCATTER_RAMP
    step *= 1 + (SCATTER_GROWTH - 1) * smoothstep01(ring / SCATTER_RAMP);
    ring++;
  }

  const xz = new Float64Array(xs.length * 2);
  for (let i = 0; i < xs.length; i++) {
    xz[2 * i] = xs[i];
    xz[2 * i + 1] = zs[i];
  }

  return {
    xz,
    spread: Float32Array.from(spread),
    latticeCount,
    count: xs.length,
    latticeCols: cols,
    latticeAt,
    latticeRadiusM,
    wireRadiusM: opts.wireRadiusM,
    outerRadiusM,
    spacingM: s,
  };
}

/**
 * the radii the field is laid out and faded on.
 *
 * `outerRadius` is squeezed from both sides and both bounds are asserted in terrainGrid.test.ts:
 *
 *   below  the camera can reach extent * 2.5 from the target (CameraRig's maxDistance), and the
 *          fade is anchored to the scene, so an outer radius under that leaves a camera sitting
 *          in a hole with the field already gone underneath it.
 *   above  the occluder plate is a rectangle whose *inscribed* radius is min(halfX, halfZ) +
 *          SKIRT_REACH_M. Scatter past that is a dot with no plate under it, floating over the
 *          sky. The inscribed radius is the binding one, not the diagonal: the short axis is
 *          where the plate runs out first.
 */
export function fieldRadii(
  terrain: { nCells: number; dx: number; dz: number },
  circuitExtentM: number,
) {
  const halfX = ((terrain.nCells - 1) * terrain.dx) / 2;
  const halfZ = ((terrain.nCells - 1) * terrain.dz) / 2;
  const plateInscribed = Math.min(halfX, halfZ) + SKIRT_REACH_M; // Spa 6079 m, Monza 6066 m

  const latticeRadius = circuitExtentM * LATTICE_EXTENT_K; // Spa 1741 m, Monza 1847 m
  const wireRadius = circuitExtentM * WIRE_EXTENT_K; // Spa 1947 m, Monza 2064 m
  const outerRadius = plateInscribed - 200; // Spa 5879 m, Monza 5866 m

  return {
    latticeRadius,
    outerRadius,
    plateInscribed,
    // **The dot fade starts inside the lattice, not outside it.** It used to begin past the
    // lattice edge, which left brightness perfectly flat right up to the seam and then falling:
    // a kink, and a visible ring. Starting at 0.58 of extent puts it just beyond the furthest
    // point of the racing line (0.55 of extent at both circuits) so nothing over the circuit is
    // dimmed, while the lattice is already declining by the time the scatter begins.
    fadeStart: circuitExtentM * 0.58,
    fadeEnd: outerRadius * 0.97,
    wireRadius,
    // the lattice dies first, and entirely inside its own radius, so its circular boundary is
    // never a visible edge. Solid lattice, then bare dots, then nothing.
    // starts just past the furthest point of the racing line, ends where the geometry does, so
    // the wire is solid over the whole circuit and gone before its own boundary
    wireFadeStart: circuitExtentM * 0.56,
    wireFadeEnd: wireRadius,
  };
}
