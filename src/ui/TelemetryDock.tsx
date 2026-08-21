// the bottom dock. Collapsed it is a 34px strip carrying the live speed, g and delta readouts;
// expanded it is two tabs of instruments, sized to the dock's real width rather than the
// hardcoded 640px the charts used to share. Same expansion rules as the side rail: hover, focus,
// or pin.
//
//   traces    v(s), delta to ghost, elevation and the lap scrubber, all against arc length so a
//             vertical line through them is one place on the road, plus the g-g square beside
//   corners   the per-corner table, which is the same lap read as rows instead of as curves
//
// The readouts in the strip are written by a rAF loop straight into spans, not through React
// state, for the same reason the chart cursors are: they update at 60 Hz.

import { useEffect, useRef, useState } from "react";
import { CornerReport } from "./CornerReport";
import { DeltaTrace } from "./DeltaTrace";
import { ElevationStrip } from "./ElevationStrip";
import { GgDiagram } from "./GgDiagram";
import { Button, IconButton, formatDeltaS } from "./primitives";
import { SpeedTrace } from "./SpeedTrace";
import { Timeline } from "./Timeline";
import { useElementWidth } from "./canvasUtils";
import type { Expandable } from "./useExpandable";
import type { LineData } from "../assets";
import type { LapProgress } from "../render/CarMarker";
import type { LapTimeTable } from "../solver/lapTime";
import { deltaToGhost } from "../solver/lapTime";
import type { VelocityProfileResult } from "../solver/velocity";
import type { Corner } from "../assets";

/** the always-visible strip carrying the live readout */
export const DOCK_STRIP_H = 34;
// 284 = speed 132 + delta 64 + elevation 48 + timeline 40. The traces stack and the body clips,
// so this has to be the sum rather than a round number: at the old 236 the timeline was simply
// cut off by the delta trace being added below it.
export const DOCK_BODY_H = 284;

/** which set of instruments the dock body is showing. */
type Tab = "traces" | "corners";

interface TelemetryDockProps {
  dock: Expandable;
  line: LineData;
  result: VelocityProfileResult;
  table: LapTimeTable;
  ghostTable: LapTimeTable | null;
  mu: number;
  corners: Corner[];
  progressRef: React.MutableRefObject<LapProgress>;
  onHoverIndex: (index: number | null) => void;
  onScrubStart: () => void;
  onCornerSelect: (corner: Corner) => void;
}

/** width below which the g-g square is dropped rather than squeezing the traces beside it. */
const GG_MIN_WIDTH = 760;
// the square plus the figure's own horizontal padding (2 * --s3). Sized from the canvas rather
// than rounded, because a few pixels short clips the "mu g" label off the ring.
const GG_WIDTH = 132 + 24;

export function TelemetryDock(props: TelemetryDockProps) {
  const { dock } = props;
  const bodyRef = useRef<HTMLDivElement>(null);
  const width = useElementWidth(bodyRef);
  const [tab, setTab] = useState<Tab>("traces");

  // the g-g sits beside the traces and takes width from them, so it is the first thing to go on
  // a narrow dock. The traces are the primary read; the square is the diagnostic.
  const showGg = width >= GG_MIN_WIDTH;
  const traceWidth = showGg ? width - GG_WIDTH : width;

  const scrubStart = () => {
    dock.setHold(true);
    props.onScrubStart();
  };

  useEffect(() => {
    const onUp = () => dock.setHold(false);
    window.addEventListener("pointerup", onUp);
    return () => window.removeEventListener("pointerup", onUp);
  }, [dock]);

  return (
    <section
      aria-label="Telemetry"
      {...dock.handlers}
      style={{
        // overlays the viewport rather than taking a row from it, so expanding the dock slides
        // over the circuit instead of squeezing it and forcing a canvas resize
        position: "absolute",
        // starts where the rail ends, and animates with it, so the rail never covers the
        // dock's own labels
        left: "var(--rail-w, 0px)",
        right: 0,
        bottom: 0,
        zIndex: 15,
        transition: "left var(--t-base) var(--ease)",
        background: "var(--panel)",
        borderTop: "1px solid var(--line)",
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
        // without these the canvases' own width (the ResizeObserver fallback, before the first
        // measurement lands) sets the grid column's min-content size, and the whole layout
        // inflates to 640px on a 390px phone and never comes back down
        minWidth: 0,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--s3)",
          height: DOCK_STRIP_H,
          padding: "0 var(--s3)",
          flexShrink: 0,
        }}
      >
        <span
          style={{
            fontSize: 12,
            fontWeight: 600,
            letterSpacing: "0.09em",
            textTransform: "uppercase",
            color: "var(--text-dim)",
          }}
        >
          Telemetry
        </span>
        <LiveReadout progressRef={props.progressRef} result={props.result} line={props.line} />
        <LiveDelta
          progressRef={props.progressRef}
          table={props.table}
          ghostTable={props.ghostTable}
          line={props.line}
        />
        <div style={{ flex: 1 }} />
        {dock.expanded && (
          <div style={{ display: "flex", gap: 2 }} role="tablist" aria-label="Telemetry view">
            <Button active={tab === "traces"} onClick={() => setTab("traces")}>
              traces
            </Button>
            <Button active={tab === "corners"} onClick={() => setTab("corners")}>
              corners
            </Button>
          </div>
        )}
        <IconButton
          label={dock.pinned ? "Unpin telemetry" : "Keep telemetry open"}
          active={dock.pinned}
          onClick={dock.togglePin}
        >
          {dock.pinned ? "◉" : "○"}
        </IconButton>
      </div>

      <div
        ref={bodyRef}
        style={{
          height: dock.expanded ? DOCK_BODY_H : 0,
          minWidth: 0,
          overflow: "hidden",
          transition: "height var(--t-base) var(--ease)",
          willChange: "height",
        }}
      >
        {dock.expanded && width > 0 && tab === "traces" && (
          <div style={{ display: "flex", minWidth: 0 }}>
            <div style={{ minWidth: 0, flex: 1 }}>
              <SpeedTrace
                line={props.line}
                result={props.result}
                corners={props.corners}
                width={traceWidth}
                progressRef={props.progressRef}
                onHoverIndex={props.onHoverIndex}
                onScrubStart={scrubStart}
                onCornerSelect={props.onCornerSelect}
              />
              <DeltaTrace
                line={props.line}
                table={props.table}
                ghostTable={props.ghostTable}
                width={traceWidth}
                height={64}
                progressRef={props.progressRef}
                onScrubStart={scrubStart}
              />
              <ElevationStrip
                line={props.line}
                width={traceWidth}
                height={48}
                progressRef={props.progressRef}
                onScrubStart={scrubStart}
              />
              <Timeline
                sM={props.line.sM}
                table={props.table}
                width={traceWidth}
                progressRef={props.progressRef}
                onScrubStart={scrubStart}
              />
            </div>
            {showGg && (
              <GgDiagram
                line={props.line}
                result={props.result}
                mu={props.mu}
                progressRef={props.progressRef}
              />
            )}
          </div>
        )}
        {dock.expanded && width > 0 && tab === "corners" && (
          <CornerReport
            line={props.line}
            result={props.result}
            table={props.table}
            ghostTable={props.ghostTable}
            corners={props.corners}
            onCornerSelect={props.onCornerSelect}
          />
        )}
      </div>
    </section>
  );
}

