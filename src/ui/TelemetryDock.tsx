// the bottom dock. Collapsed it is a 34px strip carrying the live speed and g readouts; expanded
// it is the three charts, sized to the dock's real width rather than the hardcoded 640px they
// used to share. Same expansion rules as the side rail: hover, focus, or pin.
//
// The readouts in the strip are written by a rAF loop straight into spans, not through React
// state, for the same reason the chart cursors are: they update at 60 Hz.

import { useEffect, useRef } from "react";
import { ElevationStrip } from "./ElevationStrip";
import { IconButton } from "./primitives";
import { SpeedTrace } from "./SpeedTrace";
import { Timeline } from "./Timeline";
import { useElementWidth } from "./canvasUtils";
import type { Expandable } from "./useExpandable";
import type { LineData } from "../assets";
import type { LapProgress } from "../render/CarMarker";
import type { LapTimeTable } from "../solver/lapTime";
import type { VelocityProfileResult } from "../solver/velocity";
import type { CornerLabel } from "../tracks";

interface TelemetryDockProps {
  dock: Expandable;
  line: LineData;
  result: VelocityProfileResult;
  table: LapTimeTable;
  corners: CornerLabel[];
  progressRef: React.MutableRefObject<LapProgress>;
  onHoverIndex: (index: number | null) => void;
  onScrubStart: () => void;
  onCornerSelect: (corner: CornerLabel) => void;
}

export function TelemetryDock(props: TelemetryDockProps) {
  const { dock } = props;
  const bodyRef = useRef<HTMLDivElement>(null);
  const width = useElementWidth(bodyRef);

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
          height: 34,
          padding: "0 var(--s3)",
          flexShrink: 0,
        }}
      >
        <span
          style={{
            fontSize: 10,
            fontWeight: 600,
            letterSpacing: "0.09em",
            textTransform: "uppercase",
            color: "var(--text-dim)",
          }}
        >
          Telemetry
        </span>
        <LiveReadout progressRef={props.progressRef} result={props.result} line={props.line} />
        <div style={{ flex: 1 }} />
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
          height: dock.expanded ? 236 : 0,
          minWidth: 0,
          overflow: "hidden",
          transition: "height var(--t-base) var(--ease)",
          willChange: "height",
        }}
      >
        {dock.expanded && width > 0 && (
          <>
            <SpeedTrace
              line={props.line}
              result={props.result}
              corners={props.corners}
              width={width}
              progressRef={props.progressRef}
              onHoverIndex={props.onHoverIndex}
              onScrubStart={scrubStart}
              onCornerSelect={props.onCornerSelect}
            />
            <ElevationStrip
              line={props.line}
              width={width}
              progressRef={props.progressRef}
              onScrubStart={scrubStart}
            />
            <Timeline
              sM={props.line.sM}
              table={props.table}
              width={width}
              progressRef={props.progressRef}
              onScrubStart={scrubStart}
            />
          </>
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

  const cap: React.CSSProperties = { color: "var(--text-dim)", fontSize: 10, letterSpacing: "0.06em" };
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
