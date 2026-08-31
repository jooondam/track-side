// the `?at=` seek, which is the one piece of URL parsing with a lookup behind it rather than a
// cast. The rest of readUrlState needs a document; this does not.

import { describe, expect, it } from "vitest";

import type { Corner } from "../assets";
import { seekArcLength } from "./urlState";

const corners = [
  { id: "1", number: 1, name: "La Source", sM: 250, turnInSM: 200, boardSide: "left", boards: [] },
  { id: "2", number: 2, name: "Eau Rouge", sM: 900, turnInSM: 820, boardSide: "left", boards: [] },
] as unknown as Corner[];

describe("seekArcLength", () => {
  it("resolves a corner to the arc length the corner report uses", () => {
    expect(seekArcLength("corner:Eau Rouge", corners)).toBe(900);
  });

  it("matches the name however it is cased, since it comes out of a hand-edited URL", () => {
    expect(seekArcLength("corner:eau rouge", corners)).toBe(900);
    expect(seekArcLength("CORNER:EAU ROUGE", corners)).toBe(900);
  });

  // a mistyped link should open the circuit at the start line, not fail to open it
  it("falls back to the start line for anything it cannot resolve", () => {
    expect(seekArcLength("corner:Nowhere", corners)).toBe(0);
    expect(seekArcLength("corner:", corners)).toBe(0);
    expect(seekArcLength("Eau Rouge", corners)).toBe(0);
    expect(seekArcLength(null, corners)).toBe(0);
  });
});
