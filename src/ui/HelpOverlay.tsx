// the controls cheat sheet, as a real dialog: Escape closes it, a backdrop click closes it,
// focus is trapped inside while it is open, and focus returns to whatever opened it. The old
// version was a floating div that could not be dismissed with the keyboard at all.

import { useEffect, useRef } from "react";
import { Button, Kbd, Panel } from "./primitives";
import { TYPE } from "./theme";

const GROUPS: { title: string; rows: [string[], string][] }[] = [
  {
    title: "Camera",
    rows: [
      [["drag"], "orbit"],
      [["scroll"], "zoom"],
      [["W", "A", "S", "D"], "pan, hold shift to hurry"],
      [["Q", "E"], "drop / raise"],
      [["double-click"], "fly to that point"],
      [["[", "]"], "previous / next viewpoint"],
    ],
  },
  {
    title: "Playback",
    rows: [
      [["space"], "play or pause"],
      [["←", "→"], "nudge the car along the lap"],
      [["drag a chart"], "scrub to anywhere"],
    ],
  },
  {
    title: "Reading it",
    rows: [
      [["hover the line"], "speed and g at that point"],
      [["a corner tick"], "fly to that corner"],
      [["?"], "open or close this guide"],
    ],
  },
];

export function HelpOverlay({ open, onClose }: { open: boolean; onClose: () => void }) {
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreTo = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    restoreTo.current = document.activeElement as HTMLElement | null;
    const focusables = () =>
      Array.from(
        panelRef.current?.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      );
    focusables()[0]?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      const items = focusables();
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      // wrap at both ends so tab can never escape the dialog
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      restoreTo.current?.focus();
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      onClick={onClose}
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 40,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(0, 0, 0, 0.5)",
      }}
    >
      <Panel
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="help-title"
        onClick={(e) => e.stopPropagation()}
        style={{ width: 520, maxWidth: "calc(100vw - 32px)", padding: "var(--s5)" }}
      >
        <div style={{ display: "flex", alignItems: "baseline", marginBottom: "var(--s4)" }}>
          <h2 id="help-title" style={{ margin: 0, fontSize: TYPE.size.value, fontWeight: 600 }}>
            Controls
          </h2>
          <div style={{ flex: 1 }} />
          <Button onClick={onClose}>close</Button>
        </div>

        <div style={{ display: "grid", gap: "var(--s4)" }}>
          {GROUPS.map((g) => (
            <div key={g.title}>
              <h3
                style={{
                  margin: "0 0 var(--s2)",
                  fontSize: TYPE.size.label,
                  fontWeight: 600,
                  letterSpacing: TYPE.track.label,
                  textTransform: "uppercase",
                  color: "var(--text-dim)",
                }}
              >
                {g.title}
              </h3>
              <dl style={{ margin: 0, display: "grid", gridTemplateColumns: "160px 1fr", rowGap: 6 }}>
                {g.rows.map(([keys, action]) => (
                  <div key={action} style={{ display: "contents" }}>
                    <dt style={{ display: "flex", gap: 3, flexWrap: "wrap" }}>
                      {keys.map((k) => (
                        <Kbd key={k}>{k}</Kbd>
                      ))}
                    </dt>
                    <dd style={{ margin: 0, fontSize: TYPE.size.label, color: "var(--text-muted)" }}>{action}</dd>
                  </div>
                ))}
              </dl>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}
