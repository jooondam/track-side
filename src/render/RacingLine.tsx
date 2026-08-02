// the hero element: the racing line as a fat line, recoloured in place on every solve.
// phase mode mirrors offline/validation/plots.py's PHASE_COLORS; speed mode approximates the
// viridis ramp the repo's speed_map plot uses. Colours are written into a preallocated array
// and pushed with geometry.setColors: the geometry/positions are never rebuilt, and the
// component never remounts on slider changes (DESIGN_NOTES M6's in-place update requirement).
//
// Two things make it read as *lit* rather than as a hairline, both free:
//
//   1. **The colours are converted.** setColors writes straight into a vertex attribute, which
//      three treats as linear and then converts to sRGB on output. Feeding it raw /255 values
//      brightened and desaturated everything: #35d96a arrived on screen as pale mint. Going
//      through hexToLinearRgb means the rendered pixel is the token, exactly.
//   2. **toneMapped is off, and the glow is three passes.** ACES at exposure 1.05 desaturates
//      by design, which is right for the paint on a car and wrong for a data channel. The glow
//      is a wide dim additive pass and a narrower brighter one behind an opaque core, which is
//      what bloom would have done to this line for the price of a postprocessing stack
//      DESIGN_NOTES 0.2b rules out. It also cannot smear one phase colour into its neighbour,
//      which was the specific objection to bloom.
//
// LineMaterial inherits ShaderMaterial's `fog = false`, so the line is deliberately unfogged:
// it stays legible across the far side of the circuit while everything under it hazes out.

import { Line } from "@react-three/drei";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { Line2 } from "three-stdlib";
import type { VelocityProfileResult } from "../solver/velocity";
import { PHASE_ACCEL, PHASE_BRAKE } from "../solver/velocity";
import type { LineData } from "../assets";
import { useThemeTokens } from "../ui/theme";
import { hexToLinearRgb, srgbToLinearRgb } from "./colorspace";

export type ColorMode = "phase" | "speed";

const LINE_LIFT_M = 0.4; // render-side lift above the ribbon; the data stays on the surface

// the glow stack, widest first.
//
// **Normal blending, not additive, and that is measured rather than chosen.** Blending happens
// in the framebuffer, which is sRGB-encoded: colorspace_fragment converts before the blend, so
// an additive pass adds *display* values, not linear ones. phaseAccel is linear 0.694 green but
// sRGB 0.856, and three passes summing to 1.38x put it at 1.18 -- clipped, with every channel
// rising together, so the line rendered as a white ribbon with green and red fringes. Viridis'
// top stop is worse at 0.993 before any glow at all. There is no additive weighting that keeps
// a bright phase colour from clipping.
//
// With normal blending the halo colour equals the core colour, so mix(core, halo, a) is the
// core colour exactly and the centre of the line is the token, to the bit. Outside the core the
// same mix lands on the ground instead, which is the glow: a two-step coloured falloff spilling
// onto a near-black surface. Hue is preserved everywhere, which is the whole reason 0.2b
// rejected bloom in the first place.
// Widths are in **pixels**, not world units, so they do not shrink as the circuit does. At the
// overview a 12 m road is about 7 px, and an 18 px bloom made the line visibly wider than the
// road it sits on, which is the same "not geometrically realistic" complaint the apron had.
// Sized so the outer bloom stays inside the road at the overview and still reads from the
// chase camera, where the road is hundreds of pixels across.
const GLOW_PASSES = [
  { width: 11, opacity: 0.13, order: 1 },
  { width: 5.5, opacity: 0.3, order: 2 },
] as const;
const CORE_WIDTH = 2.6;