/** speed and g, written straight into the DOM at frame rate. */
function LiveReadout({
  progressRef,
  result,
  line,
}: {
  progressRef: React.MutableRefObject<LapProgress>;
  result: VelocityProfileResult;
  line: LineData;
}) {
  const vRef = useRef<HTMLSpanElement>(null);
  const gRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const p = progressRef.current;
      // sM is close enough to uniform that a proportional index is exact to within a sample
      const i = Math.min(
        Math.max(Math.round((p.sM / line.loopLengthM) * (line.nPoints - 1)), 0),
        line.nPoints - 1,
      );
      if (vRef.current) vRef.current.textContent = `${(p.vMps * 3.6).toFixed(0)} km/h`;
      if (gRef.current) {
        gRef.current.textContent = `${result.axMps2[i].toFixed(1)} / ${result.ayMps2[i].toFixed(1)} m/s²`;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [progressRef, result, line]);

  const cap: React.CSSProperties = { color: "var(--text-dim)", fontSize: 12, letterSpacing: "0.06em" };
  return (
    <span style={{ display: "flex", gap: "var(--s3)", alignItems: "baseline" }}>
      <span style={cap}>
        v <span ref={vRef} className="tnum" style={{ color: "var(--text-muted)", fontSize: 12 }} />
      </span>
      <span style={cap}>
        ax/ay <span ref={gRef} className="tnum" style={{ color: "var(--text-muted)", fontSize: 12 }} />
      </span>
    </span>
  );
}

/**
 * live delta to the ghost at the car's current arc length.
 *
 * Visible in the collapsed strip on purpose: it is the one number worth having on screen when
 * the dock is shut, because it is the only one that says whether the change you just made to the
 * grip slider is helping. Colour carries the sign, and the sign is also written out, since colour
 * alone is not an accessible signal.
 */
function LiveDelta({
  progressRef,
  table,
  ghostTable,
  line,
}: {
  progressRef: React.MutableRefObject<LapProgress>;
  table: LapTimeTable;
  ghostTable: LapTimeTable | null;
  line: LineData;
}) {
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!ghostTable) return;
    let raf = 0;
    const tick = () => {
      const p = progressRef.current;
      const i = Math.min(
        Math.max(Math.round((p.sM / line.loopLengthM) * (line.nPoints - 1)), 0),
        line.nPoints - 1,
      );
      const d = deltaToGhost(table.cumTimeS[i], ghostTable.cumTimeS[i]);
      if (ref.current) {
        ref.current.textContent = formatDeltaS(d);
        ref.current.style.color = d <= 0 ? "var(--pos)" : "var(--neg)";
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [progressRef, table, ghostTable, line]);

  if (!ghostTable) return null;
  return (
    <span style={{ color: "var(--text-dim)", fontSize: 12, letterSpacing: "0.06em" }}>
      vs ghost <span ref={ref} className="tnum" style={{ fontSize: 12 }} />
    </span>
  );
}
