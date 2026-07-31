// the HUD: track switcher, grip slider, readouts, toggles. Plain DOM over the canvas,
// dark-telemetry styling inherited from index.html's monospace/near-black base.

import type { ColorMode } from "../render/RacingLine";
import type { TrackDefinition } from "../tracks";

interface ControlsProps {
  tracks: TrackDefinition[];
  circuitId: string;
  onCircuitChange: (id: string) => void;
  mu: number;
  onMuChange: (mu: number) => void;
  lapTimeS: number;
  solveMs: number;
  colorMode: ColorMode;
  onColorModeChange: (mode: ColorMode) => void;
  playing: boolean;
  onPlayingChange: (playing: boolean) => void;
  speedMultiplier: number;
  onSpeedMultiplierChange: (mult: number) => void;
  exaggeration: number;
  onExaggerationChange: (factor: number) => void;
  showPerf: boolean;
  onShowPerfChange: (show: boolean) => void;
  hoverInfo: { sM: number; vMps: number; axMps2: number; ayMps2: number } | null;
}

const panelStyle: React.CSSProperties = {
  position: "absolute",
  top: 12,
  left: 12,
  padding: "12px 14px",
  background: "rgba(10, 10, 15, 0.85)",
  border: "1px solid #22222e",
  borderRadius: 6,
  fontSize: 12,
  lineHeight: 1.9,
  userSelect: "none",
  width: 250,
};

const buttonStyle: React.CSSProperties = {
  background: "#16161e",
  color: "#d8d8e0",
  border: "1px solid #2c2c3a",
  borderRadius: 3,
  padding: "2px 8px",
  fontFamily: "inherit",
  fontSize: 11,
  cursor: "pointer",
};

const activeButtonStyle: React.CSSProperties = {
  ...buttonStyle,
  background: "#0e3a42",
  borderColor: "#00e5ff",
  color: "#00e5ff",
};

function formatLapTime(lapTimeS: number): string {
  const minutes = Math.floor(lapTimeS / 60);
  const seconds = lapTimeS - minutes * 60;
  return `${minutes}:${seconds.toFixed(3).padStart(6, "0")}`;
}

export function Controls(props: ControlsProps) {
  return (
    <div style={panelStyle}>
      <div style={{ fontSize: 14, color: "#fff", marginBottom: 2 }}>
        track-side <span style={{ color: "#00e5ff" }}>GT3</span>
      </div>

      <div>
        circuit{" "}
        <select
          value={props.circuitId}
          onChange={(e) => props.onCircuitChange(e.target.value)}
          style={{ ...buttonStyle, marginLeft: 6 }}
        >
          {props.tracks.map((t) => (
            <option key={t.id} value={t.id}>
              {t.displayName}
            </option>
          ))}
        </select>
      </div>

      <div>
        grip μ <b style={{ color: "#00e5ff" }}>{props.mu.toFixed(2)}</b>
        <input
          type="range"
          min={0.6}
          max={1.4}
          step={0.01}
          value={props.mu}
          onChange={(e) => props.onMuChange(parseFloat(e.target.value))}
          style={{ width: "100%", accentColor: "#00e5ff" }}
        />
      </div>

      <div>
        lap time <b style={{ color: "#fff" }}>{formatLapTime(props.lapTimeS)}</b>
        <span style={{ color: "#6a6a78" }}> · solve {props.solveMs.toFixed(1)} ms</span>
      </div>

      <div>
        colour{" "}
        <button
          style={props.colorMode === "phase" ? activeButtonStyle : buttonStyle}
          onClick={() => props.onColorModeChange("phase")}
        >
          phase
        </button>{" "}
        <button
          style={props.colorMode === "speed" ? activeButtonStyle : buttonStyle}
          onClick={() => props.onColorModeChange("speed")}
        >
          speed
        </button>
      </div>

      <div>
        lap{" "}
        <button
          style={props.playing ? activeButtonStyle : buttonStyle}
          onClick={() => props.onPlayingChange(!props.playing)}
        >
          {props.playing ? "pause" : "play"}
        </button>{" "}
        {[1, 5, 10].map((mult) => (
          <button
            key={mult}
            style={props.speedMultiplier === mult ? activeButtonStyle : buttonStyle}
            onClick={() => props.onSpeedMultiplierChange(mult)}
          >
            {mult}x
          </button>
        ))}
      </div>

      <div>
        elevation{" "}
        {[1, 3].map((factor) => (
          <button
            key={factor}
            style={props.exaggeration === factor ? activeButtonStyle : buttonStyle}
            onClick={() => props.onExaggerationChange(factor)}
          >
            {factor}x
          </button>
        ))}{" "}
        <button
          style={props.showPerf ? activeButtonStyle : buttonStyle}
          onClick={() => props.onShowPerfChange(!props.showPerf)}
        >
          perf
        </button>
      </div>

      {props.hoverInfo && (
        <div style={{ borderTop: "1px solid #22222e", marginTop: 4, color: "#9a9aa8" }}>
          s {props.hoverInfo.sM.toFixed(0)} m · v{" "}
          {(props.hoverInfo.vMps * 3.6).toFixed(0)} km/h
          <br />
          ax {props.hoverInfo.axMps2.toFixed(1)} · ay {props.hoverInfo.ayMps2.toFixed(1)} m/s²
        </div>
      )}

      <div style={{ color: "#50505c", fontSize: 10, marginTop: 4 }}>
        phase: <span style={{ color: "#2ba22b" }}>accel</span> ·{" "}
        <span style={{ color: "#d62728" }}>brake</span> ·{" "}
        <span style={{ color: "#8a8a94" }}>coast</span>
      </div>
    </div>
  );
}
