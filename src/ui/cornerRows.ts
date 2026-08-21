// one row per named corner: the numbers an engineer would write on a run sheet, derived from
// channels the solver already produces, so this costs one pass over the lap and no new physics.
//
// This lives apart from the table that draws it because the landing sheet prints the same rows.
// Two implementations of "time in this corner" would be two answers to one question, and the
// cover would eventually disagree with the report behind it.
//
// The corner window runs from turn-in to the same distance past the apex, which is a definition
// rather than a measurement: the data has an authored turn-in and an authored apex and nothing
// that marks an exit. Symmetric is the honest choice, and it is stated rather than hidden so
// nobody reads "time in corner" as more precise than it is.

import type { Corner, LineData } from "../assets";
import type { LapTimeTable } from "../solver/lapTime";
import { deltaToGhost, timeAtS } from "../solver/lapTime";
import type { VelocityProfileResult } from "../solver/velocity";

export interface CornerRow {
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

export function buildCornerRows(
  line: LineData,
  result: VelocityProfileResult,
  table: LapTimeTable,
  ghostTable: LapTimeTable | null,
  corners: Corner[],
): CornerRow[] {
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
