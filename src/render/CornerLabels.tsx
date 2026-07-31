// floating corner-name labels placed by arc length: DESIGN_NOTES section 4 point 7's
// "visual credibility" item: named corners are what separate a circuit from a grey ribbon.

import { Html } from "@react-three/drei";
import { useMemo } from "react";
import type { LineData } from "../assets";
import type { CornerLabel } from "../tracks";

interface CornerLabelsProps {
  line: LineData;
  corners: CornerLabel[];
  exaggeration: number;
}

export function CornerLabels({ line, corners, exaggeration }: CornerLabelsProps) {
  const placed = useMemo(
    () =>
      corners.map((corner) => {
        let lo = 0;
        let hi = line.nPoints - 1;
        while (hi - lo > 1) {
          const mid = (lo + hi) >> 1;
          if (line.sM[mid] <= corner.sM) lo = mid;
          else hi = mid;
        }
        return {
          name: corner.name,
          x: line.positionYup[3 * lo],
          y: line.positionYup[3 * lo + 1],
          z: line.positionYup[3 * lo + 2],
        };
      }),
    [line, corners],
  );

  return (
    <>
      {placed.map((label) => (
        <Html
          key={label.name}
          position={[label.x, label.y * exaggeration + 14, label.z]}
          center
          distanceFactor={420}
          style={{
            color: "#3c3f46",
            fontSize: "13px",
            fontFamily: "inherit",
            whiteSpace: "nowrap",
            pointerEvents: "none",
            textShadow: "0 0 6px #fff",
          }}
        >
          {label.name}
        </Html>
      ))}
    </>
  );
}
