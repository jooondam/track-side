// the controls cheat sheet: a persistent "?" chip, expanded panel on click or the ? key.

import { useEffect, useState } from "react";

const ROWS: [string, string][] = [
  ["drag", "orbit camera"],
  ["scroll", "zoom"],
  ["W A S D", "pan (shift: faster)"],
  ["Q / E", "height down / up"],
  ["double-click", "focus point"],
  ["1 / 2 / 3", "free / follow / top camera"],
  ["space", "play / pause"],
  ["?", "toggle this guide"],
];

export function HelpOverlay() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "SELECT" || t.tagName === "TEXTAREA")) return;
      if (e.key === "?") setOpen((o) => !o);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div style={{ position: "absolute", left: 12, bottom: 12, userSelect: "none" }}>
      {open && (
        <div
          style={{
            marginBottom: 8,
            padding: "10px 14px",
            background: "rgba(10, 10, 15, 0.9)",
            border: "1px solid #22222e",
            borderRadius: 6,
            fontSize: 11,
            lineHeight: 1.8,
          }}
        >
          {ROWS.map(([key, action]) => (
            <div key={key}>
              <span style={{ color: "#00e5ff", display: "inline-block", width: 96 }}>{key}</span>
              <span style={{ color: "#9a9aa8" }}>{action}</span>
            </div>
          ))}
        </div>
      )}
      <button
        onClick={() => setOpen((o) => !o)}
        style={{
          width: 28,
          height: 28,
          background: "rgba(10, 10, 15, 0.85)",
          color: open ? "#00e5ff" : "#9a9aa8",
          border: `1px solid ${open ? "#00e5ff" : "#2c2c3a"}`,
          borderRadius: 14,
          fontFamily: "inherit",
          fontSize: 13,
          cursor: "pointer",
        }}
      >
        ?
      </button>
    </div>
  );
}
