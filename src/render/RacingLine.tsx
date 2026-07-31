// the hero element: the racing line as a fat line, recoloured in place on every solve.
// phase mode mirrors offline/validation/plots.py's PHASE_COLORS; speed mode approximates the
// viridis ramp the repo's speed_map plot uses. Colours are written into a preallocated array
// and pushed with geometry.setColors: the geometry/positions are never rebuilt, and the
// component never remounts on slider changes (DESIGN_NOTES M6's in-place update requirement).

import { Line } from "@react-three/drei";
import { useEffect, useMemo, useRef } from "react";
import type { Line2 } from "three-stdlib";
import type { VelocityProfileResult } from "../solver/velocity";
import { PHASE_ACCEL, PHASE_BRAKE } from "../solver/velocity";
import type { LineData } from "../assets";

export type ColorMode = "phase" | "speed";

const LINE_LIFT_M = 0.4; // render-side lift above the ribbon; the data stays on the surface

const PHASE_RGB: Record<number, [number, number, number]> = {
  [PHASE_ACCEL]: [0.17, 0.63, 0.17], // accel green, matches plots.py
  [PHASE_BRAKE]: [0.84, 0.15, 0.16], // brake red
};
const COAST_RGB: [number, number, number] = [0.55, 0.55, 0.58];

// coarse viridis stops, matching matplotlib's colormap closely enough for the eye
const VIRIDIS: [number, number, number][] = [
  [0.267, 0.005, 0.329],
  [0.283, 0.141, 0.458],
  [0.254, 0.265, 0.53],
  [0.207, 0.372, 0.553],
  [0.164, 0.471, 0.558],
  [0.128, 0.567, 0.551],
  [0.135, 0.659, 0.518],
  [0.267, 0.749, 0.441],
  [0.478, 0.821, 0.318],
  [0.741, 0.873, 0.15],
  [0.993, 0.906, 0.144],
];

export function viridis(t: number, out: [number, number, number]): void {
  const clamped = Math.min(Math.max(t, 0), 1);
  const scaled = clamped * (VIRIDIS.length - 1);
  const i = Math.min(Math.floor(scaled), VIRIDIS.length - 2);
  const f = scaled - i;
  out[0] = VIRIDIS[i][0] + f * (VIRIDIS[i + 1][0] - VIRIDIS[i][0]);
  out[1] = VIRIDIS[i][1] + f * (VIRIDIS[i + 1][1] - VIRIDIS[i][1]);
  out[2] = VIRIDIS[i][2] + f * (VIRIDIS[i + 1][2] - VIRIDIS[i][2]);
}

interface RacingLineProps {
  line: LineData;
  result: VelocityProfileResult;
  colorMode: ColorMode;
  onHoverIndex?: (index: number | null) => void;
}

export function RacingLine({ line, result, colorMode, onHoverIndex }: RacingLineProps) {
  const lineRef = useRef<Line2>(null);

  const liftedPoints = useMemo(() => {
    const pts: [number, number, number][] = [];
    for (let i = 0; i < line.nPoints; i++) {
      pts.push([
        line.positionYup[3 * i],
        line.positionYup[3 * i + 1] + LINE_LIFT_M,
        line.positionYup[3 * i + 2],
      ]);
    }
    return pts;
  }, [line]);

  const colorBuffer = useMemo(
    () => new Float32Array(line.nPoints * 3),
    [line],
  );

  useEffect(() => {
    const scratch: [number, number, number] = [0, 0, 0];
    let vMin = Infinity;
    let vMax = -Infinity;
    if (colorMode === "speed") {
      for (let i = 0; i < line.nPoints; i++) {
        vMin = Math.min(vMin, result.vMps[i]);
        vMax = Math.max(vMax, result.vMps[i]);
      }
    }
    for (let i = 0; i < line.nPoints; i++) {
      let rgb: [number, number, number];
      if (colorMode === "phase") {
        rgb = PHASE_RGB[result.phase[i]] ?? COAST_RGB;
      } else {
        viridis((result.vMps[i] - vMin) / Math.max(vMax - vMin, 1e-9), scratch);
        rgb = scratch;
      }
      colorBuffer[3 * i] = rgb[0];
      colorBuffer[3 * i + 1] = rgb[1];
      colorBuffer[3 * i + 2] = rgb[2];
    }
    lineRef.current?.geometry.setColors(colorBuffer as unknown as number[]);
  }, [result, colorMode, colorBuffer, line]);

  return (
    <Line
      ref={lineRef}
      points={liftedPoints}
      vertexColors={Array.from({ length: line.nPoints }, () => [0.5, 0.5, 0.5])}
      lineWidth={3}
      onPointerMove={(e) => {
        if (!onHoverIndex) return;
        // nearest line index to the hit point: linear scan is ~7k ops, trivial per event
        let best = 0;
        let bestD = Infinity;
        for (let i = 0; i < line.nPoints; i++) {
          const dx = line.positionYup[3 * i] - e.point.x;
          const dy = line.positionYup[3 * i + 1] + LINE_LIFT_M - e.point.y;
          const dz = line.positionYup[3 * i + 2] - e.point.z;
          const d = dx * dx + dy * dy + dz * dz;
          if (d < bestD) {
            bestD = d;
            best = i;
          }
        }
        onHoverIndex(best);
      }}
      onPointerOut={() => onHoverIndex?.(null)}
    />
  );
}
