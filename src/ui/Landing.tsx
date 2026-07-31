// landing overlay: the first thing a visitor (or interviewer) sees. Explains what the tool
// is, what the physics underneath is doing, and how to drive it -- then gets out of the way.
// The scene loads behind it, so entering is instant.

interface LandingProps {
  onEnter: () => void;
}

const overlayStyle: React.CSSProperties = {
  position: "absolute",
  inset: 0,
  zIndex: 10,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  background: "rgba(10, 10, 15, 0.92)",
  backdropFilter: "blur(4px)",
};

const panelStyle: React.CSSProperties = {
  maxWidth: 620,
  margin: 20,
  padding: "36px 42px",
  background: "#0e0e14",
  border: "1px solid #22222e",
  borderRadius: 8,
  fontSize: 13,
  lineHeight: 1.75,
};

const kbdStyle: React.CSSProperties = {
  background: "#16161e",
  border: "1px solid #2c2c3a",
  borderRadius: 3,
  padding: "0 6px",
  color: "#00e5ff",
};

export function Landing({ onEnter }: LandingProps) {
  return (
    <div style={overlayStyle}>
      <div style={panelStyle}>
        <div style={{ fontSize: 26, color: "#fff", marginBottom: 2 }}>
          track-side <span style={{ color: "#00e5ff" }}>GT3</span>
        </div>
        <div style={{ color: "#6a6a78", marginBottom: 18 }}>
          racing line optimizer · Spa-Francorchamps &amp; Monza
        </div>

        <p style={{ color: "#b8b8c4" }}>
          The racing line you see was computed offline by a minimum-curvature QP over real
          circuit geometry, validated against TUM&apos;s published raceline and a
          minimum-time NLP reference. The 3D circuits are real too: elevation comes from 2023
          F1 car telemetry (OpenF1), registered onto the track and verified against each
          circuit&apos;s documented profile — Eau Rouge climbs ~40 m here because it does in
          Belgium.
        </p>
        <p style={{ color: "#b8b8c4" }}>
          The physics is live. Drag the <span style={kbdStyle}>grip μ</span> slider and a
          velocity-profile solver — the same forward-backward algorithm as the offline
          pipeline, ported to TypeScript and cross-validated against it — re-solves the whole
          lap in your browser in a few milliseconds. Braking points move, corner speeds
          change, the lap time updates, and the car marker drives it all at the solved speed.
        </p>

        <div style={{ color: "#9a9aa8", margin: "16px 0" }}>
          <span style={kbdStyle}>drag</span> orbit · <span style={kbdStyle}>scroll</span> zoom
          · <span style={kbdStyle}>hover the line</span> speed probe ·{" "}
          <span style={kbdStyle}>3x</span> exaggerate elevation
        </div>

        <button
          onClick={onEnter}
          style={{
            background: "#0e3a42",
            color: "#00e5ff",
            border: "1px solid #00e5ff",
            borderRadius: 4,
            padding: "10px 28px",
            fontFamily: "inherit",
            fontSize: 14,
            cursor: "pointer",
          }}
        >
          enter the circuit
        </button>

        <div style={{ color: "#50505c", fontSize: 10, marginTop: 18 }}>
          Track data: TUMFTM racetrack-database (LGPL-3.0), © OpenStreetMap contributors.
          Elevation derived from OpenF1, an unofficial project unaffiliated with Formula 1.
          Not endorsed by or associated with Formula One Licensing B.V.
        </div>
      </div>
    </div>
  );
}
