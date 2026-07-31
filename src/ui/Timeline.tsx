// lap timeline: current time / lap time, draggable to scrub the car anywhere in the lap.
// cursor position updates in a rAF loop from the shared progress ref (no React state at
// 60 Hz); dragging writes a scrub request and pauses playback via the callback.

import { useEffect, useRef } from "react";
import type { LapProgress } from "../render/CarMarker";
import type { LapTimeTable } from "../solver/lapTime";
import { sAtTime } from "../solver/lapTime";

interface TimelineProps {
  sM: Float64Array;
  table: LapTimeTable;
  progressRef: React.MutableRefObject<LapProgress>;
  onScrubStart: () => void;
}

export function Timeline({ sM, table, progressRef, onScrubStart }: TimelineProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragging = useRef(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const w = canvas.width;
    const h = canvas.height;

    let raf = 0;
    const draw = () => {
      const p = progressRef.current;
      const frac = table.lapTimeS > 0 ? p.tS / table.lapTimeS : 0;

      ctx.clearRect(0, 0, w, h);
      // bar
      ctx.fillStyle = "#16161e";
      ctx.fillRect(0, h / 2 - 3, w, 6);
      ctx.fillStyle = "#0e3a42";
      ctx.fillRect(0, h / 2 - 3, frac * w, 6);
      // cursor
      ctx.fillStyle = "#00e5ff";
      ctx.fillRect(frac * w - 1.5, h / 2 - 8, 3, 16);
      // time text
      ctx.fillStyle = "#9a9aa8";
      ctx.font = "10px monospace";
      const mm = (t: number) =>
        `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, "0")}`;
      ctx.fillText(`${mm(p.tS)} / ${mm(table.lapTimeS)}`, 4, 12);

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);

    const scrubAt = (clientX: number) => {
      const rect = canvas.getBoundingClientRect();
      const frac = Math.min(Math.max((clientX - rect.left) / rect.width, 0), 0.9999);
      const s = sAtTime(table, sM, frac * table.lapTimeS);
      const p = progressRef.current;
      p.scrub = { id: (p.scrub?.id ?? 0) + 1, s };
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
    const up = () => {
      dragging.current = false;
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
  }, [sM, table, progressRef, onScrubStart]);

  return (
    <canvas
      ref={canvasRef}
      width={640}
      height={26}
      style={{ display: "block", cursor: "ew-resize" }}
    />
  );
}
