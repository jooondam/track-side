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
import { deltaToGhost, gapMetres, sAtTime } from "../solver/lapTime";
import type { VelocityProfileResult } from "../solver/velocity";
import type { Corner } from "../assets";
import { Icon } from "./Icon";
import { TYPE, useIsNarrow } from "./theme";

/** the always-visible strip carrying the live readout */
export const DOCK_STRIP_H = 34;
// the traces stack and the body clips, so these have to be sums rather than round numbers: at an
// earlier round 236 the timeline was simply cut off by the delta trace being added below it.
//
// **The delta row is only there when there is a ghost to compare against.** With the ghost off,
// which is the default, those 64px printed one sentence, "turn the ghost on to compare", and
// nothing else. The invitation now lives in the strip, and the height goes back to the scene
// through the inset path App already runs.
const DELTA_H = 64;
export const DOCK_BODY_H = 132 + DELTA_H + 48 + 40; // speed + delta + elevation + timeline
export const DOCK_BODY_H_NO_GHOST = DOCK_BODY_H - DELTA_H;

/** the body height for the current state, which the camera insets are derived from. */
export function dockBodyHeight(hasGhost: boolean): number {
  return hasGhost ? DOCK_BODY_H : DOCK_BODY_H_NO_GHOST;
}

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
  const narrow = useIsNarrow();

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
        {/* the panel's own name, and the first thing to go when the row is short.
 
            It conveys nothing the reader does not already have: it names the container it is
            inside, and the numbers beside it are the information. Dropped outright on a phone
            rather than clipped, because a truncated word is worse than no word. This is what
            closes the 390px collision PLAN.md has been carrying, where the readout wrapped onto
            three lines and printed straight through it. */}
        {!narrow && (
          <span
            style={{
              fontSize: TYPE.size.label,
              fontWeight: TYPE.weight.bold,
              letterSpacing: TYPE.track.label,
              textTransform: "uppercase",
              color: "var(--text-dim)",
              whiteSpace: "nowrap",
            }}
          >
            Telemetry
          </span>
        )}
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
          <Icon name={dock.pinned ? "pinned" : "unpinned"} size={14} />
        </IconButton>
      </div>

      <div
        ref={bodyRef}
        style={{
          height: dock.expanded ? dockBodyHeight(props.ghostTable !== null) : 0,
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
              {props.ghostTable && (
                <DeltaTrace
                  line={props.line}
                  table={props.table}
                  ghostTable={props.ghostTable}
                  width={traceWidth}
                  height={DELTA_H}
                  progressRef={props.progressRef}
                  onScrubStart={scrubStart}
                />
              )}
              <ElevationStrip
                line={props.line}
                width={traceWidth}
                height={48}
                progressRef={props.progressRef}
                onScrubStart={scrubStart}
              />
              <Timeline
                ghostTable={props.ghostTable}
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

  // nowrap on every readout: these are the information in the strip, so they hold their line and
  // the panel's own name gives way instead
  const narrow = useIsNarrow();
  const cap: React.CSSProperties = {
    color: "var(--text-dim)",
    fontSize: TYPE.size.label,
    letterSpacing: TYPE.track.label,
    whiteSpace: "nowrap",
  };
  return (
    <span style={{ display: "flex", gap: "var(--s3)", alignItems: "baseline", flexShrink: 0 }}>
      <span style={cap}>
        v <span ref={vRef} className="tnum" style={{ color: "var(--text-muted)", fontSize: TYPE.size.label }} />
      </span>
      {/* dropped on a phone, where the row cannot hold the numbers and the tabs at once and the
          tabs are the only way to reach the corner report. This is the one to lose: it is two
          numbers of the same channel the g-g square draws, and the g-g is itself dropped below
          760px, so at this width ax/ay has no companion to be read against. Speed and the delta
          survive, which are the two the collapsed strip exists for. */}
      {!narrow && (
        <span style={cap}>
          ax/ay <span ref={gRef} className="tnum" style={{ color: "var(--text-muted)", fontSize: TYPE.size.label }} />
        </span>
      )}
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
  const gapRef = useRef<HTMLSpanElement>(null);

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
      // the separation, which is a different quantity from the delta and is labelled apart from
      // it: seconds are the comparison at one point on the road, metres are the distance between
      // two points at one instant. Read as a pair they would look like two answers to one
      // question.
      if (gapRef.current) {
        const gap = gapMetres(p.sM, sAtTime(ghostTable, line.sM, p.lapTS), line.loopLengthM);
        gapRef.current.textContent = `${Math.abs(gap).toFixed(0)} m apart`;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [progressRef, table, ghostTable, line]);

  // with no ghost there is nothing to compare, and the delta trace is not rendered at all. The
  // invitation lives here instead of in 64px of otherwise empty chart.
  if (!ghostTable) {
    return (
      <span
        style={{
          color: "var(--text-dim)",
          fontSize: TYPE.size.label,
          letterSpacing: TYPE.track.label,
          whiteSpace: "nowrap",
          flexShrink: 0,
        }}
      >
        no ghost
      </span>
    );
  }
  return (
    <span
      style={{
        color: "var(--text-dim)",
        fontSize: TYPE.size.label,
        letterSpacing: TYPE.track.label,
        whiteSpace: "nowrap",
        flexShrink: 0,
      }}
    >
      vs ghost <span ref={ref} className="tnum" style={{ fontSize: TYPE.size.label }} />{" "}
      <span ref={gapRef} className="tnum" style={{ fontSize: TYPE.size.label, color: "var(--text-muted)" }} />
    </span>
  );
}
