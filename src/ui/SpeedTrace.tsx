// the race-engineer chart: v(s) in km/h, phase-coloured, with the car's live position as a
// cursor. Hover inspects (sharing the probe readout with the 3D line), drag scrubs, and clicking
// a corner tick flies the camera to that corner, which is what ties this panel to the viewport
// instead of leaving it a decorative squiggle.
//
// Two canvases: the phase-coloured trace is drawn once per solve into an offscreen buffer, and
// the visible canvas composites buffer + cursor per frame from the shared ref. Zero React
// re-renders at 60 Hz.

import { useEffect, useMemo, useRef } from "react";
import { fracAtClientX, plotRect, prepareCanvas } from "./canvasUtils";
import { useThemeTokens } from "./theme";
import type { LineData } from "../assets";
import type { LapProgress } from "../render/CarMarker";
import type { VelocityProfileResult } from "../solver/velocity";
import { PHASE_ACCEL, PHASE_BRAKE } from "../solver/velocity";
import type { Corner } from "../assets";

interface SpeedTraceProps {
  line: LineData;
  result: VelocityProfileResult;
  corners: Corner[];
  width: number;
  height?: number;
  progressRef: React.MutableRefObject<LapProgress>;
  onHoverIndex: (index: number | null) => void;
  onScrubStart: () => void;
  onCornerSelect: (corner: Corner) => void;
}

