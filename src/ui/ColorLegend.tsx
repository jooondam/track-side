// what the line colours mean. Phase mode: labelled swatches, because colour alone fails the 8%
// of men with red-green colour vision deficiency and the label is the fallback channel. Speed
// mode: the exact viridis ramp the 3D line uses, with live km/h ticks, since the mapping is
// normalised to the current solve's min and max and the legend has to be too.

import { useMemo } from "react";
import { Panel } from "./primitives";
import { useIsNarrow, useThemeTokens, TYPE } from "./theme";
import type { ColorMode } from "../render/RacingLine";
import { viridis } from "../render/RacingLine";
import type { VelocityProfileResult } from "../solver/velocity";

interface ColorLegendProps {
  colorMode: ColorMode;
  result: VelocityProfileResult;
}

function Swatch({ color, label }: { color: string; label: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
      <span
        style={{
          width: 12,
          height: 3,
          background: color,
          borderRadius: 1,
        }}
      />
      <span style={{ fontSize: TYPE.size.label, color: "var(--text-muted)" }}>{label}</span>
    </span>
  );
}

export function ColorLegend({ colorMode, result }: ColorLegendProps) {
  const tokens = useThemeTokens();
  const narrow = useIsNarrow();

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
    // a degenerate solve (every sample the same speed) must not render "NaN km/h"
    const finite = Number.isFinite(vMin) && Number.isFinite(vMax);
    return {
      vMinKmh: finite ? Math.round(vMin * 3.6) : 0,
      vMaxKmh: finite ? Math.round(vMax * 3.6) : 0,
      gradient: `linear-gradient(90deg, ${stops.join(", ")})`,
    };
  }, [result]);

  return (
    <Panel
      style={{
        position: "absolute",
        // on a phone the top strip is already spoken for by the viewpoint pill
        right: "var(--s3)",
        ...(narrow ? { bottom: "var(--s3)" } : { top: "var(--s3)" }),
        padding: "var(--s2) var(--s3)",
        userSelect: "none",
      }}
    >
      {colorMode === "phase" ? (
        <div style={{ display: "flex", gap: "var(--s3)" }}>
          <Swatch color={tokens.phaseAccel} label="accelerating" />
          <Swatch color={tokens.phaseBrake} label="braking" />
          <Swatch color={tokens.phaseCoast} label="holding" />
        </div>
      ) : (
        <div>
          <div style={{ width: 168, height: 8, background: gradient, borderRadius: 1 }} />
          <div
            className="tnum"
            style={{
              display: "flex",
              justifyContent: "space-between",
              fontSize: TYPE.size.label,
              color: "var(--text-dim)",
              marginTop: 2,
            }}
          >
            <span>{vMinKmh}</span>
            <span>{Math.round((vMinKmh + vMaxKmh) / 2)}</span>
            <span>{vMaxKmh} km/h</span>
          </div>
        </div>
      )}
    </Panel>
  );
}
