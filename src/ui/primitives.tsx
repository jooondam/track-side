// the component vocabulary the sheet is built from. Before this existed, every panel carried its
// own inline style object and its own hex values, which is why nothing lined up.
//
// The vocabulary is a run plan's, not a dashboard's: ruled rows, column heads, boxed cells and
// printed leaders. There are no cards here and no rounded corners, because paper is cut square
// and a run book has never contained either.
//
// Two disciplines are enforced in the primitives rather than at the call sites, so they cannot be
// forgotten per-component:
//   - **state is never colour alone.** A pressed control inverts to an ink fill; it does not
//     merely tint. That survives a monochrome print, a dichromat reader, and 1.4.1.
//   - **a number carries its unit and its provenance.** Stat and Field take `unit` and `note`,
//     so a bare figure has to be a deliberate omission rather than the path of least resistance.
//
// accessibility also lives here: Button emits aria-pressed when it is a toggle, IconButton demands
// a label, Slider demands a label, and the focus ring comes from the one :focus-visible rule in
// theme.ts. A component that cannot be misused does not need a review checklist.

import { forwardRef } from "react";
import type { CSSProperties, ReactNode } from "react";

/** the smallest type in the interface. 10px was below every floor the project set itself. */
const LABEL_SIZE = 12;

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
        ...style,
      }}
    >
      {children}
    </div>
  );
});

/** a printed rule. `weight` is the ink: hairline for the grid, strong for a column head. */
export function Rule({ weight = "hair" }: { weight?: "hair" | "strong" }) {
  return (
    <div
      style={{
        height: weight === "strong" ? 2 : 1,
        background: weight === "strong" ? "var(--line-strong)" : "var(--line)",
        flexShrink: 0,
      }}
    />
  );
}

export function Divider() {
  return <Rule />;
}

/** a column head: the label, a strong rule under it, then the rows. This is the run plan's own
 *  grouping device, and it replaces the bordered card the panels used to be built from. */
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
    <section style={{ padding: "var(--s3)" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "var(--s2)",
        }}
      >
        <h2
          style={{
            margin: 0,
            fontSize: LABEL_SIZE,
            fontWeight: 700,
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            color: "var(--text-muted)",
          }}
        >
          {label}
        </h2>
        {action}
      </div>
      <div style={{ marginTop: 4, marginBottom: "var(--s3)" }}>
        <Rule weight="strong" />
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--s3)" }}>{children}</div>
    </section>
  );
}

/**
 * one ruled row of the sheet: label at the left, a printed leader across the gap, value at the
 * right. The leader is what makes a column of these read as a filled-in form rather than as a
 * list of floating pairs, and it is drawn with a repeating gradient rather than dot characters so
 * it cannot be selected or read aloud.
 */
export function Field({
  label,
  value,
  unit,
  note,
  tone,
}: {
  /** Set in uppercase by CSS, so keep Greek out of it: \u03bc uppercases to \u039c, which reads as a
   *  Latin M. "vs ghost \u03bc1.20" printed as "VS GHOST M1.20". Grip belongs in `note`. */
  label: string;
  value: string;
  unit?: string;
  /** provenance: where this number came from, or what it is not */
  note?: string;
  tone?: "pos" | "neg";
}) {
  return (
    <div>
      <div style={{ display: "flex", alignItems: "baseline", gap: "var(--s2)" }}>
        <span style={{ fontSize: LABEL_SIZE, color: "var(--text-muted)", whiteSpace: "nowrap" }}>
          {label}
        </span>
        <span
          aria-hidden="true"
          style={{
            flex: 1,
            height: "1em",
            minWidth: 8,
            backgroundImage:
              "radial-gradient(circle, var(--line) 1px, transparent 1px)",
            backgroundSize: "5px 1px",
            backgroundPosition: "0 bottom 0.28em",
            backgroundRepeat: "repeat-x",
          }}
        />
        <span
          className="tnum"
          style={{
            fontSize: 14,
            fontWeight: 600,
            whiteSpace: "nowrap",
            color:
              tone === "neg" ? "var(--neg)" : tone === "pos" ? "var(--pos)" : "var(--text)",
          }}
        >
          {value}
          {unit && (
            <span style={{ fontSize: LABEL_SIZE, fontWeight: 400, color: "var(--text-muted)" }}>
              {" "}
              {unit}
            </span>
          )}
        </span>
      </div>
      {note && (
        <div style={{ fontSize: LABEL_SIZE, color: "var(--text-dim)", marginTop: 2 }}>{note}</div>
      )}
    </div>
  );
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
        minHeight: size === "md" ? 40 : 28,
        padding: size === "md" ? "0 var(--s5)" : "0 var(--s3)",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: "var(--s1)",
        // a selected cell on a sheet is inked in, not tinted. The inversion is the state, so the
        // control still reads as chosen in monochrome and to a dichromat.
        background: primary || on ? "var(--text)" : "transparent",
        color: primary || on ? "var(--panel)" : "var(--text-muted)",
        border: `1px solid ${primary || on ? "var(--text)" : "var(--line)"}`,
        fontSize: size === "md" ? 14 : 12,
        fontWeight: primary || on ? 600 : 500,
        letterSpacing: "0.01em",
        whiteSpace: "nowrap",
        transition:
          "background var(--t-fast) var(--ease), color var(--t-fast) var(--ease), border-color var(--t-fast) var(--ease)",
        ...style,
      }}
    >
      {children}
    </button>
  );
});