export function SpeedTrace({
  line,
  result,
  corners,
  width,
  height = 132,
  progressRef,
  onHoverIndex,
  onScrubStart,
  onCornerSelect,
}: SpeedTraceProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const staticRef = useRef<HTMLCanvasElement | null>(null);
  const dragging = useRef(false);
  const hoverX = useRef<number | null>(null);
  const tokens = useThemeTokens();

  // one pass for the axis scale and the accessible description; a spread over 7000 samples would
  // work but flirts with the argument-count limit for no reason
  const vMaxKmh = useMemo(() => {
    let vMax = 0;
    for (let i = 0; i < line.nPoints; i++) vMax = Math.max(vMax, result.vMps[i]);
    return Math.max(vMax * 3.6, 1);
  }, [line, result]);

  // the static trace: redrawn only when the solve, the size or the theme changes
  useEffect(() => {
    if (!staticRef.current) staticRef.current = document.createElement("canvas");
    const ctx = prepareCanvas(staticRef.current, width, height);
    if (!ctx) return;
    const r = plotRect(width, height);

    const xAt = (s: number) => r.left + (s / line.loopLengthM) * r.width;
    const yAt = (v: number) => r.top + r.height - ((v * 3.6) / vMaxKmh) * r.height;

    ctx.clearRect(0, 0, width, height);

    // gridlines and axis labels
    ctx.font = '10px ui-monospace, "SF Mono", Menlo, monospace';
    ctx.textBaseline = "middle";
    for (const frac of [0, 0.25, 0.5, 0.75, 1]) {
      const y = r.top + r.height - frac * r.height;
      ctx.strokeStyle = tokens.line;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(r.left, y + 0.5);
      ctx.lineTo(r.left + r.width, y + 0.5);
      ctx.stroke();
      ctx.fillStyle = tokens.textDim;
      ctx.textAlign = "right";
      ctx.fillText(`${Math.round(frac * vMaxKmh)}`, r.left - 6, y);
    }

    // corner ticks along the bottom. Every corner gets a tick; a name is only drawn if it clears
    // the last one drawn, otherwise consecutive corners (Eau Rouge and Raidillon are 200 m apart
    // on a 7 km lap) overprint each other into mush.
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    let lastLabelRight = -Infinity;
    for (const c of corners) {
      const x = xAt(c.sM);
      ctx.strokeStyle = tokens.lineStrong;
      ctx.beginPath();
      ctx.moveTo(x + 0.5, r.top + r.height);
      ctx.lineTo(x + 0.5, r.top + r.height + 4);
      ctx.stroke();
      if (r.width <= 460) continue;
      ctx.font = '9px ui-sans-serif, system-ui, sans-serif';
      const short = c.name.length > 14 ? `${c.name.slice(0, 13)}…` : c.name;
      const half = ctx.measureText(short).width / 2;
      if (x - half > lastLabelRight + 6) {
        ctx.fillStyle = tokens.textDim;
        ctx.fillText(short, x, height - 4);
        lastLabelRight = x + half;
      }
      ctx.font = '10px ui-monospace, "SF Mono", Menlo, monospace';
    }

    // the trace, stroked as one path per contiguous phase run
    const strokeFor = (phase: number) =>
      phase === PHASE_ACCEL
        ? tokens.phaseAccel
        : phase === PHASE_BRAKE
          ? tokens.phaseBrake
          : tokens.phaseCoast;

    ctx.lineWidth = 1.75;
    ctx.lineJoin = "round";
    let runStart = 0;
    for (let i = 1; i <= line.nPoints; i++) {
      const ended = i === line.nPoints || result.phase[i] !== result.phase[runStart];
      if (!ended) continue;
      ctx.strokeStyle = strokeFor(result.phase[runStart]);
      ctx.beginPath();
      // start one sample early so consecutive runs share an edge and the line has no gaps
      const from = Math.max(runStart - 1, 0);
      for (let j = from; j < i; j++) {
        const x = xAt(line.sM[j]);
        const y = yAt(result.vMps[j]);
        if (j === from) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
      runStart = i;
    }

    ctx.fillStyle = tokens.textDim;
    ctx.font = '10px ui-sans-serif, system-ui, sans-serif';
    ctx.textAlign = "left";
    ctx.fillText("speed  km/h", r.left, 10);
  }, [line, result, corners, width, height, tokens, vMaxKmh]);

  // the compositor: static trace + car cursor + hover crosshair
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = prepareCanvas(canvas, width, height);
    if (!ctx) return;
    const r = plotRect(width, height);

    const indexAtFrac = (f: number) =>
      Math.min(Math.round(f * (line.nPoints - 1)), line.nPoints - 1);

    let raf = 0;
    const draw = () => {
      ctx.clearRect(0, 0, width, height);
      if (staticRef.current) {
        ctx.drawImage(staticRef.current, 0, 0, width, height);
      }

      if (hoverX.current !== null) {
        const x = r.left + hoverX.current * r.width;
        ctx.strokeStyle = tokens.lineStrong;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x + 0.5, r.top);
        ctx.lineTo(x + 0.5, r.top + r.height);
        ctx.stroke();
      }

      const frac = progressRef.current.sM / line.loopLengthM;
      const x = r.left + Math.min(Math.max(frac, 0), 1) * r.width;
      ctx.strokeStyle = tokens.accent;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x + 0.5, r.top - 4);
      ctx.lineTo(x + 0.5, r.top + r.height + 2);
      ctx.stroke();
      ctx.fillStyle = tokens.accent;
      ctx.beginPath();
      ctx.moveTo(x, r.top - 5);
      ctx.lineTo(x - 3.5, r.top - 10);
      ctx.lineTo(x + 3.5, r.top - 10);
      ctx.closePath();
      ctx.fill();

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);

    const scrubTo = (f: number) => {
      const p = progressRef.current;
      p.scrub = { s: line.sM[indexAtFrac(f)] };
    };

    const nearestCorner = (f: number): Corner | null => {
      const s = f * line.loopLengthM;
      const tolM = (14 / Math.max(r.width, 1)) * line.loopLengthM;
      let best: Corner | null = null;
      let bestD = tolM;
      for (const c of corners) {
        const d = Math.abs(c.sM - s);
        if (d < bestD) {
          bestD = d;
          best = c;
        }
      }
      return best;
    };

    const down = (e: PointerEvent) => {
      const f = fracAtClientX(canvas, e.clientX, r);
      // clicking a corner tick along the bottom gutter jumps the camera instead of scrubbing
      const box = canvas.getBoundingClientRect();
      if (e.clientY - box.top > r.top + r.height) {
        const c = nearestCorner(f);
        if (c) {
          onCornerSelect(c);
          return;
        }
      }
      dragging.current = true;
      onScrubStart();
      scrubTo(f);
      canvas.setPointerCapture(e.pointerId);
    };
    const move = (e: PointerEvent) => {
      const f = fracAtClientX(canvas, e.clientX, r);
      hoverX.current = f;
      onHoverIndex(indexAtFrac(f));
      if (dragging.current) scrubTo(f);
    };
    const up = (e: PointerEvent) => {
      dragging.current = false;
      if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
    };
    const out = () => {
      hoverX.current = null;
      onHoverIndex(null);
    };

    canvas.addEventListener("pointerdown", down);
    canvas.addEventListener("pointermove", move);
    canvas.addEventListener("pointerup", up);
    canvas.addEventListener("pointerleave", out);
    return () => {
      cancelAnimationFrame(raf);
      canvas.removeEventListener("pointerdown", down);
      canvas.removeEventListener("pointermove", move);
      canvas.removeEventListener("pointerup", up);
      canvas.removeEventListener("pointerleave", out);
    };
  }, [line, corners, width, height, tokens, progressRef, onHoverIndex, onScrubStart, onCornerSelect]);

  return (
    <canvas
      ref={canvasRef}
      role="img"
      aria-label={`Speed against distance around the lap, peaking at ${Math.round(
        vMaxKmh,
      )} kilometres per hour.`}
      style={{ display: "block", cursor: "ew-resize", touchAction: "none" }}
    />
  );
}
