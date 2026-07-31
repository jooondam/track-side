// legend for what the line colours mean. Phase mode: labelled swatches. Speed mode: the
// exact viridis ramp the 3D line uses, with live km/h ticks -- the mapping is normalised to
// the current solve's min/max, so the legend has to be too.

import { useMemo } from "react";
import type { ColorMode } from "../render/RacingLine";
import { viridis } from "../render/RacingLine";
import type { VelocityProfileResult } from "../solver/velocity";

interface ColorLegendProps {
  colorMode: ColorMode;
  result: VelocityProfileResult;
}

const boxStyle: React.CSSProperties = {
  position: "absolute",
  right: 12,
  bottom: 12,
  padding: "8px 12px",
  background: "rgba(10, 10, 15, 0.85)",
  border: "1px solid #22222e",
  borderRadius: 6,
  fontSize: 11,
  userSelect: "none",
};

function Swatch({ color, label }: { color: string; label: string }) {
  return (
    <span style={{ marginRight: 10 }}>
      <span
        style={{
          display: "inline-block",
          width: 10,
          height: 10,
          background: color,
          borderRadius: 2,
          marginRight: 5,
          verticalAlign: "-1px",
        }}
      />
      {label}
    </span>
  );
}

export function ColorLegend({ colorMode, result }: ColorLegendProps) {
  const { vMinKmh, vMaxKmh, gradient } = useMemo(() => {
    let vMin = Infinity;
    let vMax = -Infinity;
    for (let i = 0; i < result.vMps.length; i++) {
      vMin = Math.min(vMin, result.vMps[i]);
      vMax = Math.max(vMax, result.vMps[i]);
    }
    const stops: string[] = [];
    const rgb: [number, number, number] = [0, 0, 0];
    for (let i = 0; i <= 10; i++) {
      viridis(i / 10, rgb);
      stops.push(
        `rgb(${Math.round(rgb[0] * 255)},${Math.round(rgb[1] * 255)},${Math.round(rgb[2] * 255)}) ${i * 10}%`,
      );
    }
    return {
      vMinKmh: Math.round(vMin * 3.6),
      vMaxKmh: Math.round(vMax * 3.6),
      gradient: `linear-gradient(90deg, ${stops.join(", ")})`,
    };
  }, [result]);

  if (colorMode === "phase") {
    return (
      <div style={boxStyle}>
        <Swatch color="#2ba22b" label="accel" />
        <Swatch color="#d62728" label="brake" />
        <Swatch color="#8a8a94" label="coast" />
      </div>
    );
  }

  return (
    <div style={boxStyle}>
      <div style={{ width: 180, height: 10, background: gradient, borderRadius: 2 }} />
      <div style={{ display: "flex", justifyContent: "space-between", color: "#9a9aa8" }}>
        <span>{vMinKmh}</span>
        <span>{Math.round((vMinKmh + vMaxKmh) / 2)}</span>
        <span>{vMaxKmh} km/h</span>
      </div>
    </div>
  );
}
