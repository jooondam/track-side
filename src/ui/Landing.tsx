// the cover sheet of the run plan.
//
// What this replaced: a stock dark technical hero. Eyebrow chip, two-line headline with the
// second line in the accent colour, three-up stat row, primary CTA beside a quiet secondary,
// numbered four-up process strip, all of it floating over a full-bleed 3D circuit. Every one of
// those parts is interchangeable with any other product's front page, and the racing line ran
// behind the copy at 390px because the copy was never given a page to sit on.
//
// What it is now: a sheet. The circuit is a bounded figure printed into it, with a rule above and
// below and a caption under it, the way a diagram sits in a document. The camera composes for
// that figure rather than for the window, so nothing is cropped by the plate's edges and no copy
// ever sits over the road. See ViewOffset and onPlateRect.
//
// The corner rows are the same rows the corner report prints behind this (./cornerRows), read
// from the loaded artifact and the live solve. They are not a picture of a table: clicking one
// enters the viewer scoped to that corner, which makes the cover the first instance of the thing
// the whole tool does rather than an advertisement for it.
//
// The right margin carries what grip is worth, corner by corner, from a second solve at a lower
// mu run on this page. That is the product's actual claim (it re-solves, live, here) stated as a
// number an engineer can check rather than as a sentence.

import { useCallback, useEffect, useRef, useState } from "react";
import { Button, formatDeltaS } from "./primitives";
import { formatLapTime } from "./TopBar";
import type { CornerRow } from "./cornerRows";
import type { Corner } from "../assets";
import type { GT3Vehicle } from "../solver/vehicle";

export interface PlateRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

interface LandingProps {
  circuitId: string;
  circuitName: string;
  lapTimeS: number;
  elevationRangeM: number;
  solveMs: number;
  vehicle: GT3Vehicle;
  mu: number;
  /** the grip the margin column compares against */
  compareMu: number;
  rows: CornerRow[];
  onEnter: () => void;
  onEnterAtCorner: (corner: Corner) => void;
  /** where the diagram plate is, in viewport pixels, so the camera can compose for it */
  onPlateRect: (rect: PlateRect | null) => void;
}

const STEPS: [string, string][] = [
  ["Geometry", "TUMFTM centreline and widths, resampled and closed"],
  ["Racing line", "a minimum-curvature QP over the lateral offsets"],
  ["Speed", "forward-backward pass on the friction circle"],
  ["Elevation", "2023 F1 car telemetry registered onto the track"],
];

const RULE = "1px solid var(--line)";
const RULE_STRONG = "2px solid var(--line-strong)";

