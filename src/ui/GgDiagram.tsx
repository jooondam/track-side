// the g-g diagram: longitudinal against lateral acceleration, for the whole lap at once.
//
// This is the plot a race engineer opens first, and the question it answers is not "how fast" but
// "is the car using the tyre". A tyre's grip is roughly a circle of radius mu*g in the (ay, ax)
// plane: you can have all of it braking, all of it cornering, or any combination on the ring
// between, but never more than the radius. Plot a lap and the shape tells you what the driver, or
// in this case the solver, actually did with it:
//
//   a full ring          every corner taken at the limit, braking blended into turning
//   a cross              braking and cornering happen but never together: time lost on entry
//   a squashed top       the car is grip-limited sideways but power-limited forward, which is
//                        what a GT3 looks like above about 200 km/h
//
// The last one is why the cloud here is not a disc. Above the power-limited speed the car cannot
// reach +mu*g longitudinally at all, so the upper half is clipped by the engine rather than by
// the tyre, and the envelope leans. Nothing is wrong when that shows up.
//
// **Points outside the ring are correct, and deleting them would be the bug.** The circle drawn
// here is mu*g, which is the limit on a *flat* road. The solver's normal load is
// m*(g*cos(theta) + v^2*kappa_v), so wherever the road compresses under the car the tyre has
// more load and therefore more grip than mu*g. At Spa this is not a rounding effect: the worst
// vertical curvature is 1.27e-2 1/m, worth 0.31 g of extra load, which lifts the real limit
// there to about 1.57 g against a drawn circle of 1.20. The lap reaches 1.63 g total. That
// overshoot *is* Eau Rouge, and a g-g diagram that hid it would be hiding the most interesting
// thing about the circuit. Hence the ring is labelled as the flat-road limit rather than as
// "the limit".
//
// Drawn in two layers for the same reason SpeedTrace is: the lap's cloud changes only when the
// solver reruns, so it goes into an offscreen buffer once, and the visible canvas composites
// buffer + live dot per frame. Zero React re-renders at 60 Hz.

import { useEffect, useMemo, useRef } from "react";
import type { LineData } from "../assets";
import type { LapProgress } from "../render/CarMarker";
import type { VelocityProfileResult } from "../solver/velocity";
import { FONT, TYPE, useThemeTokens } from "./theme";
import { prepareCanvas } from "./canvasUtils";

const HEIGHT = 132;
/** axis half-range in g, so the mu circle has room even at the top of the grip slider. */
const RANGE_G = 2.0;
const G = 9.81;

interface GgDiagramProps {
  line: LineData;
  result: VelocityProfileResult;
  mu: number;
  progressRef: React.MutableRefObject<LapProgress>;
}

