// the front page. The circuit is already loaded and slowly orbiting behind this, so entering is
// a camera move rather than a page load, and the three numbers on it are read from the assets
// that are on screen: nothing here is marketing copy pretending to be data.
//
// It is a hero, not a modal: no scrim over the whole viewport, a gradient that leaves the circuit
// visible on the right, and one obvious way forward.

import { useEffect, useRef, useState } from "react";
import { Button, Stat } from "./primitives";
import { formatLapTime } from "./TopBar";

interface LandingProps {
  circuitName: string;
  lapTimeS: number;
  cornerCount: number;
  elevationRangeM: number;
  onEnter: () => void;
}

const STEPS: [string, string][] = [
  ["Geometry", "TUMFTM centreline and widths, resampled and closed"],
  ["Racing line", "a minimum-curvature QP over the lateral offsets"],
  ["Speed", "forward-backward pass on the friction circle"],
  ["Elevation", "2023 F1 car telemetry registered onto the track"],
];

export function Landing({
  circuitName,
  lapTimeS,
  cornerCount,
  elevationRangeM,
  onEnter,
}: LandingProps) {
  const [showHow, setShowHow] = useState(false);
  const ctaRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    ctaRef.current?.focus();
  }, []);

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 30,
        display: "flex",
        // flex-start, not center. Centring meant expanding "How it works" re-centred the whole
        // block and lifted the primary CTA 71px out from under the pointer that had just clicked
        // beside it: the only other button on the page relocated the main one.
        alignItems: "flex-start",
        overflowY: "auto",
      }}
      className="ts-landing"
    >
      {/* the wash is horizontal on a wide sheet, so the circuit stays readable to the right of the
          copy. Below 760px it turns vertical and opaque: at 390px the old 100deg gradient went
          fully transparent at 343px, which put the stat row, the buttons and the footer directly
          over a saturated racing line. That is the first thing a shared portfolio link shows. */}
      <style>{`
        .ts-landing {
          background: linear-gradient(100deg, var(--panel) 0%, var(--panel) 34%,
            color-mix(in srgb, var(--panel) 82%, transparent) 56%, transparent 88%);
        }
        @media (max-width: 760px) {
          .ts-landing {
            background: linear-gradient(180deg, var(--panel) 0%, var(--panel) 68%,
              color-mix(in srgb, var(--panel) 88%, transparent) 82%, transparent 100%);
          }
        }
      `}</style>
      <div
        style={{
          padding: "clamp(24px, 6vh, 64px) clamp(24px, 7vw, 92px) var(--s6)",
          maxWidth: 660,
          width: "100%",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            justifyContent: "space-between",
            gap: "var(--s3)",
            flexWrap: "wrap",
            paddingBottom: "var(--s2)",
            borderBottom: "2px solid var(--line-strong)",
            fontSize: 12,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            color: "var(--text-muted)",
          }}
        >
          <span style={{ fontWeight: 700, color: "var(--text)" }}>
            <span style={{ color: "var(--accent)" }}>◆</span> track-side
          </span>
          <span>
            Run plan · {circuitName} · GT3
          </span>
        </div>

        <h1
          style={{
            margin: "var(--s5) 0 0",
            fontSize: "clamp(34px, 5.4vw, 54px)",
            lineHeight: 1.02,
            letterSpacing: "-0.02em",
            fontWeight: 700,
            color: "var(--text)",
          }}
        >
          The racing line,
          <br />
          <span style={{ color: "var(--accent)" }}>solved.</span>
        </h1>

        <p
          style={{
            margin: "var(--s4) 0 0",
            maxWidth: 460,
            fontSize: 14,
            lineHeight: 1.65,
            color: "var(--text-muted)",
          }}
        >
          A minimum-curvature optimiser over real circuit geometry, driven by a velocity profile
          that re-solves in your browser every time you move the grip slider. The elevation is real
          too: Eau Rouge climbs 40 m here because it does in Belgium.
        </p>

        <div
          style={{
            display: "flex",
            gap: "var(--s6)",
            margin: "var(--s5) 0",
            paddingTop: "var(--s4)",
            borderTop: "1px solid var(--line)",
          }}
        >
          <Stat
            label="Lap at grip 1.20"
            value={formatLapTime(lapTimeS)}
            size="lg"
            note="modelled from an estimated GT3 g-g-v, not a measured lap"
          />
          <Stat label="Named corners" value={String(cornerCount)} size="lg" />
          <Stat
            label="Elevation range"
            value={elevationRangeM.toFixed(0)}
            unit="m"
            size="lg"
            note="registered from 2023 OpenF1 car location"
          />
        </div>

        <div style={{ display: "flex", gap: "var(--s2)", alignItems: "center", flexWrap: "wrap" }}>
          <Button ref={ctaRef} variant="primary" size="md" onClick={onEnter}>
            Open the circuit →
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
          <div style={{ marginTop: "var(--s5)" }}>
            <ol
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(128px, 1fr))",
                gap: "var(--s3)",
                margin: 0,
                padding: 0,
                listStyle: "none",
              }}
            >
              {STEPS.map(([title, detail]) => (
                <li
                  key={title}
                  style={{
                    paddingTop: "var(--s2)",
                    borderTop: "1px solid var(--line-strong)",
                  }}
                >
                  <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)" }}>{title}</div>
                  <div style={{ fontSize: 12, lineHeight: 1.5, color: "var(--text-dim)" }}>
                    {detail}
                  </div>
                </li>
              ))}
            </ol>
            <p style={{ fontSize: 12, lineHeight: 1.6, color: "var(--text-muted)" }}>
              The line is validated against TUM&apos;s published raceline and a minimum-time NLP
              reference; the browser solver is cross-checked against the Python one it was ported
              from, to 0.1 m/s.
            </p>
          </div>
        )}

        <footer
          style={{
            marginTop: "var(--s5)",
            paddingTop: "var(--s3)",
            borderTop: "1px solid var(--line)",
            fontSize: 12,
            lineHeight: 1.6,
            color: "var(--text-dim)",
          }}
        >
          Track data: TUMFTM racetrack-database (LGPL-3.0), © OpenStreetMap contributors. Elevation
          derived from OpenF1, an unofficial project unaffiliated with Formula 1. Not endorsed by or
          associated with Formula One Licensing B.V.
        </footer>
      </div>
    </div>
  );
}
