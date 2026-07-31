// mini z(s) sparkline pinned to the bottom edge, cursor synced to the car marker -- ties the
// 3D view back to the M5 elevation deliverable. Draws in its own rAF loop reading the shared
// mutable progress ref, so the 60 Hz cursor costs zero React re-renders.

import { useEffect, useRef } from "react";
import type { LineData } from "../assets";

interface ElevationStripProps {
  line: LineData;
  progressRef: React.MutableRefObject<{ sM: number; vMps: number }>;
}

export function ElevationStrip({ line, progressRef }: ElevationStripProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

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
    const yAt = (z: number) => h - 6 - ((z - zMin) / zSpan) * (h - 14);

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
      ctx.fillText(`z range ${(zSpan).toFixed(0)} m`, 6, 10);

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [line, progressRef]);

  return (
    <canvas
      ref={canvasRef}
      width={420}
      height={54}
      style={{
        position: "absolute",
        bottom: 12,
        left: "50%",
        transform: "translateX(-50%)",
        background: "rgba(10, 10, 15, 0.75)",
        border: "1px solid #22222e",
        borderRadius: 4,
      }}
    />
  );
}
