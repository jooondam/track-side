// the component vocabulary the HUD is built from. Before this existed, every panel carried its
// own inline style object and its own hex values, which is why nothing lined up.
//
// accessibility lives here rather than in the call sites: Button emits aria-pressed when it is a
// toggle, IconButton demands a label, Slider demands a label, and the focus ring comes from the
// one :focus-visible rule in theme.ts. A component that cannot be misused does not need a review
// checklist.

import { forwardRef } from "react";
import type { CSSProperties, ReactNode } from "react";

// forwards its ref so HelpOverlay can query it for a focus trap
export const Panel = forwardRef<
  HTMLDivElement,
  { children: ReactNode; style?: CSSProperties } & React.HTMLAttributes<HTMLDivElement>
>(function Panel({ children, style, ...rest }, ref) {
  return (
    <div
      ref={ref}
      {...rest}
      style={{
        background: "var(--panel)",
        border: "1px solid var(--line)",
        borderRadius: "var(--radius-lg)",
        ...style,
      }}
    >
      {children}
    </div>
  );
});

/** a labelled group with a hairline rule. The label is the only uppercase text in the UI. */
export function Section({
  label,
  children,
  action,
}: {
  label: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <section style={{ padding: "var(--s3) var(--s3) var(--s3)" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "var(--s2)",
          marginBottom: "var(--s2)",
        }}
      >
        <h2
          style={{
            margin: 0,
            fontSize: 10,
            fontWeight: 600,
            letterSpacing: "0.09em",
            textTransform: "uppercase",
            color: "var(--text-dim)",
          }}
        >
          {label}
        </h2>
        {action}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--s2)" }}>{children}</div>
    </section>
  );
}

export function Divider() {
  return <div style={{ height: 1, background: "var(--line)", flexShrink: 0 }} />;
}

interface ButtonProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  children: ReactNode;
  /** present => this is a toggle, and aria-pressed is emitted */
  active?: boolean;
  variant?: "default" | "primary" | "quiet";
  size?: "sm" | "md";
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { children, active, variant = "default", size = "sm", style, ...rest },
  ref,
) {
  const primary = variant === "primary";
  const on = active === true;
  return (
    <button
      ref={ref}
      {...rest}
      aria-pressed={active === undefined ? undefined : on}
      style={{
        // 24px is the WCAG 2.2 target-size minimum; primaries get 40
        minHeight: size === "md" ? 40 : 26,
        padding: size === "md" ? "0 var(--s5)" : "0 var(--s2)",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: "var(--s1)",
        background: primary
          ? "var(--accent)"
          : on
            ? "var(--accent-dim)"
            : variant === "quiet"
              ? "transparent"
              : "var(--panel-raised)",
        color: primary ? "var(--accent-contrast)" : on ? "var(--accent-on)" : "var(--text-muted)",
        border: `1px solid ${primary ? "var(--accent)" : on ? "var(--accent)" : "var(--line)"}`,
        borderRadius: "var(--radius-md)",
        fontSize: size === "md" ? 13 : 11,
        fontWeight: primary ? 600 : 500,
        letterSpacing: primary ? "0.02em" : 0,
        whiteSpace: "nowrap",
        transition: "background var(--t-fast) var(--ease), color var(--t-fast) var(--ease), border-color var(--t-fast) var(--ease)",
        ...style,
      }}
    >
      {children}
    </button>
  );
});

/** segmented control. role=group so assistive tech reads the buttons as one control. */
export function ButtonGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div role="group" aria-label={label} style={{ display: "flex", gap: 2, flexWrap: "wrap" }}>
      {children}
    </div>
  );
}

export function IconButton({
  label,
  children,
  active,
  ...rest
}: { label: string; children: ReactNode; active?: boolean } & Omit<
  React.ButtonHTMLAttributes<HTMLButtonElement>,
  "children" | "aria-label"
>) {
  return (
    <button
      {...rest}
      aria-label={label}
      title={label}
      aria-pressed={active === undefined ? undefined : active}
      style={{
        width: 30,
        height: 30,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        background: active ? "var(--accent-dim)" : "transparent",
        color: active ? "var(--accent-on)" : "var(--text-muted)",
        border: `1px solid ${active ? "var(--accent)" : "var(--line)"}`,
        borderRadius: "var(--radius-md)",
        fontSize: 13,
        lineHeight: 1,
        transition: "background var(--t-fast) var(--ease), color var(--t-fast) var(--ease)",
      }}
    >
      {children}
    </button>
  );
}

/** a labelled range. The visible label is the accessible name, so no aria-label is needed. */
export function Slider({
  label,
  value,
  min,
  max,
  step,
  onChange,
  format,
  onPointerDown,
  onPointerUp,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  format?: (v: number) => string;
  onPointerDown?: () => void;
  onPointerUp?: () => void;
}) {
  const id = `slider-${label.replace(/\W+/g, "-").toLowerCase()}`;
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <label htmlFor={id} style={{ fontSize: 12, color: "var(--text-muted)" }}>
          {label}
        </label>
        <span className="tnum" style={{ fontSize: 13, color: "var(--accent)", fontWeight: 600 }}>
          {format ? format(value) : value}
        </span>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        style={{ width: "100%", accentColor: "var(--accent)", marginTop: 2 }}
      />
    </div>
  );
}

/** label above, tabular value below. The delta is never colour-only: it carries its own sign. */
export function Stat({
  label,
  value,
  delta,
  deltaTone,
  size = "md",
}: {
  label: string;
  value: string;
  delta?: string;
  deltaTone?: "pos" | "neg";
  size?: "sm" | "md" | "lg";
}) {
  const valueSize = size === "lg" ? 26 : size === "md" ? 17 : 13;
  return (
    <div>
      <div
        style={{
          fontSize: 10,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: "var(--text-dim)",
        }}
      >
        {label}
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: "var(--s2)" }}>
        <span
          className="tnum"
          style={{ fontSize: valueSize, color: "var(--text)", fontWeight: 500, lineHeight: 1.25 }}
        >
          {value}
        </span>
        {delta && (
          <span
            className="tnum"
            style={{
              fontSize: 12,
              color: deltaTone === "neg" ? "var(--neg)" : deltaTone === "pos" ? "var(--pos)" : "var(--text-muted)",
            }}
          >
            {delta}
          </span>
        )}
      </div>
    </div>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd
      style={{
        display: "inline-block",
        minWidth: 18,
        padding: "1px 5px",
        background: "var(--panel-raised)",
        border: "1px solid var(--line-strong)",
        borderRadius: "var(--radius-sm)",
        fontFamily: "var(--font-mono)",
        fontSize: 11,
        color: "var(--text)",
        textAlign: "center",
      }}
    >
      {children}
    </kbd>
  );
}

/** a labelled <select> styled to match Button. The visible label is the accessible name. */
export function Select({
  label,
  value,
  options,
  onChange,
  hideLabel,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
  hideLabel?: boolean;
}) {
  const id = `select-${label.replace(/\W+/g, "-").toLowerCase()}`;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: "var(--s2)", minWidth: 0 }}>
      <label htmlFor={id} className={hideLabel ? "sr-only" : undefined} style={{ fontSize: 12, color: "var(--text-muted)" }}>
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          minHeight: 28,
          maxWidth: 240,
          padding: "0 var(--s2)",
          background: "var(--panel-raised)",
          border: "1px solid var(--line)",
          borderRadius: "var(--radius-md)",
          color: "var(--text)",
          fontSize: 13,
        }}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </span>
  );
}
