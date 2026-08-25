// lap timeline: elapsed / total, draggable to put the car anywhere in the lap. The cursor moves
// in a rAF loop from the shared progress ref, so there is no React state at 60 Hz; dragging
// writes a scrub request and pauses playback through the callback.
//
// Height is 40px rather than the 26px it replaced: WCAG 2.2 target-size wants 24px minimum, and
// a scrub bar is a drag target, which deserves the 44px recommendation more than a button does.

import { useEffect, useRef } from "react";
import { fracAtClientX, plotRect, prepareCanvas } from "./canvasUtils";
import { MATERIAL, useThemeTokens } from "./theme";
import type { LapProgress } from "../render/CarMarker";
import type { LapTimeTable } from "../solver/lapTime";
import { sAtTime } from "../solver/lapTime";

interface TimelineProps {
  sM: Float64Array;
  table: LapTimeTable;
  /** the ghost's own table, when it is running. The scrubber is the one instrument that is about
   *  time rather than distance, so it is the right place to show that the ghost is on a shorter
   *  lap: its marker reaches the end of the bar before the car's does. */
  ghostTable?: LapTimeTable | null;
  width: number;
  height?: number;
  progressRef: React.MutableRefObject<LapProgress>;
  onScrubStart: () => void;
}

const PAD = { l: 46, r: 10, t: 18, b: 8 };

function mmss(t: number): string {
  return `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, "0")}`;
}

export function Timeline({
  sM,
  table,
  ghostTable,
  width,
  height = 40,
  progressRef,
  onScrubStart,
}: TimelineProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragging = useRef(false);
  const tokens = useThemeTokens();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = prepareCanvas(canvas, width, height);
    if (!ctx) return;
    const r = plotRect(width, height, PAD);
    const barY = r.top + r.height / 2;

    let raf = 0;
    const draw = () => {
      const p = progressRef.current;
      const frac = table.lapTimeS > 0 ? Math.min(Math.max(p.tS / table.lapTimeS, 0), 1) : 0;

      ctx.clearRect(0, 0, width, height);

      ctx.fillStyle = tokens.line;
      ctx.fillRect(r.left, barY - 2, r.width, 4);
      ctx.fillStyle = tokens.accentDim;
      ctx.fillRect(r.left, barY - 2, frac * r.width, 4);

      // the ghost first, so the live cursor draws over it and the drag target is never obscured
      if (ghostTable && ghostTable.lapTimeS > 0) {
        const gFrac = ((p.lapTS % ghostTable.lapTimeS) + ghostTable.lapTimeS) % ghostTable.lapTimeS;
        const gx = r.left + (gFrac / ghostTable.lapTimeS) * r.width;
        ctx.fillStyle = MATERIAL.ghost;
        ctx.fillRect(gx - 1, barY - 6, 2, 12);
      }

      const x = r.left + frac * r.width;
      ctx.fillStyle = tokens.accent;
      ctx.fillRect(x - 1.5, barY - 8, 3, 16);

      ctx.fillStyle = tokens.textDim;
      ctx.font = '10px ui-sans-serif, system-ui, sans-serif';
      ctx.textAlign = "left";
      ctx.fillText("lap position", r.left, 10);
      ctx.font = '11px ui-monospace, "SF Mono", Menlo, monospace';
      ctx.textAlign = "right";
      ctx.fillStyle = tokens.textMuted;
      ctx.fillText(`${mmss(p.tS)} / ${mmss(table.lapTimeS)}`, r.left + r.width, 10);

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);

    const scrubAt = (clientX: number) => {
      const frac = Math.min(fracAtClientX(canvas, clientX, r), 0.9999);
      const p = progressRef.current;
      p.scrub = { s: sAtTime(table, sM, frac * table.lapTimeS) };
      p.tS = frac * table.lapTimeS;
    };
    const down = (e: PointerEvent) => {
      dragging.current = true;
      onScrubStart();
      scrubAt(e.clientX);
      canvas.setPointerCapture(e.pointerId);
    };
    const move = (e: PointerEvent) => {
      if (dragging.current) scrubAt(e.clientX);
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
  }, [sM, table, ghostTable, width, height, tokens, progressRef, onScrubStart]);

  return (
    <canvas
      ref={canvasRef}
      role="img"
      aria-label={`Lap position scrubber, lap length ${mmss(table.lapTimeS)}.`}
      style={{ display: "block", cursor: "ew-resize", touchAction: "none" }}
    />
  );
}