export function Landing({
  circuitId,
  circuitName,
  lapTimeS,
  elevationRangeM,
  solveMs,
  vehicle,
  mu,
  compareMu,
  rows,
  onEnter,
  onEnterAtCorner,
  onPlateRect,
}: LandingProps) {
  const [showHow, setShowHow] = useState(false);
  const ctaRef = useRef<HTMLButtonElement>(null);
  const plateRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // preventScroll, or focusing the button scrolls this sheet to it and the reader arrives
    // below the masthead and the lap time: the page skips its own opening line.
    ctaRef.current?.focus({ preventScroll: true });
  }, []);

  // the plate's rectangle drives the camera, so it has to survive a resize and a scroll, not just
  // a mount: this sheet scrolls on a short window, and a figure that has scrolled halfway off
  // should take its framing with it.
  const report = useCallback(() => {
    const el = plateRef.current;
    if (!el) return;
    const b = el.getBoundingClientRect();
    onPlateRect({ left: b.left, top: b.top, right: b.right, bottom: b.bottom });
  }, [onPlateRect]);

  useEffect(() => {
    report();
    const ro = new ResizeObserver(report);
    if (plateRef.current) ro.observe(plateRef.current);
    const el = scrollRef.current;
    el?.addEventListener("scroll", report, { passive: true });
    window.addEventListener("resize", report);
    return () => {
      ro.disconnect();
      el?.removeEventListener("scroll", report);
      window.removeEventListener("resize", report);
      // hand the camera back to the viewer's own insets
      onPlateRect(null);
    };
  }, [report, onPlateRect]);

  useEffect(report, [report, showHow, rows.length]);

  const column: React.CSSProperties = {
    maxWidth: 1040,
    margin: "0 auto",
    padding: "0 clamp(20px, 4vw, 56px)",
  };

  return (
    <div
      ref={scrollRef}
      className="ts-sheet"
      style={{ position: "absolute", inset: 0, zIndex: 30, overflowY: "auto" }}
    >
      {/* the printed grid: process blue at working strength, on the paper blocks only. It is the
          stock this whole world is drawn on, so it belongs under the type rather than behind a
          hero image. */}
      <style>{`
        .ts-sheet .ts-paper {
          background-color: var(--panel);
          background-image:
            linear-gradient(to right, color-mix(in srgb, var(--line) 42%, transparent) 1px, transparent 1px),
            linear-gradient(to bottom, color-mix(in srgb, var(--line) 42%, transparent) 1px, transparent 1px);
          background-size: 22px 22px;
          background-position: -1px -1px;
        }
        .ts-row:hover, .ts-row:focus-visible { background: color-mix(in srgb, var(--accent) 9%, transparent); }
        .ts-row { cursor: pointer; }
      `}</style>

      <div className="ts-paper" style={{ paddingTop: "clamp(18px, 4vh, 40px)" }}>
        <div style={column}>
          {/* masthead: what this sheet is, and for which circuit. A run plan carries this at the
              top because a sheet with no header is a sheet you cannot file. */}
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              justifyContent: "space-between",
              gap: "var(--s3)",
              flexWrap: "wrap",
              paddingBottom: "var(--s2)",
              borderBottom: RULE_STRONG,
              fontSize: 12,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              color: "var(--text-muted)",
            }}
          >
            <span style={{ fontWeight: 700, color: "var(--text)" }}>track-side</span>
            <span>
              Run plan · {circuitName} · solved, not driven
            </span>
          </div>

          {/* the head: one sentence of what this is, and the lap time as the page's spine. The
              number is large because it is the structure of the sheet, and its provenance is set
              directly under it because PRODUCT.md is explicit that it is estimated. A number this
              size with no qualifier is the single most misleading thing this page could print. */}
          <div
            style={{
              display: "flex",
              gap: "clamp(20px, 4vw, 56px)",
              alignItems: "flex-end",
              justifyContent: "space-between",
              flexWrap: "wrap",
              padding: "var(--s5) 0 var(--s4)",
            }}
          >

            <div style={{ display: "flex", flexDirection: "column", gap: "var(--s4)", maxWidth: "46ch" }}>
              <p
                style={{
                  margin: 0,
                  fontSize: 15,
                  lineHeight: 1.6,
                  color: "var(--text)",
                }}
              >
