import { describe, expect, it } from "vitest";
import { DIM } from "./dimensions";
import { inputStageMinCentreDistance, outputStageMinClearance, outputToothProfile } from "./meshing";

describe("input stage (gear 40 against gear 45)", () => {
  it("keeps the crossed pins apart over a full pitch", () => {
    const min = inputStageMinCentreDistance();
    const clearance = min - 2 * DIM.pinRadius;
    expect(clearance).toBeGreaterThan(0.3);
    expect(min).toBeGreaterThan(2 * DIM.pinRadius + 0.3);
  });

  it("collides when the half-pitch phase is wrong", () => {
    const min = inputStageMinCentreDistance({ ...DIM, inputPinPhaseDeg: 0 });
    expect(min - 2 * DIM.pinRadius).toBeLessThan(0);
  });
});

describe("output stage (gear 50 against wheel 56)", () => {
  const profile = outputToothProfile();

  it("never lets a pin touch the wheel over a full revolution", () => {
    const clearance = outputStageMinClearance(profile);
    expect(clearance).toBeGreaterThan(0);
    expect(clearance).toBeGreaterThan(DIM.toothClearance - 0.08);
  });

  it("has ten identical teeth", () => {
    const n = profile.radius.length;
    const shift = n / DIM.pinCount;
    for (let i = 0; i < n; i++) {
      expect(Math.abs(profile.radius[i]! - profile.radius[(i + shift) % n]!)).toBeLessThan(0.02);
    }
  });

  it("leaves real tooth material: tip land and a sane root", () => {
    const tip = DIM.toothTipRadius;
    const landSamples = Array.from(profile.radius).filter((r) => r >= tip - 1e-6).length;
    const landWidth = ((landSamples / DIM.pinCount) * profile.stepDeg * Math.PI * tip) / 180;
    expect(landWidth).toBeGreaterThan(0.3);
    expect(Math.min(...profile.radius)).toBeGreaterThan(8);
  });

  it("collides when the wheel is moved closer", () => {
    const tooClose = outputStageMinClearance(profile, { ...DIM, pinCircleRadius: DIM.pinCircleRadius + 0.5 });
    expect(tooClose).toBeLessThan(0);
  });
});
