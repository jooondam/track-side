// a short phase-coloured trail behind the car: the last few hundred metres it has driven.
//
// This is not decoration. The racing line is coloured for the *whole* lap at once, which makes it
// a map; the trail is coloured for where the car has just been, which makes it a readout. Under
// playback the two together answer a question neither answers alone: watching the trail turn red
// behind the car tells you the braking event is happening *now*, at this piece of road, at this
// speed, rather than leaving you to match a moving dot against a static stripe.
//
// It is also the cheapest possible way to do it. The car follows the racing line exactly, so the
// trail is not a history buffer that has to be recorded: it is a **window onto the line geometry
// that already exists**. Every frame we move a fixed-length slice of the line's own points and
// rewrite their colours with a fade. No allocation, no growth, no accumulation error, and it is
// correct immediately after a scrub instead of having to refill.
//
// Alpha, not brightness, carries the fade. Fading toward the background colour would be wrong in
// two ways: it is only right for one theme, and it would make the tail of the trail read as a
// *different phase* rather than as an older sample.

import { Line } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import type { Line2 } from "three-stdlib";
import type { LineData } from "../assets";
import type { LapProgress } from "./CarMarker";
import type { VelocityProfileResult } from "../solver/velocity";
import { PHASE_ACCEL, PHASE_BRAKE } from "../solver/velocity";
import { useThemeTokens } from "../ui/theme";
import { hexToLinearRgb } from "./colorspace";

/** how far back the trail reaches, in metres of arc length. */
const TRAIL_M = 240;
/** samples along it. 64 is smooth at 240 m (3.75 m a segment) and is 64 colour writes a frame. */
const SEGMENTS = 64;
/** clear of the racing line's own lift so the two do not z-fight where they overlap. */
const LIFT_M = 0.55;
const WIDTH_PX = 6;

interface CarTrailProps {
  line: LineData;
  result: VelocityProfileResult;
  progressRef: React.MutableRefObject<LapProgress>;
}

export function CarTrail({ line, result, progressRef }: CarTrailProps) {
  const ref = useRef<Line2>(null);
  const tokens = useThemeTokens();

  const phaseRgb = useMemo(() => {
    const accel: [number, number, number] = [0, 0, 0];
    const brake: [number, number, number] = [0, 0, 0];
    const coast: [number, number, number] = [0, 0, 0];
    hexToLinearRgb(tokens.phaseAccel, accel);
    hexToLinearRgb(tokens.phaseBrake, brake);
    hexToLinearRgb(tokens.phaseCoast, coast);
    return { [PHASE_ACCEL]: accel, [PHASE_BRAKE]: brake, coast };
  }, [tokens]);

  // placeholder geometry, replaced in place every frame. Stable identity so drei never rebuilds.
  const points = useMemo(
    () => Array.from({ length: SEGMENTS }, () => [0, 0, 0] as [number, number, number]),
    [],
  );
  const placeholder = useMemo(
    () => Array.from({ length: SEGMENTS }, () => [0.5, 0.5, 0.5, 1] as [number, number, number, number]),
    [],
  );
  const positions = useMemo(() => new Float32Array(SEGMENTS * 3), []);
  const colors = useMemo(() => new Float32Array(SEGMENTS * 4), []);

  useFrame(() => {
    const l = ref.current;
    if (!l) return;
    const loop = line.loopLengthM;
    const head = progressRef.current.sM;

    for (let k = 0; k < SEGMENTS; k++) {
      // k = 0 is the oldest sample, k = SEGMENTS-1 sits under the car
      const back = TRAIL_M * (1 - k / (SEGMENTS - 1));
      const s = ((head - back) % loop + loop) % loop;
      const i = Math.min(
        Math.max(Math.round((s / loop) * (line.nPoints - 1)), 0),
        line.nPoints - 1,
      );

      positions[3 * k] = line.positionYup[3 * i];
      positions[3 * k + 1] = line.positionYup[3 * i + 1] + LIFT_M;
      positions[3 * k + 2] = line.positionYup[3 * i + 2];

      const rgb = phaseRgb[result.phase[i]] ?? phaseRgb.coast;
      colors[4 * k] = rgb[0];
      colors[4 * k + 1] = rgb[1];
      colors[4 * k + 2] = rgb[2];
      // squared so the tail disappears quickly and the metres just driven stay solid
      const age = k / (SEGMENTS - 1);
      colors[4 * k + 3] = age * age;
    }

    // setPositions rebuilds the instanced start/end attributes, which is what a fat line needs;
    // there is no cheaper in-place path for a Line2 whose points move every frame.
    l.geometry.setPositions(positions as unknown as number[]);
    l.geometry.setColors(colors as unknown as number[], 4);
    l.computeLineDistances();
  });

  return (
    <Line
      ref={ref}
      points={points}
      vertexColors={placeholder}
      lineWidth={WIDTH_PX}
      transparent
      blending={THREE.NormalBlending}
      depthWrite={false}
      // above the racing line's glow passes (1 and 2), so the trail reads as being on top of the
      // map rather than tangled into it
      renderOrder={3}
      toneMapped={false}
    />
  );
}
