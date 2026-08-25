// shared canvas plumbing for the three telemetry charts.
//
// The DPR handling here is a real bug fix, not polish: all three charts previously set a fixed
// width={640} backing store and let CSS stretch it, so on any retina display every trace was
// drawn at half the panel's actual resolution and looked soft next to the crisp DOM text beside
// it. Sizing the backing store to css * devicePixelRatio and scaling the context once fixes it,
// and lets the charts be responsive at the same time.

import { useEffect, useState } from "react";
import type { RefObject } from "react";
import { FONT, TYPE } from "./theme";

export interface PlotRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** the drawing area inside a chart, in CSS pixels, excluding the axis gutters. */
export function plotRect(w: number, h: number, pad = { l: 46, r: 10, t: 16, b: 16 }): PlotRect {
  return { left: pad.l, top: pad.t, width: w - pad.l - pad.r, height: h - pad.t - pad.b };
}

/** fraction along a plot rect for a client x, clamped to [0, 1]. */
export function fracAtClientX(canvas: HTMLCanvasElement, clientX: number, r: PlotRect): number {
  const box = canvas.getBoundingClientRect();
  // the canvas is laid out at its CSS size, so box maps 1:1 onto CSS pixels
  const x = clientX - box.left - r.left;
  return Math.min(Math.max(x / Math.max(r.width, 1), 0), 1);
}

/**
 * Size a canvas' backing store for the display and return a context already scaled so all
 * drawing can be done in CSS pixels. Returns null if the 2D context is unavailable.
 */
export function prepareCanvas(
  canvas: HTMLCanvasElement,
  width: number,
  height: number,
): CanvasRenderingContext2D | null {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const bw = Math.round(width * dpr);
  const bh = Math.round(height * dpr);
  if (canvas.width !== bw || canvas.height !== bh) {
    canvas.width = bw;
    canvas.height = bh;
  }
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}

/** observed CSS width of an element, so the charts fill the dock instead of a hardcoded 640px. */
export function useElementWidth(ref: RefObject<HTMLElement>, fallback = 320): number {
  const [width, setWidth] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w && w > 0) setWidth(w);
    });
    ro.observe(el);
    setWidth(el.getBoundingClientRect().width || fallback);
    return () => ro.disconnect();
  }, [ref, fallback]);
  return width;
}

/**
 * Draw a channel's name and its value at the cursor into the chart's left gutter.
 *
 * **The gutter used to be an axis or nothing at all.** All four charts reserve 46px of it;
 * ElevationStrip never drew into it, and every chart separately printed a caption across its top
 * edge that did no more than name the chart it was already inside. That is two kinds of dead
 * pixel at once: a reserved column with nothing in it, and a label restating its own context.
 *
 * This is the pattern every real telemetry tool uses (MoTeC i2, Pi Toolbox, ATLAS): the gutter
 * carries the channel and what it reads *right now*, so a stack of traces sharing one cursor is a
 * stack of live numbers rather than a stack of shapes. The charts already share a cursor and an x
 * axis in arc length, so this is completing a pattern rather than importing one.
 *
 * **One line, above the plot, not stacked inside the gutter column.** Two of these charts already
 * draw axis ticks in that column, and a stacked name-over-value collided with them head on. The
 * line the caption used to occupy is free, is the same for all four charts, and is wide enough
 * for a name and a value, so that is where this goes: the caption position, now carrying a
 * number.
 *
 * Name in the display face, value in mono, because a machine-printed figure is set in mono
 * everywhere else in this interface and the split is load-bearing.
 */
export function drawChannel(
  ctx: CanvasRenderingContext2D,
  opts: {
    name: string;
    value: string;
    unit?: string;
    x: number;
    baseline: number;
    nameColor: string;
    valueColor: string;
  },
): void {
  const { name, value, unit, x, baseline, nameColor, valueColor } = opts;
  ctx.textAlign = "left";
  ctx.fillStyle = nameColor;
  ctx.font = `${TYPE.size.label}px ${FONT.display}`;
  ctx.fillText(name, x, baseline);
  const nameWidth = ctx.measureText(name).width;
  ctx.fillStyle = valueColor;
  ctx.font = `${TYPE.size.label}px ${FONT.mono}`;
  ctx.fillText(unit ? `${value} ${unit}` : value, x + nameWidth + 8, baseline);
}
