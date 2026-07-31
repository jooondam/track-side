// the race-engineer chart: v(s) in km/h, phase-coloured, with the car's live position as a
// cursor. Hover inspects (shares the same probe as the 3D line); click/drag scrubs the car.
// Static polyline is drawn to an offscreen canvas only when the result changes; the visible
// canvas composites polyline + cursor per frame from the shared ref -- zero React re-renders.

import { useEffect, useRef } from "react";
import type { LineData } from "../assets";
import type { LapProgress } from "../render/CarMarker";
import type { VelocityProfileResult } from "../solver/velocity";
import { PHASE_ACCEL, PHASE_BRAKE } from "../solver/velocity";

const PHASE_STROKES: Record<number, string> = {
  [PHASE_ACCEL]: "#2ba22b",
  [PHASE_BRAKE]: "#d62728",
};
const COAST_STROKE = "#71717c";

interface SpeedTraceProps {
  line: LineData;
  result: VelocityProfileResult;
  progressRef: React.MutableRefObject<LapProgress>;
  onHoverIndex: (index: number | null) => void;
  onScrubStart: () => void;
}

export function SpeedTrace({ line, result, progressRef, onHoverIndex, onScrubStart }: SpeedTraceProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const staticRef = useRef<HTMLCanvasElement | null>(null);
  const dragging = useRef(false);

  // redraw the static phase-coloured trace only when the solve changes
  useEffect(() => {
    const w = 640;
    const h = 110;
    if (!staticRef.current) {
      staticRef.current = document.createElement("canvas");
      staticRef.current.width = w;
      staticRef.current.height = h;
    }
    const ctx = staticRef.current.getContext("2d");
    if (!ctx) return;

    let vMax = 0;
    for (let i = 0; i < line.nPoints; i++) vMax = Math.max(vMax, result.vMps[i]);
    const vMaxKmh = vMax * 3.6;

    const xAt = (i: number) => (line.sM[i] / line.loopLengthM) * (w - 44) + 40;
    const yAt = (v: number) => h - 16 - ((v * 3.6) / vMaxKmh) * (h - 30);

    ctx.clearRect(0, 0, w, h);
    ctx.strokeStyle = "#22222e";
    ctx.lineWidth = 0.5;
    for (const frac of [0.25, 0.5, 0.75, 1.0]) {
      const y = h - 16 - frac * (h - 30);
      ctx.beginPath();
      ctx.moveTo(40, y);
      ctx.lineTo(w - 4, y);
      ctx.stroke();
      ctx.fillStyle = "#6a6a78";
      ctx.font = "9px monospace";
      ctx.fillText(`${Math.round(frac * vMaxKmh)}`, 4, y + 3);
    }

    // phase-coloured segments: stroke path per contiguous phase run
    ctx.lineWidth = 1.6;
    let runStart = 0;
    for (let i = 1; i <= line.nPoints; i++) {
      const ended = i === line.nPoints || result.phase[i] !== result.phase[runStart];
      if (!ended) continue;
      ctx.strokeStyle = PHASE_STROKES[result.phase[runStart]] ?? COAST_STROKE;
      ctx.beginPath();
      for (let j = Math.max(runStart - 1, 0); j < i; j++) {
        const x = xAt(j);
        const y = yAt(result.vMps[j]);
        if (j === Math.max(runStart - 1, 0)) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
      runStart = i;
    }
    ctx.fillStyle = "#6a6a78";
    ctx.font = "9px monospace";
    ctx.fillText("v(s) km/h", w - 64, 10);
  }, [line, result]);

  // per-frame compositor: static trace + car cursor
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const w = canvas.width;
    const h = canvas.height;

    let raf = 0;
    const draw = () => {
      ctx.clearRect(0, 0, w, h);
      if (staticRef.current) ctx.drawImage(staticRef.current, 0, 0);
      const frac = progressRef.current.sM / line.loopLengthM;
      const x = frac * (w - 44) + 40;
      ctx.strokeStyle = "#00e5ff";
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(x, 4);
      ctx.lineTo(x, h - 14);
      ctx.stroke();
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);

    const indexAt = (clientX: number) => {
      const rect = canvas.getBoundingClientRect();
      const frac = Math.min(Math.max((clientX - rect.left - 40 * (rect.width / w)) / ((rect.width * (w - 44)) / w), 0), 1);
      // sM is uniform enough that a proportional index is exact to +/-1
      return Math.min(Math.round(frac * (line.nPoints - 1)), line.nPoints - 1);
    };
    const scrub = (clientX: number) => {
      const i = indexAt(clientX);
      const p = progressRef.current;
      p.scrub = { id: (p.scrub?.id ?? 0) + 1, s: line.sM[i] };
    };
    const down = (e: PointerEvent) => {
      dragging.current = true;
      onScrubStart();
      scrub(e.clientX);
      canvas.setPointerCapture(e.pointerId);
    };
    const move = (e: PointerEvent) => {
      onHoverIndex(indexAt(e.clientX));
      if (dragging.current) scrub(e.clientX);
    };
    const up = () => {
      dragging.current = false;
    };
    const out = () => onHoverIndex(null);
    canvas.addEventListener("pointerdown", down);
    canvas.addEventListener("pointermove", move);
    canvas.addEventListener("pointerup", up);
    canvas.addEventListener("pointerout", out);
    return () => {
      cancelAnimationFrame(raf);
      canvas.removeEventListener("pointerdown", down);
      canvas.removeEventListener("pointermove", move);
      canvas.removeEventListener("pointerup", up);
      canvas.removeEventListener("pointerout", out);
    };
  }, [line, progressRef, onHoverIndex, onScrubStart]);

  return <canvas ref={canvasRef} width={640} height={110} style={{ display: "block" }} />;
}
