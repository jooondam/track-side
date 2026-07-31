// loads the per-circuit assets offline/build_viewer_assets.py generates into /public.

import type { GT3Vehicle } from "./solver/vehicle";

export interface LineData {
  positionYup: Float32Array; // flat xyz, glTF Y-up frame, metres
  sM: Float64Array; // closed-duplicate arc length
  kappa1pm: Float64Array;
  loopLengthM: number;
  nPoints: number;
}

export interface TrackLines {
  boundaryLeft: Float32Array; // flat xyz, glTF Y-up
  boundaryRight: Float32Array;
  centerline: Float32Array;
  centerlineSM: Float64Array;
  centerlineKappa: Float64Array;
  nPoints: number;
}

export interface Terrain {
  nCells: number;
  x0: number;
  z0: number;
  dx: number;
  dz: number;
  heights: Float32Array; // row-major [iz][ix]
}

export interface CircuitAssets {
  line: LineData;
  trackLines: TrackLines;
  terrain: Terrain;
  vehicleBase: GT3Vehicle; // defaults from Python; mu overridden by the slider
  glbUrl: string;
}

function flattenXyz(rows: number[][]): Float32Array {
  const flat = new Float32Array(rows.length * 3);
  for (let i = 0; i < rows.length; i++) {
    flat[3 * i] = rows[i][0];
    flat[3 * i + 1] = rows[i][1];
    flat[3 * i + 2] = rows[i][2];
  }
  return flat;
}

async function fetchJson(url: string): Promise<any> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`failed to load ${url}: ${r.status}`);
  return r.json();
}

export async function loadCircuitAssets(circuitId: string): Promise<CircuitAssets> {
  const base = `${import.meta.env.BASE_URL}${circuitId}`;
  const [lineRaw, trackLinesRaw, terrainRaw, vehicleBase] = await Promise.all([
    fetchJson(`${base}/line.json`),
    fetchJson(`${base}/track_lines.json`),
    fetchJson(`${base}/terrain.json`),
    fetchJson(`${base}/vehicle.json`) as Promise<GT3Vehicle>,
  ]);

  return {
    line: {
      positionYup: flattenXyz(lineRaw.line.position_yup as number[][]),
      sM: Float64Array.from(lineRaw.line.s_m as number[]),
      kappa1pm: Float64Array.from(lineRaw.line.kappa_1pm as number[]),
      loopLengthM: lineRaw.meta.loop_length_m as number,
      nPoints: lineRaw.meta.n_points as number,
    },
    trackLines: {
      boundaryLeft: flattenXyz(trackLinesRaw.lines.boundary_left_yup as number[][]),
      boundaryRight: flattenXyz(trackLinesRaw.lines.boundary_right_yup as number[][]),
      centerline: flattenXyz(trackLinesRaw.lines.centerline_yup as number[][]),
      centerlineSM: Float64Array.from(trackLinesRaw.lines.centerline_s_m as number[]),
      centerlineKappa: Float64Array.from(trackLinesRaw.lines.centerline_kappa_1pm as number[]),
      nPoints: trackLinesRaw.meta.n_points as number,
    },
    terrain: {
      nCells: terrainRaw.meta.n_cells as number,
      x0: terrainRaw.meta.x0 as number,
      z0: terrainRaw.meta.z0 as number,
      dx: terrainRaw.meta.dx as number,
      dz: terrainRaw.meta.dz as number,
      heights: Float32Array.from((terrainRaw.heights as number[][]).flat()),
    },
    vehicleBase,
    glbUrl: `${base}/track.glb`,
  };
}
