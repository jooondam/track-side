// mini z(s) sparkline, cursor synced to the car marker -- ties the 3D view back to the M5
// elevation deliverable. Draws in its own rAF loop reading the shared mutable progress ref,
// so the 60 Hz cursor costs zero React re-renders. Click/drag scrubs the car, same as the
// speed trace above it. Positioned by the parent (stacked bottom panel), not self-positioned.

import { useEffect, useRef } from "react";
import type { LineData } from "../assets";
import type { LapProgress } from "../render/CarMarker";

interface ElevationStripProps {
  line: LineData;
  progressRef: React.MutableRefObject<LapProgress>;
  onScrubStart: () => void;
}

export function ElevationStrip({ line, progressRef, onScrubStart }: ElevationStripProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragging = useRef(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;

    let zMin = Infinity;
    let zMax = -Infinity;
    for (let i = 0; i < line.nPoints; i++) {
      zMin = Math.min(zMin, line.positionYup[3 * i + 1]);
      zMax = Math.max(zMax, line.positionYup[3 * i + 1]);
    }
    const zSpan = Math.max(zMax - zMin, 1e-9);
    const loop = line.loopLengthM;

    const xAt = (s: number) => (s / loop) * (w - 8) + 4;
    const yAt = (z: number) => h - 6 - ((z - zMin) / zSpan) * (h - 16);

    let raf = 0;
    const draw = () => {
      ctx.clearRect(0, 0, w, h);

      ctx.strokeStyle = "#3a3a4a";
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      for (let i = 0; i < line.nPoints; i++) {
        const x = xAt(line.sM[i]);
        const y = yAt(line.positionYup[3 * i + 1]);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();

      const s = progressRef.current.sM;
      ctx.strokeStyle = "#00e5ff";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(xAt(s), 2);
      ctx.lineTo(xAt(s), h - 2);
      ctx.stroke();

      ctx.fillStyle = "#6a6a78";
      ctx.font = "9px monospace";
      ctx.fillText(`elevation, range ${zSpan.toFixed(0)} m`, 6, 10);

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);

    const scrub = (clientX: number) => {
      const rect = canvas.getBoundingClientRect();
      const frac = Math.min(Math.max((clientX - rect.left) / rect.width, 0), 0.9999);
      const p = progressRef.current;
      p.scrub = { id: (p.scrub?.id ?? 0) + 1, s: frac * loop };
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
  }, [line, progressRef, onScrubStart]);

  return (
    <canvas
      ref={canvasRef}
      width={640}
      height={44}
      style={{ display: "block", cursor: "ew-resize" }}
    />
  );
}
