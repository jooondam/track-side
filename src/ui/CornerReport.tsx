// the corner report: one row per named corner, the numbers an engineer would write on a run sheet.
//
// Everything here is derived from channels the solver already produces, so this costs one pass
// over the lap and no new physics. The columns are chosen because each one changes a different
// decision:
//
//   v min      the corner's defining number. Where the car is slowest is where the lap is won.
//   v entry    speed at turn-in, which together with v min is the size of the braking event.
//   v exit     speed at the corner's exit, which is what the next straight inherits. A corner
//              that is fast in isolation but slow on exit costs time you pay for further on.
//   time       seconds spent in the corner window, so a slow corner can be compared against a
//              long one rather than against a feeling.
//   delta      time gained or lost against the ghost across just this corner. This is the column
//              that turns a lap time into a to-do list.
//
// The corner window runs from turn-in to the same distance past the apex, which is a definition
// rather than a measurement: the data has an authored turn-in and an authored apex and nothing
// that marks an exit. Symmetric is the honest choice, and it is stated here rather than hidden
// so nobody reads "time in corner" as more precise than it is.

import { useMemo } from "react";
import type { Corner, LineData } from "../assets";
import { formatDeltaS } from "./primitives";
import type { LapTimeTable } from "../solver/lapTime";
import { deltaToGhost, timeAtS } from "../solver/lapTime";
import type { VelocityProfileResult } from "../solver/velocity";

interface CornerReportProps {
  line: LineData;
  result: VelocityProfileResult;
  table: LapTimeTable;
  ghostTable: LapTimeTable | null;
  corners: Corner[];
  onCornerSelect: (corner: Corner) => void;
}

interface Row {
  corner: Corner;
  vMinKph: number;
  vEntryKph: number;
  vExitKph: number;
  timeS: number;
  deltaS: number | null;
}

/** index of the line point nearest an arc length. */
function indexAtS(line: LineData, s: number): number {
  const loop = line.loopLengthM;
  const q = ((s % loop) + loop) % loop;
  return Math.min(Math.max(Math.round((q / loop) * (line.nPoints - 1)), 0), line.nPoints - 1);
}

function buildRows(
  line: LineData,
  result: VelocityProfileResult,
  table: LapTimeTable,
  ghostTable: LapTimeTable | null,
  corners: Corner[],
): Row[] {
  const loop = line.loopLengthM;
  return corners.map((corner) => {
    const entryS = corner.turnInSM;
    // symmetric window: as far past the apex as turn-in is before it. See the module note.
    const reach = ((corner.sM - entryS) % loop + loop) % loop;
    const exitS = (corner.sM + reach) % loop;

    const i0 = indexAtS(line, entryS);
    const i1 = indexAtS(line, exitS);

    let vMin = Infinity;
    // walk forward with a wrap, so a corner spanning s = 0 is not scanned backwards over the lap
    const steps = (i1 - i0 + line.nPoints) % line.nPoints;
    for (let k = 0; k <= steps; k++) {
      const i = (i0 + k) % line.nPoints;
      vMin = Math.min(vMin, result.vMps[i]);
    }

    const carTime = ((timeAtS(table, line.sM, exitS) - timeAtS(table, line.sM, entryS)) + table.lapTimeS) % table.lapTimeS;
    const ghostTime = ghostTable
      ? ((timeAtS(ghostTable, line.sM, exitS) - timeAtS(ghostTable, line.sM, entryS)) +
          ghostTable.lapTimeS) %
        ghostTable.lapTimeS
      : null;
    const deltaS = ghostTime === null ? null : deltaToGhost(carTime, ghostTime);

    return {
      corner,
      vMinKph: vMin * 3.6,
      vEntryKph: result.vMps[i0] * 3.6,
      vExitKph: result.vMps[i1] * 3.6,
      timeS: carTime,
      deltaS,
    };
  });
}

export function CornerReport({
  line,
  result,
  table,
  ghostTable,
  corners,
  onCornerSelect,
}: CornerReportProps) {
  const rows = useMemo(
    () => buildRows(line, result, table, ghostTable, corners),
    [line, result, table, ghostTable, corners],
  );

  const th: React.CSSProperties = {
    textAlign: "right",
    fontWeight: 500,
    fontSize: 12,
    letterSpacing: "0.06em",
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
    fontSize: 12,
  };

  return (
    <div style={{ overflow: "auto", height: "100%", minWidth: 0 }}>
      <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 380 }}>
        <caption className="sr-only">
          Per corner minimum, entry and exit speed, time in the corner, and delta to the ghost, where negative is quicker.
        </caption>
        <thead>
          <tr>
            <th scope="col" style={{ ...th, textAlign: "left" }}>
              Corner
            </th>
            <th scope="col" style={th}>
              v min <span style={{ color: "var(--text-dim)", fontWeight: 400 }}>km/h</span>
            </th>
            <th scope="col" style={th}>
              entry <span style={{ color: "var(--text-dim)", fontWeight: 400 }}>km/h</span>
            </th>
            <th scope="col" style={th}>
              exit <span style={{ color: "var(--text-dim)", fontWeight: 400 }}>km/h</span>
            </th>
            <th scope="col" style={th}>
              time <span style={{ color: "var(--text-dim)", fontWeight: 400 }}>s</span>
            </th>
            <th scope="col" style={th}>
              delta <span style={{ color: "var(--text-dim)", fontWeight: 400 }}>s</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.corner.id}
              onClick={() => onCornerSelect(row.corner)}
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onCornerSelect(row.corner);
                }
              }}
              style={{ cursor: "pointer", borderTop: "1px solid var(--line)" }}
              title={`Fly the camera to ${row.corner.name}`}
            >
              <td style={{ ...td, textAlign: "left", color: "var(--text)" }}>{row.corner.name}</td>
              <td style={{ ...td, color: "var(--text)" }}>{row.vMinKph.toFixed(0)}</td>
              <td style={td}>{row.vEntryKph.toFixed(0)}</td>
              <td style={td}>{row.vExitKph.toFixed(0)}</td>
              <td style={td}>{row.timeS.toFixed(2)}</td>
              <td
                style={{
                  ...td,
                  color:
                    row.deltaS === null
                      ? "var(--text-dim)"
                      : row.deltaS <= 0
                        ? "var(--pos)"
                        : "var(--neg)",
                }}
              >
                {row.deltaS === null ? "\u2013" : formatDeltaS(row.deltaS)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