/** segmented control: cells butted against each other, sharing one rule, as printed boxes are. */
export function ButtonGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div
      role="group"
      aria-label={label}
      style={{ display: "flex", gap: 0, flexWrap: "wrap", marginLeft: -1 }}
    >
      {children}
    </div>
  );
}

/**
 * an independent boolean, drawn as a ticked box on a form.
 *
 * This exists because the critique found mutually-exclusive choices and independent switches
 * rendering as the identical control, so nothing on screen said which ones could be on together.
 * A segmented Button is the radio; this is the checkbox, and it never fills its whole row, so a
 * section with three things switched on no longer reads as three alarms.
 */
export function Check({
  label,
  checked,
  onChange,
  note,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  note?: string;
}) {
  return (
    <label
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: "var(--s2)",
        minHeight: 24,
        cursor: "pointer",
        fontSize: 13,
        color: "var(--text)",
      }}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        style={{
          width: 14,
          height: 14,
          marginTop: 2,
          accentColor: "var(--text)",
          flexShrink: 0,
        }}
      />
      <span style={{ display: "flex", flexDirection: "column", gap: 1 }}>
        <span>{label}</span>
        {note && <span style={{ fontSize: 12, color: "var(--text-dim)" }}>{note}</span>}
      </span>
    </label>
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
        width: 28,
        height: 28,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        background: active ? "var(--text)" : "transparent",
        color: active ? "var(--panel)" : "var(--text-muted)",
        border: `1px solid ${active ? "var(--text)" : "var(--line)"}`,
        fontSize: 13,
        lineHeight: 1,
        transition: "background var(--t-fast) var(--ease), color var(--t-fast) var(--ease)",
      }}
    >
      {children}
    </button>
  );
}

/**
 * a labelled range. The visible label is the accessible name, so no aria-label is needed.
 * The value sets at display scale because grip is one of the two numbers this whole interface
 * exists to move; a 13px readout made the product's primary input look incidental.
 */
export function Slider({
  label,
  value,
  min,
  max,
  step,
  onChange,
  format,
  unit,
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
  unit?: string;
  onPointerDown?: () => void;
  onPointerUp?: () => void;
}) {
  const id = `slider-${label.replace(/\W+/g, "-").toLowerCase()}`;
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <label htmlFor={id} style={{ fontSize: LABEL_SIZE, color: "var(--text-muted)" }}>
          {label}
        </label>
        <span
          className="tnum"
          style={{ fontSize: 22, color: "var(--text)", fontWeight: 600, lineHeight: 1.1 }}
        >
          {format ? format(value) : value}
          {unit && (
            <span style={{ fontSize: LABEL_SIZE, fontWeight: 400, color: "var(--text-muted)" }}>
              {" "}
              {unit}
            </span>
          )}
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
        style={{ width: "100%", accentColor: "var(--accent)", marginTop: "var(--s1)" }}
      />
    </div>
  );
}

