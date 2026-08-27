import { describe, expect, it } from "vitest";
import { STAGE_COLORS, STAGE_LABELS } from "../../components/ds/stages";

describe("stages constants", () => {
  const EXPECTED_STAGES = [
    "INIT", "STAGE1", "STAGE2", "STAGE3", "STAGE4", "STAGE5", "STAGE6", "COMPLETED",
  ] as const;

  it("STAGE_COLORS maps every known stage to a Tailwind utility class string", () => {
    for (const stage of EXPECTED_STAGES) {
      expect(STAGE_COLORS[stage]).toBeTruthy();
      expect(STAGE_COLORS[stage]).toMatch(/^bg-/);
      expect(STAGE_COLORS[stage]).toMatch(/text-/);
    }
  });

  it("INIT chip uses surface-tint (per spec table, not the legacy system-log token)", () => {
    expect(STAGE_COLORS.INIT).toBe("bg-surface-tint/20 text-surface-tint");
  });

  it("STAGE_LABELS exposes a Chinese label for every known stage", () => {
    for (const stage of EXPECTED_STAGES) {
      expect(STAGE_LABELS[stage]).toBeTruthy();
    }
    expect(STAGE_LABELS.STAGE4).toBe("工作台");
    expect(STAGE_LABELS.COMPLETED).toBe("已完成");
  });
});