import { describe, it, expect } from "vitest";
import { isPreWizardStage } from "../components/ds/stages";

describe("isPreWizardStage", () => {
  it("treats INIT, STAGE1, STAGE2, STAGE3 as pre-wizard", () => {
    expect(isPreWizardStage("INIT")).toBe(true);
    expect(isPreWizardStage("STAGE1")).toBe(true);
    expect(isPreWizardStage("STAGE2")).toBe(true);
    expect(isPreWizardStage("STAGE3")).toBe(true);
  });

  it("treats STAGE4+ and COMPLETED as post-wizard", () => {
    expect(isPreWizardStage("STAGE4")).toBe(false);
    expect(isPreWizardStage("STAGE5")).toBe(false);
    expect(isPreWizardStage("STAGE6")).toBe(false);
    expect(isPreWizardStage("COMPLETED")).toBe(false);
  });

  it("treats unknown stages as post-wizard (fail-closed)", () => {
    expect(isPreWizardStage("")).toBe(false);
    expect(isPreWizardStage("FOO")).toBe(false);
  });
});