// the gap between the car and its ghost, drawn along the road and labelled.
//
// The gap has always been the point of the ghost: "the visual gap between ghost and live car is
// the grip story told physically". What it never had was a number, so it read as an atmosphere
// rather than as an instrument, and a reader could see that the ghost was up the road without
// being able to say by how much.
//
// **Two quantities, and they are not the same one.** The interface's whole delta convention is
// distance-aligned, because comparing two cars at the same instant compares different pieces of
// road (see DeltaTrace's header). So:
//
//   - the seconds are `liveDeltaToGhost`, the delta at the car's own arc length. This is the same
//     number the rail and the dock strip print, from the same helper, deliberately: the last time
//     one comparison was written out at several sites they disagreed in sign.
//   - the metres are `gapMetres`, the on-track separation right now, which *is* time-aligned.
//
// They are labelled apart for that reason. A reader who takes them as two opinions on one number
// will conclude the instrument is broken, and be right to.
//
// The leader follows the racing line rather than cutting across it, because the two cars are on
// the same path: the line is grip-invariant by design and nothing here may imply two of them.

import { Line } from "@react-three/drei";
import { Html } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useMemo, useRef, useState } from "react";
import * as THREE from "three";
import type { LineData } from "../assets";
import {
  gapMetres,
  liveDeltaToGhost,
  lowerIndex,
  sAtTime,
  type LapTimeTable,
} from "../solver/lapTime";
import { MATERIAL, useThemeTokens } from "../ui/theme";
import type { LapProgress } from "./CarMarker";

// the leader is resampled every frame, so it is a fixed vertex budget rather than one point per
// metre: at Spa the gap can be several hundred metres and a per-point line would rebuild a few
// thousand vertices a frame for a decoration.
const SEGMENTS = 48;
const LIFT_M = 0.6; // clear of the road surface, just above the racing line's own lift

/** shortest signed way from a to b around a loop, in metres. */
function forwardSpan(from: number, to: number, loop: number): number {
  return ((to - from) % loop + loop) % loop;
}

export function GhostTether({
  line,
  table,
  ghostTable,
  progressRef,
  exaggeration,
}: {
  line: LineData;
  table: LapTimeTable;
  ghostTable: LapTimeTable;
  progressRef: React.MutableRefObject<LapProgress>;
  exaggeration: number;
}) {
  const tokens = useThemeTokens();
  const lineRef = useRef<any>(null);
  const [label, setLabel] = useState({ deltaS: 0, metres: 0, x: 0, y: 0, z: 0 });

  const points = useMemo(
    () => Array.from({ length: SEGMENTS + 1 }, () => new THREE.Vector3()),
    [],
  );

  useFrame(() => {
    const t = progressRef.current.lapTS;
    const loop = line.loopLengthM;
    const carS = sAtTime(table, line.sM, t);
    const ghostS = sAtTime(ghostTable, line.sM, t);

    // walk forward from whichever car is behind, so the leader lies on the road between them
    // rather than the long way round the circuit
    const metres = gapMetres(carS, ghostS, loop);
    const from = metres >= 0 ? carS : ghostS;
    const span = forwardSpan(from, metres >= 0 ? ghostS : carS, loop);

    for (let i = 0; i <= SEGMENTS; i++) {
      const s = (from + (span * i) / SEGMENTS) % loop;
      const lo = lowerIndex(line.sM, s);
      const hi = Math.min(lo + 1, line.nPoints - 1);
      const f = (s - line.sM[lo]) / Math.max(line.sM[hi] - line.sM[lo], 1e-9);
      const x = line.positionYup[3 * lo] + f * (line.positionYup[3 * hi] - line.positionYup[3 * lo]);
      const y =
        line.positionYup[3 * lo + 1] +
        f * (line.positionYup[3 * hi + 1] - line.positionYup[3 * lo + 1]);
      const z =
        line.positionYup[3 * lo + 2] +
        f * (line.positionYup[3 * hi + 2] - line.positionYup[3 * lo + 2]);
      points[i].set(x, y * exaggeration + LIFT_M, z);
    }
    lineRef.current?.geometry.setPositions(
      points.flatMap((p) => [p.x, p.y, p.z]) as unknown as number[],
    );

    const mid = points[SEGMENTS >> 1];
    const deltaS = liveDeltaToGhost(table, ghostTable, line.sM, carS);
    // React state at 60 Hz would be a re-render a frame. The label only has to change when the
    // rounded text does, which at two decimals is a few times a second at most.
    setLabel((prev) =>
      prev.deltaS.toFixed(2) === deltaS.toFixed(2) && prev.metres.toFixed(0) === metres.toFixed(0)
        ? prev
        : { deltaS, metres, x: mid.x, y: mid.y, z: mid.z },
    );
  });

  const sign = label.deltaS <= 0 ? tokens.pos : tokens.neg;

  return (
    <group>
      <Line
        ref={lineRef}
        points={points}
        color={MATERIAL.ghost}
        lineWidth={1.4}
        dashed
        dashSize={14}
        gapSize={10}
        transparent
        opacity={0.75}
        depthWrite={false}
        toneMapped={false}
      />
      <Html position={[label.x, label.y, label.z]} center zIndexRange={[20, 0]} pointerEvents="none">
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            gap: 6,
            padding: "2px 6px",
            background: "var(--panel-raised)",
            border: "1px solid var(--line)",
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            whiteSpace: "nowrap",
            transform: "translateY(-14px)",
          }}
        >
          {/* seconds first, because that is the interface's unit for this comparison */}
          <span style={{ color: sign, fontWeight: 600 }}>
            {label.deltaS > 0 ? "+" : label.deltaS < 0 ? "−" : ""}
            {Math.abs(label.deltaS).toFixed(2)} s
          </span>
          {/* and the separation, named as a separate quantity rather than as a second opinion */}
          <span style={{ color: "var(--text-muted)" }}>{Math.abs(label.metres).toFixed(0)} m apart</span>
        </div>
      </Html>
    </group>
  );
}
