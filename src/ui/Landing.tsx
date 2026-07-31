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
        alignItems: "center",
        overflowY: "auto",
        // leaves the circuit readable on the right instead of dimming the whole frame
        background:
          "linear-gradient(100deg, var(--bg) 0%, var(--bg) 34%, color-mix(in srgb, var(--bg) 82%, transparent) 56%, transparent 88%)",
      }}
    >
      <div style={{ padding: "var(--s6) clamp(24px, 7vw, 92px)", maxWidth: 640 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            fontSize: 11,
            letterSpacing: "0.16em",
            textTransform: "uppercase",
            color: "var(--text-dim)",
          }}
        >
          <span style={{ color: "var(--accent)" }}>◆</span> track-side
        </div>

        <h1
          style={{
            margin: "var(--s3) 0 0",
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
          <Stat label={`${circuitName} lap`} value={formatLapTime(lapTimeS)} />
          <Stat label="named corners" value={String(cornerCount)} />
          <Stat label="elevation range" value={`${elevationRangeM.toFixed(0)} m`} />
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
              {STEPS.map(([title, detail], i) => (
                <li
                  key={title}
                  style={{
                    paddingTop: "var(--s2)",
                    borderTop: "2px solid var(--accent-dim)",
                  }}
                >
                  <div className="tnum" style={{ fontSize: 10, color: "var(--accent)" }}>
                    0{i + 1}
                  </div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text)" }}>{title}</div>
                  <div style={{ fontSize: 11, lineHeight: 1.5, color: "var(--text-dim)" }}>
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
            fontSize: 10,
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
