// z(s) as a filled area, cursor synced to the car. Ties the 3D view back to the M5 elevation
// deliverable: the fill uses the same low-to-high ramp as the terrain dot field, so the chart and
// the landscape describe the same thing in the same colours.
//
// Draws in its own rAF loop reading the shared mutable progress ref, so the 60 Hz cursor costs
// zero React re-renders. Click and drag scrubs, same as the speed trace above it.

import { useEffect, useMemo, useRef } from "react";
import { drawChannel, fracAtClientX, plotRect, prepareCanvas } from "./canvasUtils";
import { FONT, TYPE, useThemeTokens } from "./theme";
import type { LineData } from "../assets";
import type { LapProgress } from "../render/CarMarker";

interface ElevationStripProps {
  line: LineData;
  width: number;
  height?: number;
  progressRef: React.MutableRefObject<LapProgress>;
  onScrubStart: () => void;
}

const PAD = { l: 46, r: 10, t: 14, b: 10 };

export function ElevationStrip({
  line,
  width,
  height = 64,
  progressRef,
  onScrubStart,
}: ElevationStripProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragging = useRef(false);
  const tokens = useThemeTokens();

  const { zMin, zSpan } = useMemo(() => {
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < line.nPoints; i++) {
      const z = line.positionYup[3 * i + 1];
      lo = Math.min(lo, z);
      hi = Math.max(hi, z);
    }
    return { zMin: lo, zSpan: Math.max(hi - lo, 1e-9) };
  }, [line]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = prepareCanvas(canvas, width, height);
    if (!ctx) return;
    const r = plotRect(width, height, PAD);

    const xAt = (s: number) => r.left + (s / line.loopLengthM) * r.width;
    const yAt = (z: number) => r.top + r.height - ((z - zMin) / zSpan) * r.height;

    const fill = ctx.createLinearGradient(0, r.top, 0, r.top + r.height);
    fill.addColorStop(0, tokens.terrainHi);
    fill.addColorStop(1, tokens.terrainLo);

    let raf = 0;
    const draw = () => {
      ctx.clearRect(0, 0, width, height);

      // filled profile
      ctx.beginPath();
      ctx.moveTo(r.left, r.top + r.height);
      for (let i = 0; i < line.nPoints; i++) {
        ctx.lineTo(xAt(line.sM[i]), yAt(line.positionYup[3 * i + 1]));
      }
      ctx.lineTo(r.left + r.width, r.top + r.height);
      ctx.closePath();
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.strokeStyle = tokens.lineStrong;
      ctx.lineWidth = 1;
      ctx.stroke();

      const frac = Math.min(Math.max(progressRef.current.sM / line.loopLengthM, 0), 1);
      const x = r.left + frac * r.width;
      // the elevation under the car, which is what this chart is for and what it never said
      const zAtCursor =
        line.positionYup[3 * Math.min(Math.round(frac * (line.nPoints - 1)), line.nPoints - 1) + 1];
      ctx.strokeStyle = tokens.accent;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x + 0.5, r.top - 2);
      ctx.lineTo(x + 0.5, r.top + r.height);
      ctx.stroke();

      // the gutter, which used to be 46px of nothing on this chart in particular
      drawChannel(ctx, {
        name: "elevation",
        value: zAtCursor.toFixed(0),
        unit: "m",
        x: r.left,
        baseline: 10,
        nameColor: tokens.textDim,
        valueColor: tokens.textMuted,
      });
      ctx.fillStyle = tokens.textDim;
      ctx.font = `${TYPE.size.label}px ${FONT.display}`;
      ctx.textAlign = "right";
      ctx.fillText(`${zSpan.toFixed(0)} m range`, r.left + r.width, 10);

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);

    const scrub = (clientX: number) => {
      const f = fracAtClientX(canvas, clientX, r);
      const p = progressRef.current;
      p.scrub = { s: Math.min(f, 0.9999) * line.loopLengthM };
    };
    const down = (e: PointerEvent) => {
      dragging.current = true;
      onScrubStart();
      scrub(e.clientX);
      canvas.setPointerCapture(e.pointerId);
    };
    const move = (e: PointerEvent) => {
      if (dragging.current) scrub(e.clientX);
    };
    const up = (e: PointerEvent) => {
      dragging.current = false;
      if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
    };
    canvas.addEventListener("pointerdown", down);
    canvas.addEventListener("pointermove", move);
    canvas.addEventListener("pointerup", up);
    return () => {
      cancelAnimationFrame(raf);
      canvas.removeEventListener("pointerdown", down);
      canvas.removeEventListener("pointermove", move);
      canvas.removeEventListener("pointerup", up);
    };
  }, [line, width, height, tokens, zMin, zSpan, progressRef, onScrubStart]);

  return (
    <canvas
      ref={canvasRef}
      role="img"
      aria-label={`Elevation profile around the lap, total range ${zSpan.toFixed(0)} metres.`}
      style={{ display: "block", cursor: "ew-resize", touchAction: "none" }}
    />
  );
}
