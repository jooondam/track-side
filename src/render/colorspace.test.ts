import { describe, expect, it } from "vitest";
import { hexToLinearRgb, srgbToLinearRgb } from "./colorspace";
import { hexToRgb } from "../ui/theme";

const out: [number, number, number] = [0, 0, 0];

describe("hexToLinearRgb", () => {
  it("leaves the endpoints alone", () => {
    hexToLinearRgb("#ffffff", out);
    expect(out).toEqual([1, 1, 1]);
    hexToLinearRgb("#000000", out);
    expect(out).toEqual([0, 0, 0]);
  });

  it("puts the sRGB midpoint at 0.2159 linear", () => {
    // the number that proves a decode is actually happening: a naive /255 gives 0.502
    hexToLinearRgb("#808080", out);
    expect(out[0]).toBeCloseTo(0.2159, 3);
  });

  it("differs from the raw /255 path on a saturated colour", () => {
    // a regression guard. Writing hexToRgb's output into a vertex buffer is what rendered
    // phaseAccel as pale mint and the terrain ramp as milky sage: three treats attribute floats
    // as linear and converts to sRGB on output, so the raw values get brightened twice.
    const raw: [number, number, number] = [0, 0, 0];
    hexToRgb("#35d96a", raw);
    hexToLinearRgb("#35d96a", out);
    const differing = out.filter((v, i) => Math.abs(v - raw[i]) > 0.05).length;
    expect(differing).toBeGreaterThanOrEqual(2);
  });
});

describe("srgbToLinearRgb", () => {
  it("agrees with hexToLinearRgb on viridis' first stop", () => {
    // pins the claim that matplotlib's colormap stops are sRGB display values:
    // (0.267, 0.005, 0.329) is #440154
    const fromFloats: [number, number, number] = [0, 0, 0];
    srgbToLinearRgb([0.267, 0.005, 0.329], fromFloats);
    hexToLinearRgb("#440154", out);
    for (let i = 0; i < 3; i++) expect(fromFloats[i]).toBeCloseTo(out[i], 2);
  });
});
