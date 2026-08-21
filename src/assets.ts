// loads the per-circuit assets offline/build_viewer_assets.py generates into /public.

import type { GT3Vehicle } from "./solver/vehicle";

export interface LineData {
  positionYup: Float32Array; // flat xyz, glTF Y-up frame, metres
  sM: Float64Array; // closed-duplicate arc length
  // elevation, extracted from positionYup rather than shipped as its own array. duplicating
  // it in line.json would cost ~60 KB per circuit and create two representations of the same
  // number that can disagree, and since M8 the solver reads it as physics.
  zM: Float64Array;
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

/** one braking board or turn sign, positioned by arc length. */
export interface Board {
  distanceM: number;
  sM: number;
}

/**
 * a named corner. Since M9 this comes from public/<circuit>/landmarks.json rather than from a
 * TS module: it is 100+ entries per circuit once boards are counted, the arc lengths have to be
 * validated against the generated geometry, and the s frame has to be the generated line's own.
 */
export interface Corner {
  id: string;
  number: number;
  name: string;
  sM: number;
  turnInSM: number;
  boardSide: "left" | "right";
  boards: Board[];
}

/** a trackside object. `kind` selects a procedural generator; there is no geometry in the file. */
export interface Structure {
  id: string;
  kind: string;
  placement: "track" | "world";
  sM?: number;
  offsetM: number;
  spanM: number;
  heightM: number;
  lengthM: number;
  bankDeg: number;
  widthM: number;
  polylineXz: [number, number][];
}

export interface Landmarks {
  corners: Corner[];
  structures: Structure[];
  runoffWidthM: number;
  /** stated once, in the panel header: these are hand-placed estimates, not a survey. */
  authoringNote: string;
}

export interface CircuitAssets {
  line: LineData;
  trackLines: TrackLines;
  terrain: Terrain;
  landmarks: Landmarks;
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

/**
 * the glTF frame puts elevation in y, so z(s) is the middle component of each row.
 *
 * read from the JSON rows rather than from the Float32Array the renderer uses: the solver takes
 * a second derivative of z to get vertical curvature, and float32 at 100 m is ~8e-6 m, which
 * that derivative turns into a visible load error. positions are still float32 for the GPU;
 * this is the same numbers at full width, not a second source of truth.
 */
function elevationFrom(rows: number[][]): Float64Array {
  const z = new Float64Array(rows.length);
  for (let i = 0; i < rows.length; i++) z[i] = rows[i][1];
  return z;
}

/** why a circuit failed to load, in the terms the reader needs rather than the terms fetch uses */
export type LoadFailure = "notfound" | "offline" | "network" | "malformed" | "http";

export class CircuitLoadError extends Error {
  readonly failure: LoadFailure;
  readonly url: string;

  constructor(failure: LoadFailure, url: string, message: string) {
    super(message);
    this.name = "CircuitLoadError";
    this.failure = failure;
    this.url = url;
  }
}

async function fetchJson(url: string): Promise<any> {
  let r: Response;
  try {
    r = await fetch(url);
  } catch {
    // fetch only rejects on a transport failure: offline, DNS, connection refused. An HTTP error
    // is a resolved promise, so this branch really does mean "never reached the server".
    const offline = typeof navigator !== "undefined" && !navigator.onLine;
    throw new CircuitLoadError(
      offline ? "offline" : "network",
      url,
      `could not reach ${url}`,
    );
  }

  if (r.status === 404) throw new CircuitLoadError("notfound", url, `${url} returned 404`);
  if (!r.ok) throw new CircuitLoadError("http", url, `${url} returned ${r.status}`);

  // a dev server and most static hosts answer an unknown path with the SPA's own index.html at
  // 200, so a circuit that does not exist arrives here as HTML rather than as a 404. Without
  // this check it surfaced as the raw `Unexpected token '<', "<!doctype "...` the JSON parser
  // throws, which names nothing the reader can act on and looks like a crash rather than a typo.
  const contentType = r.headers.get("content-type") ?? "";
  if (!contentType.includes("json")) {
    throw new CircuitLoadError(
      "notfound",
      url,
      `${url} answered with ${contentType || "no content-type"} rather than JSON`,
    );
  }

  try {
    return await r.json();
  } catch {
    throw new CircuitLoadError("malformed", url, `${url} is not valid JSON`);
  }
}

export async function loadCircuitAssets(circuitId: string): Promise<CircuitAssets> {
  const base = `${import.meta.env.BASE_URL}${circuitId}`;
  const [lineRaw, trackLinesRaw, terrainRaw, landmarksRaw, vehicleBase] = await Promise.all([
    fetchJson(`${base}/line.json`),
    fetchJson(`${base}/track_lines.json`),
    fetchJson(`${base}/terrain.json`),
    fetchJson(`${base}/landmarks.json`),
    fetchJson(`${base}/vehicle.json`) as Promise<GT3Vehicle>,
  ]);

  const lineRows = lineRaw.line.position_yup as number[][];
  const linePositions = flattenXyz(lineRows);

  return {
    line: {
      positionYup: linePositions,
      sM: Float64Array.from(lineRaw.line.s_m as number[]),
      zM: elevationFrom(lineRows),
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
    landmarks: {
      corners: (landmarksRaw.corners as any[]).map((c) => ({
        id: c.id,
        number: c.number,
        name: c.name,
        sM: c.s_m,
        turnInSM: c.turn_in_s_m,
        boardSide: c.board_side,
        boards: (c.boards as any[]).map((b) => ({ distanceM: b.distance_m, sM: b.s_m })),
      })),
      structures: (landmarksRaw.structures as any[]).map((s) => ({
        id: s.id,
        kind: s.kind,
        placement: s.placement,
        sM: s.s_m,
        offsetM: s.offset_m ?? 0,
        spanM: s.span_m ?? 10,
        heightM: s.height_m ?? 6,
        lengthM: s.length_m ?? 30,
        bankDeg: s.bank_deg ?? 0,
        widthM: s.width_m ?? 10,
        polylineXz: (s.polyline_xz ?? []) as [number, number][],
      })),
      runoffWidthM: landmarksRaw.runoff.default_width_m as number,
      authoringNote: landmarksRaw.meta.authoring_note as string,
    },
    vehicleBase,
    glbUrl: `${base}/track.glb`,
  };
}
