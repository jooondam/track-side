// cumulative time delta against the ghost, plotted along the lap.
//
// The ghost has been in this tool since the grip slider was, and until now the only thing it
// produced was a second lap time in the corner of the panel. That answers "how much" and nothing
// else. A delta trace answers *where*, which is the question that changes what you do: two
// setups a second apart because of one slow corner and two setups a second apart spread evenly
// over the lap are completely different problems.
//
// How to read it, since the sign convention is the one thing people get backwards: the curve is
// ghost time minus car time at the same arc length, so
//
//   rising    the car is gaining on the ghost through here
//   falling   the car is losing
//   the end   the lap time difference, which is the number in the panel
//
// Slope is what matters, not height. Height is only the accumulated history of the slope, so a
// trace that sits high and flat means "gained it earlier, level here", not "fast here".
//
// The delta is built against **arc length, not time**, which is the only comparison that means
// anything: comparing two cars at the same instant compares different pieces of road.

import { useEffect, useMemo, useRef } from "react";
import { fracAtClientX, plotRect, prepareCanvas } from "./canvasUtils";
import { useThemeTokens } from "./theme";
import type { LineData } from "../assets";
import type { LapProgress } from "../render/CarMarker";
import type { LapTimeTable } from "../solver/lapTime";

interface DeltaTraceProps {
  line: LineData;
  table: LapTimeTable;
  ghostTable: LapTimeTable | null;
  width: number;
  height?: number;
  progressRef: React.MutableRefObject<LapProgress>;
  onScrubStart: () => void;
}

const PAD = { l: 46, r: 10, t: 14, b: 10 };

export function DeltaTrace({
  line,
  table,
  ghostTable,
  width,
  height = 64,
  progressRef,
  onScrubStart,
}: DeltaTraceProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragging = useRef(false);
  const tokens = useThemeTokens();

  const { delta, span } = useMemo(() => {
    if (!ghostTable) return { delta: null, span: 1 };
    const d = new Float64Array(line.nPoints);
    let peak = 0;
    for (let i = 0; i < line.nPoints; i++) {
      d[i] = ghostTable.cumTimeS[i] - table.cumTimeS[i];
      peak = Math.max(peak, Math.abs(d[i]));
    }
    // symmetric about zero so the zero line stays in the middle and the sign is readable at a
    // glance. A floor keeps a near-identical pair from being drawn as amplified noise.
    return { delta: d, span: Math.max(peak * 1.15, 0.05) };
  }, [line, table, ghostTable]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = prepareCanvas(canvas, width, height);
    if (!ctx) return;
    const r = plotRect(width, height, PAD);

    const xAt = (s: number) => r.left + (s / line.loopLengthM) * r.width;
    const yAt = (d: number) => r.top + r.height / 2 - (d / span) * (r.height / 2);

    let raf = 0;
    const draw = () => {
      ctx.clearRect(0, 0, width, height);

      ctx.fillStyle = tokens.textDim;
      ctx.font = "10px ui-sans-serif, system-ui, sans-serif";
      ctx.textAlign = "left";
      ctx.fillText("delta to ghost", r.left, 10);

      if (!delta) {
        ctx.fillStyle = tokens.textDim;
        ctx.textAlign = "center";
        ctx.fillText("turn the ghost on to compare", r.left + r.width / 2, r.top + r.height / 2 + 3);
        raf = requestAnimationFrame(draw);
        return;
      }

      // zero line: the reference the whole chart is read against, so it is drawn first and stays
      // visible under the trace
      ctx.strokeStyle = tokens.lineStrong;
      ctx.setLineDash([2, 3]);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(r.left, yAt(0) + 0.5);
      ctx.lineTo(r.left + r.width, yAt(0) + 0.5);
      ctx.stroke();
      ctx.setLineDash([]);

      // filled to zero and split at the crossing, so gaining and losing are different colours
      // rather than the reader having to track which side of the line they are on
      for (const [sign, colour] of [
        [1, tokens.pos],
        [-1, tokens.neg],
      ] as const) {
        ctx.beginPath();
        ctx.moveTo(xAt(0), yAt(0));
        for (let i = 0; i < line.nPoints; i++) {
          const d = Math.sign(delta[i]) === sign ? delta[i] : 0;
          ctx.lineTo(xAt(line.sM[i]), yAt(d));
        }
        ctx.lineTo(xAt(line.loopLengthM), yAt(0));
        ctx.closePath();
        ctx.globalAlpha = 0.32;
        ctx.fillStyle = colour;
        ctx.fill();
        ctx.globalAlpha = 1;
      }

      ctx.beginPath();
      for (let i = 0; i < line.nPoints; i++) {
        const x = xAt(line.sM[i]);
        const y = yAt(delta[i]);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = tokens.text;
      ctx.lineWidth = 1.25;
      ctx.stroke();

      const frac = Math.min(Math.max(progressRef.current.sM / line.loopLengthM, 0), 1);
      const x = r.left + frac * r.width;
      ctx.strokeStyle = tokens.accent;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x + 0.5, r.top - 2);
      ctx.lineTo(x + 0.5, r.top + r.height);
      ctx.stroke();

      // the delta under the cursor, which is the number the trace exists to produce
      const i = Math.min(Math.round(frac * (line.nPoints - 1)), line.nPoints - 1);
      const here = delta[i];
      ctx.fillStyle = here >= 0 ? tokens.pos : tokens.neg;
      ctx.font = "10px ui-monospace, monospace";
      ctx.textAlign = "right";
      ctx.fillText(`${here >= 0 ? "+" : ""}${here.toFixed(2)} s`, r.left + r.width, 10);

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);

    const scrub = (clientX: number) => {
      const f = fracAtClientX(canvas, clientX, r);
      const p = progressRef.current;
      p.scrub = { id: (p.scrub?.id ?? 0) + 1, s: Math.min(f, 0.9999) * line.loopLengthM };
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
  }, [line, table, delta, span, width, height, tokens, progressRef, onScrubStart]);

  return (
    <canvas
      ref={canvasRef}
      role="img"
      aria-label={
        delta
          ? "Cumulative time delta to the ghost car around the lap. Rising means the car is gaining."
          : "Delta to ghost, unavailable until the ghost car is enabled."
      }
      style={{ display: "block", cursor: "ew-resize", touchAction: "none" }}
    />
  );
}
