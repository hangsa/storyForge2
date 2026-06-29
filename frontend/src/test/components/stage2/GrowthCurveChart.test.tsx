import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import GrowthCurveChart from "../../../components/stage2/GrowthCurveChart";
import type { GrowthStage } from "../../../api/client";

const STAGES: GrowthStage[] = [
  { stage_number: 1, stage_name: "起点", trigger_event_type: "betrayal_experienced", trigger_event_description: "", character_change: "", target_chapter_range: "", bound_chapter: 1 },
  { stage_number: 2, stage_name: "转折", trigger_event_type: "betrayal_experienced", trigger_event_description: "", character_change: "", target_chapter_range: "", bound_chapter: 5 },
  { stage_number: 3, stage_name: "低谷", trigger_event_type: "irreversible_loss", trigger_event_description: "", character_change: "", target_chapter_range: "", bound_chapter: 12 },
  { stage_number: 4, stage_name: "回升", trigger_event_type: "moral_awakening", trigger_event_description: "", character_change: "", target_chapter_range: "", bound_chapter: 18 },
];

describe("GrowthCurveChart", () => {
  it("renders an SVG with one circle per stage", () => {
    const { container } = render(<GrowthCurveChart stages={STAGES} />);
    const circles = container.querySelectorAll("circle");
    expect(circles.length).toBe(STAGES.length);
  });

  it("skips stages without bound_chapter", () => {
    const partial = [...STAGES];
    partial[1] = { ...STAGES[1], bound_chapter: null };
    const { container } = render(<GrowthCurveChart stages={partial} />);
    expect(container.querySelectorAll("circle").length).toBe(3);
  });

  it("renders nothing for empty stages", () => {
    const { container } = render(<GrowthCurveChart stages={[]} />);
    expect(container.querySelector("svg")).toBeNull();
  });
});