// coarse viridis stops, matching matplotlib's colormap closely enough for the eye.
// These are sRGB display values -- (0.267, 0.005, 0.329) is exactly #440154 -- and stay that
// way, because ColorLegend.tsx feeds this same function into a 2D canvas as a CSS rgb() string.
// The conversion to linear happens at the call site below, so the legend and the 3D line can
// never disagree about what a colour is.
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
  const coreRef = useRef<Line2>(null);
  const haloRef = useRef<Line2>(null);
  const bloomRef = useRef<Line2>(null);
  const tokens = useThemeTokens();

  // phase colours come from the theme so they change with it, and so the legend and the 3D line
  // can never disagree about what "braking" looks like
  const phaseRgb = useMemo(() => {
    const accel: [number, number, number] = [0, 0, 0];
    const brake: [number, number, number] = [0, 0, 0];
    const coast: [number, number, number] = [0, 0, 0];
    hexToLinearRgb(tokens.phaseAccel, accel);
    hexToLinearRgb(tokens.phaseBrake, brake);
    hexToLinearRgb(tokens.phaseCoast, coast);
    return { [PHASE_ACCEL]: accel, [PHASE_BRAKE]: brake, coast };
  }, [tokens]);

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

  // two buffers, because the glow passes carry an alpha channel and the core does not. That is
  // not cosmetic: LineMaterial's own onBeforeCompile sets USE_LINE_COLOR_ALPHA from
  // this.transparent, which declares instanceColorStart as a vec4. An itemSize-3 buffer would
  // work by accident (GL defaults .w to 1.0) but the layouts would silently disagree.
  const colorBuffer = useMemo(() => new Float32Array(line.nPoints * 3), [line]);
  const colorBuffer4 = useMemo(() => new Float32Array(line.nPoints * 4), [line]);

  // stable identity per circuit: an inline array here would hand drei a new prop identity on
  // every render, making it rebuild the geometry with these placeholder colours and wipe the
  // imperatively-set phase/speed colours (the "line goes grey" bug). With three passes there
  // are now three geometries that can be greyed, so both of these are shared, never inlined.
  const placeholderColors = useMemo(
    () => Array.from({ length: line.nPoints }, () => [0.5, 0.5, 0.5] as [number, number, number]),
    [line],
  );
  const placeholderColors4 = useMemo(
    () =>
      Array.from(
        { length: line.nPoints },
        () => [0.5, 0.5, 0.5, 1] as [number, number, number, number],
      ),
    [line],
  );

  useEffect(() => {
    const scratch: [number, number, number] = [0, 0, 0];
    const linear: [number, number, number] = [0, 0, 0];
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
        rgb = phaseRgb[result.phase[i]] ?? phaseRgb.coast;
      } else {
        viridis((result.vMps[i] - vMin) / Math.max(vMax - vMin, 1e-9), scratch);
        srgbToLinearRgb(scratch, linear);
        rgb = linear;
      }
      colorBuffer[3 * i] = rgb[0];
      colorBuffer[3 * i + 1] = rgb[1];
      colorBuffer[3 * i + 2] = rgb[2];
      colorBuffer4[4 * i] = rgb[0];
      colorBuffer4[4 * i + 1] = rgb[1];
      colorBuffer4[4 * i + 2] = rgb[2];
      colorBuffer4[4 * i + 3] = 1;
    }
    // each <Line> owns its own LineGeometry, so there is nothing shared to update once
    coreRef.current?.geometry.setColors(colorBuffer as unknown as number[]);
    haloRef.current?.geometry.setColors(colorBuffer4 as unknown as number[], 4);
    bloomRef.current?.geometry.setColors(colorBuffer4 as unknown as number[], 4);
  }, [result, colorMode, colorBuffer, colorBuffer4, line, phaseRgb]);

  return (
    <>
      {/* the glow. depthWrite is off so the two bands cannot occlude each other, and the
          renderOrder pins wide-then-narrow: three sorts coincident transparent objects by
          distance, which for three lines at identical positions is not a defined order. */}
      <Line
        ref={bloomRef}
        points={liftedPoints}
        vertexColors={placeholderColors4}
        lineWidth={GLOW_PASSES[0].width}
        transparent
        opacity={GLOW_PASSES[0].opacity}
        blending={THREE.NormalBlending}
        depthWrite={false}
        renderOrder={GLOW_PASSES[0].order}
        toneMapped={false}
      />
      <Line
        ref={haloRef}
        points={liftedPoints}
        vertexColors={placeholderColors4}
        lineWidth={GLOW_PASSES[1].width}
        transparent
        opacity={GLOW_PASSES[1].opacity}
        blending={THREE.NormalBlending}
        depthWrite={false}
        renderOrder={GLOW_PASSES[1].order}
        toneMapped={false}
      />

      {/* the core, and the only pass carrying the pointer handlers: the glow passes have no
          handlers at all, so r3f never adds them to its interaction list and the hover scan
          still runs once per event rather than three times. */}
      <Line
        ref={coreRef}
        points={liftedPoints}
        vertexColors={placeholderColors}
        lineWidth={CORE_WIDTH}
        transparent={false}
        toneMapped={false}
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
    </>
  );
}