export function GgDiagram({ line, result, mu, progressRef }: GgDiagramProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const bufferRef = useRef<HTMLCanvasElement | null>(null);
  const tokens = useThemeTokens();

  // square: a g-g diagram with a non-uniform aspect is a lie about the friction circle, since the
  // whole point is reading distance from the origin. The *plot* stays square; the canvas is taller
  // than it is wide by one label band top and bottom.
  const size = HEIGHT;
  // room for "accel" and "brake" outside the plot rather than on top of it. At the old 9px they
  // sat inside the square and cleared the data by luck; at the interface's 12px floor they landed
  // on the ring's upper trace and on the braking cloud. Widening the margin keeps the plot at full
  // size, where shrinking the ring to fit the labels would have cost a quarter of the data area in
  // a 132px square.
  const band = TYPE.size.label + 4;
  const canvasH = size + band * 2;

  const style = useMemo(
    () => ({
      cloud: tokens.textDim,
      ring: tokens.lineStrong,
      axis: tokens.line,
      label: tokens.textDim,
      live: tokens.accent,
      brake: tokens.phaseBrake,
      accel: tokens.phaseAccel,
    }),
    [tokens],
  );

  // the static layer: axes, the mu circle, and the lap's cloud
  useEffect(() => {
    const buffer = bufferRef.current ?? document.createElement("canvas");
    bufferRef.current = buffer;
    const ctx = prepareCanvas(buffer, size, canvasH);
    if (!ctx) return;
    ctx.clearRect(0, 0, size, canvasH);

    const c = size / 2;
    const cy = canvasH / 2;
    const scale = c / RANGE_G; // pixels per g

    // axes
    ctx.strokeStyle = style.axis;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(c, band);
    ctx.lineTo(c, band + size);
    ctx.moveTo(0, cy);
    ctx.lineTo(size, cy);
    ctx.stroke();

    // 1 g reference, then the tyre's own circle at mu * g
    for (const [g, dashed] of [
      [1, true],
      [mu, false],
    ] as const) {
      ctx.strokeStyle = style.ring;
      ctx.setLineDash(dashed ? [2, 3] : []);
      ctx.lineWidth = dashed ? 1 : 1.5;
      ctx.beginPath();
      ctx.arc(c, cy, g * scale, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.setLineDash([]);

    // the lap. One pixel per sample, alpha-stacked: where the car spends time the cloud is
    // solid, and a corner taken once leaves a faint arc. Overplotting is the density estimate.
    ctx.globalAlpha = 0.5;
    for (let i = 0; i < line.nPoints; i++) {
      const ax = result.axMps2[i] / G;
      const ay = result.ayMps2[i] / G;
      // +ax is forward, and screen y grows downward, so accelerating goes up the plot
      ctx.fillStyle = ax < -0.05 ? style.brake : ax > 0.05 ? style.accel : style.cloud;
      ctx.fillRect(c + ay * scale - 0.75, cy - ax * scale - 0.75, 1.5, 1.5);
    }
    ctx.globalAlpha = 1;

    // axis labels, in the bands above and below the plot rather than inside it. Left-aligned from
    // the centre line: a right-aligned label against the canvas edge was being clipped by the dock,
    // and there is no width here to spend on finding out by how much.
    ctx.fillStyle = style.label;
    ctx.font = `${TYPE.size.label}px ${FONT.mono}`;
    ctx.textAlign = "left";
    ctx.fillText("accel", c + 3, band - 4);
    ctx.fillText("brake", c + 3, canvasH - 4);
    // the ring's own value moved out to the figcaption. At the interface's 12px floor these three
    // labels no longer fit one edge of a 132px square, and "1.20 g flat" ran straight into
    // "brake". The caption is DOM, so it is neither clipped nor squeezed, and it turns a bare
    // panel name into a statement of what the ring is. "flat" is load-bearing there exactly as it
    // was here: see the note at the top about compressions putting the car outside the ring.
  }, [line, result, mu, style, size, band, canvasH]);

  // the live layer, at frame rate
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const canvas = canvasRef.current;
      const buffer = bufferRef.current;
      if (canvas && buffer) {
        const ctx = prepareCanvas(canvas, size, canvasH);
        if (ctx) {
          ctx.clearRect(0, 0, size, canvasH);
          ctx.drawImage(buffer, 0, 0, size, canvasH);

          const p = progressRef.current;
          const i = Math.min(
            Math.max(Math.round((p.sM / line.loopLengthM) * (line.nPoints - 1)), 0),
            line.nPoints - 1,
          );
          const c = size / 2;
          const cy = canvasH / 2;
          const scale = c / RANGE_G;
          const x = c + (result.ayMps2[i] / G) * scale;
          const y = cy - (result.axMps2[i] / G) * scale;

          // a line from the origin, not just a dot: the length *is* the total g, which is the
          // number being read, and a bare dot makes you estimate it from a position
          ctx.strokeStyle = style.live;
          ctx.lineWidth = 1;
          ctx.globalAlpha = 0.55;
          ctx.beginPath();
          ctx.moveTo(c, cy);
          ctx.lineTo(x, y);
          ctx.stroke();
          ctx.globalAlpha = 1;

          ctx.fillStyle = style.live;
          ctx.beginPath();
          ctx.arc(x, y, 3, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [line, result, progressRef, style, size, canvasH]);

  return (
    // width is pinned to the canvas, not left to the caption. The caption gained the ring's own
    // value and immediately sized the figure wider than the GG_WIDTH the dock reserves for it,
    // which pushed the square off the right edge.
    <figure style={{ margin: 0, padding: "var(--s2) var(--s3)", flexShrink: 0, width: size }}>
      <figcaption
        style={{
          fontSize: TYPE.size.label,
          letterSpacing: TYPE.track.label,
          textTransform: "uppercase",
          color: "var(--text-dim)",
          marginBottom: 2,
        }}
      >
        g-g <span style={{ color: "var(--text-muted)", whiteSpace: "nowrap" }}>{mu.toFixed(2)} g flat</span>
      </figcaption>
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={`Longitudinal against lateral acceleration for the lap, over the flat-road tyre limit of ${mu.toFixed(2)} g. Compressions raise the real limit above the circle.`}
        style={{ display: "block" }}
      />
    </figure>
  );
}