/**
 * label above, tabular value below.
 *
 * `trend` is the donated discipline from the instrument panel it beat: a gauge that shows only a
 * value tells you where you are and not where you are going, so a Stat may carry the direction of
 * travel alongside the number. `note` carries provenance, and the delta is never colour-only
 * because it always carries its own sign.
 */
export function Stat({
  label,
  value,
  unit,
  delta,
  deltaTone,
  trend,
  note,
  size = "md",
}: {
  /** Set in uppercase by CSS, so keep Greek out of it: \u03bc uppercases to \u039c, which reads as a
   *  Latin M. "vs ghost \u03bc1.20" printed as "VS GHOST M1.20". Grip belongs in `note`. */
  label: string;
  value: string;
  unit?: string;
  delta?: string;
  deltaTone?: "pos" | "neg";
  /** direction of travel, drawn as a mark rather than stated as a colour */
  trend?: "up" | "down" | "flat";
  /** where this number came from, or what it is not */
  note?: string;
  size?: "sm" | "md" | "lg" | "xl";
}) {
  const valueSize = size === "xl" ? 40 : size === "lg" ? 26 : size === "md" ? 18 : 14;
  return (
    <div>
      <div
        style={{
          fontSize: LABEL_SIZE,
          letterSpacing: "0.09em",
          textTransform: "uppercase",
          color: "var(--text-muted)",
        }}
      >
        {label}
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: "var(--s2)" }}>
        <span
          className="tnum"
          style={{
            fontSize: valueSize,
            color: "var(--text)",
            fontWeight: size === "xl" ? 700 : 500,
            lineHeight: 1.15,
            letterSpacing: size === "xl" ? "-0.02em" : 0,
          }}
        >
          {value}
          {unit && (
            <span style={{ fontSize: LABEL_SIZE, fontWeight: 400, color: "var(--text-muted)" }}>
              {" "}
              {unit}
            </span>
          )}
        </span>
        {trend && (
          <span aria-hidden="true" style={{ fontSize: LABEL_SIZE, color: "var(--text-muted)" }}>
            {trend === "up" ? "▲" : trend === "down" ? "▼" : "—"}
          </span>
        )}
        {delta && (
          <span
            className="tnum"
            style={{
              fontSize: 13,
              fontWeight: 600,
              color:
                deltaTone === "neg"
                  ? "var(--neg)"
                  : deltaTone === "pos"
                    ? "var(--pos)"
                    : "var(--text-muted)",
            }}
          >
            {delta}
          </span>
        )}
      </div>
      {note && (
        <div style={{ fontSize: LABEL_SIZE, color: "var(--text-dim)", marginTop: 2 }}>{note}</div>
      )}
    </div>
  );
}

/**
 * A signed delta in seconds, under the interface's one convention: negative is quicker (see
 * deltaToGhost). The sign is always written, since colour alone is not an accessible signal, and
 * the minus is U+2212 rather than a hyphen so it sits at digit width in tabular figures.
 *
 * Exact zero prints unsigned. A coincident ghost is not "slower by nothing", and printing +0.00
 * invites the reader to look for a difference that is not there.
 */
export function formatDeltaS(seconds: number, digits = 2): string {
  const rounded = Number(seconds.toFixed(digits));
  if (rounded === 0) return `${(0).toFixed(digits)} s`;
  return `${rounded < 0 ? "\u2212" : "+"}${Math.abs(rounded).toFixed(digits)} s`;
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd
      style={{
        display: "inline-block",
        minWidth: 18,
        padding: "1px 5px",
        background: "transparent",
        border: "1px solid var(--line-strong)",
        fontFamily: "var(--font-mono)",
        fontSize: 12,
        color: "var(--text)",
        textAlign: "center",
      }}
    >
      {children}
    </kbd>
  );
}

/** a labelled <select> drawn as a filled-in field rather than as a styled control. */
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
      <label
        htmlFor={id}
        className={hideLabel ? "sr-only" : undefined}
        style={{ fontSize: LABEL_SIZE, color: "var(--text-muted)" }}
      >
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
          background: "transparent",
          border: "1px solid var(--line)",
          color: "var(--text)",
          fontSize: 14,
          fontWeight: 500,
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