A minimum-curvature racing line solved on measured circuit geometry, with a
                velocity profile that re-solves in this browser every time the grip changes. The
                elevation is real too: {elevationRangeM.toFixed(0)} m of range, registered from car
                telemetry rather than drawn.{" "}
                {/* the voice example PRODUCT.md preserves, and it is about Spa, so it is only
                    true at Spa. The page it replaced printed it over Monza as well. */}
                {circuitId === "spa" && "Eau Rouge climbs 40 m of that because it does in Belgium."}
              </p>

              <div style={{ display: "flex", gap: "var(--s2)", alignItems: "center", flexWrap: "wrap" }}>
                <Button ref={ctaRef} variant="primary" size="md" onClick={onEnter}>
                  Open the circuit
                </Button>
                <Button
                  size="md"
                  variant="quiet"
                  active={showHow}
                  onClick={() => setShowHow((s) => !s)}
                  aria-expanded={showHow}
                >
                  How it works
                </Button>
              </div>

              {showHow && (
                <ol
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
                    gap: "var(--s3)",
                    margin: 0,
                    padding: 0,
                    listStyle: "none",
                  }}
                >
                  {STEPS.map(([title, detail]) => (
                    <li key={title} style={{ paddingTop: "var(--s2)", borderTop: RULE_STRONG }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)" }}>
                        {title}
                      </div>
                      <div style={{ fontSize: 12, lineHeight: 1.5, color: "var(--text-dim)" }}>
                        {detail}
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </div>

            <div style={{ minWidth: 260 }}>
              <div
                style={{
                  fontSize: 12,
                  letterSpacing: "0.14em",
                  textTransform: "uppercase",
                  color: "var(--text-muted)",
                }}
              >
                Lap, grip {mu.toFixed(2)}
              </div>
              <div
                className="tnum"
                style={{
                  fontSize: "clamp(46px, 8vw, 88px)",
                  lineHeight: 1.0,
                  fontWeight: 700,
                  letterSpacing: "-0.03em",
                  color: "var(--text)",
                }}
              >
                {formatLapTime(lapTimeS)}
              </div>
              <div style={{ fontSize: 12, lineHeight: 1.55, color: "var(--text-dim)", marginTop: 4 }}>
                solved for a GT3-class model, {vehicle.mass_kg.toFixed(0)} kg,{" "}
                {(vehicle.power_w / 1000).toFixed(0)} kW, rear drive.
                <br />
                Modelled from an estimated g-g-v, not a measured lap.
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* the diagram plate. This band is deliberately transparent: the canvas behind the sheet
          shows through it, and the camera has been told to compose the circuit inside exactly
          this rectangle, so the figure is framed rather than cropped. Rules above and below,
          caption underneath, the way a figure sits in a document. */}
      <div
        ref={plateRef}
        aria-hidden="true"
        style={{
          height: "clamp(220px, 40vh, 400px)",
          borderTop: RULE_STRONG,
          borderBottom: RULE,
        }}
      />

      <div className="ts-paper">
        <div style={column}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              gap: "var(--s3)",
              flexWrap: "wrap",
              padding: "6px 0 var(--s5)",
              borderBottom: RULE,
              fontSize: 12,
              color: "var(--text-dim)",
            }}
          >
            <span>
              Fig. 1 · {circuitName}, solved line, coloured by phase. Live, and orbiting.
            </span>
            <span className="tnum">re-solved in {solveMs.toFixed(1)} ms</span>
          </div>

          {/* the corner rows, and the margin. Same builder as the report behind this page. */}
          <div style={{ paddingTop: "var(--s5)" }}>
            <div
              style={{
                display: "flex",
                alignItems: "baseline",
                justifyContent: "space-between",
                gap: "var(--s3)",
                flexWrap: "wrap",
              }}
            >
              <h2
                style={{
                  margin: 0,
                  fontSize: 12,
                  letterSpacing: "0.14em",
                  textTransform: "uppercase",
                  color: "var(--text-muted)",
                  fontWeight: 600,
                }}
              >
                Named corners
              </h2>
              <span style={{ fontSize: 12, color: "var(--text-dim)" }}>
                any row opens the circuit at that corner
              </span>
            </div>

            <table
              style={{
                borderCollapse: "collapse",
                width: "100%",
                marginTop: "var(--s2)",
                fontSize: 13,
              }}
            >
              <caption className="sr-only">
                Each named corner: minimum speed and time in the corner at grip μ{mu.toFixed(2)},
                and in the margin the same corner against a second solve at grip
                μ{compareMu.toFixed(2)}, where negative means the μ{mu.toFixed(2)} solve is
                quicker. Activating a row opens the circuit at that corner.
              </caption>
              <thead>
                <tr
                  style={{
                    fontSize: 12,
                    letterSpacing: "0.06em",
                    textTransform: "uppercase",
                    color: "var(--text-dim)",
                  }}
                >
                  <th scope="col" style={{ textAlign: "left", fontWeight: 500, padding: "0 0 4px" }}>
                    Corner
                  </th>
                  <th scope="col" style={{ textAlign: "right", fontWeight: 500, padding: "0 0 4px" }}>
                    v min <span style={{ color: "var(--text-dim)", fontWeight: 400 }}>km/h</span>
                  </th>
                  <th scope="col" style={{ textAlign: "right", fontWeight: 500, padding: "0 0 4px" }}>
                    time <span style={{ color: "var(--text-dim)", fontWeight: 400 }}>s</span>
                  </th>
                  {/* the margin: ruled off from the table proper, the way an annotation is */}
                  <th
                    scope="col"
                    style={{
                      textAlign: "right",
                      fontWeight: 500,
                      padding: "0 0 4px var(--s4)",
                      borderLeft: RULE,
                      width: "1%",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {/* no Greek in an uppercased head: μ uppercases to Μ and prints as a
                        Latin M. The grip is named in words here and in μ in the note below. */}
                    vs grip {compareMu.toFixed(2)}{" "}
                    <span style={{ color: "var(--text-dim)", fontWeight: 400 }}>s</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.corner.id}
                    className="ts-row"
                    tabIndex={0}
                    onClick={() => onEnterAtCorner(row.corner)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onEnterAtCorner(row.corner);
                      }
                    }}
                    style={{ borderTop: RULE }}
                  >
                    {/* 26px, comfortably over the 24px target minimum the rest of the interface
                        holds itself to. The report's own rows are 18px and are on the list. */}
                    <td style={{ padding: "5px 0", color: "var(--text)" }}>{row.corner.name}</td>
                    <td className="tnum" style={{ textAlign: "right", color: "var(--text-muted)" }}>
                      {row.vMinKph.toFixed(0)}
                    </td>
                    <td className="tnum" style={{ textAlign: "right", color: "var(--text-muted)" }}>
                      {row.timeS.toFixed(2)}
                    </td>
                    <td
                      className="tnum"
                      style={{
                        textAlign: "right",
                        padding: "5px 0 5px var(--s4)",
                        borderLeft: RULE,
                        color: row.deltaS === null || row.deltaS <= 0 ? "var(--pos)" : "var(--neg)",
                      }}
                    >
                      {row.deltaS === null ? "–" : formatDeltaS(row.deltaS)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <p
              style={{
                margin: "var(--s3) 0 0",
                fontSize: 12,
                lineHeight: 1.6,
                color: "var(--text-dim)",
                maxWidth: "72ch",
              }}
            >
              The margin is this circuit solved a second time at grip μ{compareMu.toFixed(2)}, on
              this page, just now. Negative means the μ{mu.toFixed(2)} solve is quicker through
              that corner, so the column is what {(mu - compareMu).toFixed(2)} of grip is worth,
              corner by corner. It is also why the slider inside is not a playback speed.
            </p>
          </div>

          {showHow && (
            <p
              style={{
                margin: "var(--s4) 0 0",
                fontSize: 12,
                lineHeight: 1.6,
                color: "var(--text-muted)",
                maxWidth: "72ch",
              }}
            >
              The line is validated against TUM&apos;s published raceline and a minimum-time NLP
              reference; the browser solver is cross-checked against the Python one it was ported
              from, to 0.1 m/s.
            </p>
          )}

          <footer
            style={{
              margin: "var(--s5) 0 0",
              padding: "var(--s3) 0 clamp(20px, 5vh, 44px)",
              borderTop: RULE,
              fontSize: 12,
              lineHeight: 1.6,
              color: "var(--text-dim)",
              maxWidth: "86ch",
            }}
          >
            Track data: TUMFTM racetrack-database (LGPL-3.0), © OpenStreetMap contributors.
            Elevation derived from OpenF1, an unofficial project unaffiliated with Formula 1. Not
            endorsed by or associated with Formula One Licensing B.V.
          </footer>
        </div>
      </div>
    </div>
  );
}
