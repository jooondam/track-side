// the braking report: where the car goes to the brakes for each corner, against the boards a
// driver reads on the way in.
//
// This is the one thing the project produces that transfers to actually driving the circuit,
// and it is also the one most exposed to how the boards were placed. Both facts are printed in
// the header rather than left for a reader to work out, because a table of two-decimal numbers
// reads as a survey unless it says otherwise.
//
// The columns, and the decision each one changes:
//
//   board      which board the braking point falls nearest, in the driver's own units
//   delta      metres past that board, positive for later. This is the number you drive to
//   zone       how long the braking event is, which is what changes when grip changes
//   peak       the hardest point of the stop, in g
//   v in       speed at the moment the pedal goes down
//   axle       which axle reaches its friction circle first at that peak, straight from the M8
//              load model. It is the column that makes the two-axle physics visible
//   spare      what the other axle still has at that same instant. Without it `axle` is a
//              constant: the shipped GT3 is front limited at every corner of both circuits at
//              every grip the slider offers, and the interesting number is how much the rear is
//              not using
//   vs mu      how far the braking point moves against a solve at the reference grip. This is
//              the row's strongest number: both solves read the same boards, so the difference
//              between them is exact however wrong the boards themselves are
//
// v at the apex is deliberately not here: it is the corners tab's column, and printing it twice
// would be two answers to one question the first time the definitions drifted.

import { useMemo } from "react";
import type { Corner, LineData } from "../assets";
import { brakingPoints, brakingShift, largestShift } from "../solver/brakingPoints";
import type { VelocityProfileResult } from "../solver/velocity";
import { MU } from "./primitives";
import { TYPE } from "./theme";

interface BrakingReportProps {
  line: LineData;
  result: VelocityProfileResult;
  referenceResult: VelocityProfileResult | null;
  corners: Corner[];
  mu: number;
  ghostMu: number;
  onCornerSelect: (corner: Corner) => void;
}

export function BrakingReport({
  line,
  result,
  referenceResult,
  corners,
  mu,
  ghostMu,
  onCornerSelect,
}: BrakingReportProps) {
  const points = useMemo(
    () => brakingPoints(line, result, corners),
    [line, result, corners],
  );
  const shifts = useMemo(() => {
    if (!referenceResult) return null;
    return brakingShift(points, brakingPoints(line, referenceResult, corners), line.loopLengthM);
  }, [points, line, referenceResult, corners]);
  // a headline needs two different grip levels to compare. The slider opens at the reference
  // grip itself, so at rest there is genuinely nothing to say, and saying so is better than
  // printing "0 m later" as though that were a result.
  const comparable = shifts !== null && Math.abs(mu - ghostMu) > 1e-9;
  const headline = comparable ? largestShift(shifts!) : null;
  const shiftById = useMemo(
    () => new Map((shifts ?? []).map((s) => [s.corner.id, s.shiftM])),
    [shifts],
  );

  const th: React.CSSProperties = {
    textAlign: "right",
    fontWeight: TYPE.weight.medium,
    fontSize: TYPE.size.label,
    letterSpacing: TYPE.track.label,
    textTransform: "uppercase",
    color: "var(--text-dim)",
    padding: "0 var(--s2) 3px",
    position: "sticky",
    top: 0,
    background: "var(--panel)",
  };
  const td: React.CSSProperties = {
    textAlign: "right",
    padding: "2px var(--s2)",
    color: "var(--text-muted)",
    fontVariantNumeric: "tabular-nums",
    fontFamily: "var(--font-mono)",
    fontSize: TYPE.size.label,
  };
  const unit = { color: "var(--text-dim)", fontWeight: TYPE.weight.regular };

  return (
    <div style={{ overflow: "auto", height: "100%", minWidth: 0 }}>
      <p
        data-braking-lead=""
        style={{
          margin: 0,
          padding: "0 var(--s2) var(--s2)",
          fontSize: TYPE.size.label,
          lineHeight: 1.45,
          color: "var(--text-dim)",
          maxWidth: "72ch",
        }}
      >
        {headline && (
          <>
            <strong style={{ color: "var(--text)", fontWeight: TYPE.weight.medium }}>
              At {MU}
              {mu.toFixed(2)} the car brakes {Math.abs(headline.shiftM).toFixed(0)} m{" "}
              {headline.shiftM >= 0 ? "later" : "earlier"} into {headline.corner.name} than at{" "}
              {MU}
              {ghostMu.toFixed(2)}.
            </strong>{" "}
          </>
        )}
        {shifts !== null && !comparable && (
          <>
            <strong style={{ color: "var(--text)", fontWeight: TYPE.weight.medium }}>
              The slider is at the reference grip of {MU}
              {mu.toFixed(2)}, so there is nothing to compare it against yet. Drag it.
            </strong>{" "}
          </>
        )}
        Boards sit their own distance before a turn-in measured from the generated line, not
        surveyed, so read the board columns as plus or minus 10 m. The last column carries none
        of that: both solves see the same boards.
      </p>

      <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 580 }}>
        <caption className="sr-only">
          Per corner braking point: the nearest board, metres past it, the length of the braking
          zone, peak deceleration, entry speed, the axle that limits it, the grip the other axle
          has left, and how far the point moves against a solve at the reference grip.
        </caption>
        <thead>
          <tr>
            <th scope="col" style={{ ...th, textAlign: "left" }}>
              Corner
            </th>
            <th scope="col" style={th}>
              board <span style={unit}>m</span>
            </th>
            <th scope="col" style={th}>
              delta <span style={unit}>m</span>
            </th>
            <th scope="col" style={th}>
              zone <span style={unit}>m</span>
            </th>
            <th scope="col" style={th}>
              peak <span style={unit}>g</span>
            </th>
            <th scope="col" style={th}>
              v in <span style={unit}>km/h</span>
            </th>
            <th scope="col" style={th}>
              axle
            </th>
            <th scope="col" style={th}>
              spare <span style={unit}>%</span>
            </th>
            <th scope="col" style={th}>
              {/* the column head is uppercased, and CSS uppercases U+00B5 into U+039C: a Greek
                  capital mu, which reads as a Latin M and falls outside Archivo's latin subset
                  into the fallback face. The grip symbol opts out of the transform. */}
              vs <span style={{ textTransform: "none" }}>{MU}{ghostMu.toFixed(2)}</span>{" "}
              <span style={unit}>m</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {points.map((point) => {
            const shift = shiftById.get(point.corner.id);
            return (
              <tr
                key={point.corner.id}
                onClick={() => onCornerSelect(point.corner)}
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onCornerSelect(point.corner);
                  }
                }}
                style={{ cursor: "pointer", borderTop: "1px solid var(--line)" }}
                title={`Fly the camera to ${point.corner.name}`}
              >
                <td style={{ ...td, textAlign: "left", color: "var(--text)" }}>
                  {point.corner.name}
                </td>
                <td style={td}>{point.board === null ? "–" : point.board.distanceM.toFixed(0)}</td>
                <td style={{ ...td, color: "var(--text)" }}>
                  {point.boardDeltaM === null ? "–" : formatMetres(point.boardDeltaM)}
                </td>
                <td style={td}>{point.brakingDistanceM.toFixed(0)}</td>
                <td style={td}>{point.peakDecelG.toFixed(2)}</td>
                <td style={td}>{point.vEntryKph.toFixed(0)}</td>
                <td style={td}>{point.limiting}</td>
                <td style={td}>{(point.spareGripFrac * 100).toFixed(0)}</td>
                <td style={{ ...td, color: shift === undefined ? "var(--text-dim)" : "var(--text)" }}>
                  {shift === undefined ? "–" : formatMetres(shift)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {points.length < corners.length && (
        <p
          style={{
            margin: 0,
            padding: "var(--s2)",
            fontSize: TYPE.size.label,
            color: "var(--text-dim)",
          }}
        >
          {joinNames(
            corners.filter((c) => !points.some((p) => p.corner.id === c.id)).map((c) => c.name),
          )}{" "}
          {points.length === corners.length - 1 ? "is" : "are"} taken without braking at {MU}
          {mu.toFixed(2)}.
        </p>
      )}
    </div>
  );
}

/** a list a person would read aloud, so the flat-out note is a sentence and not a CSV row. */
function joinNames(names: string[]): string {
  if (names.length < 2) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** metres with an explicit sign, because the sign is the whole content of these columns. */
function formatMetres(metres: number): string {
  const rounded = Math.round(metres);
  return rounded > 0 ? `+${rounded}` : String(rounded);
}
