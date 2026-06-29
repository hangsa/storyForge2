import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import GrowthWorkshop from "../../../components/stage2/GrowthWorkshop";
import type { Character } from "../../../api/client";
import type { GrowthStage } from "../../../api/client";

const STAGES: GrowthStage[] = [
  {
    stage_number: 1,
    stage_name: "起点",
    trigger_event_type: "betrayal_experienced",
    trigger_event_description: "",
    character_change: "",
    target_chapter_range: "",
    bound_chapter: 1,
  },
  {
    stage_number: 2,
    stage_name: "低谷",
    trigger_event_type: "irreversible_loss",
    trigger_event_description: "",
    character_change: "",
    target_chapter_range: "",
    bound_chapter: 50,
  },
];

const CHARACTER = {
  id: "c1",
  name: "林峰",
  role: "主角",
  growth_curve: { curve_description: "", stages: STAGES },
} as unknown as Character;

vi.mock("../../../hooks/useGrowthWorkshop", () => ({
  useGrowthWorkshop: () => ({
    checkResult: null,
    checkError: null,
    checking: false,
    check: vi.fn().mockResolvedValue(undefined),
    clearCheck: vi.fn(),
    adjust: vi.fn().mockResolvedValue([]),
    discuss: vi.fn().mockResolvedValue({ answer: "ok", suggestions: [], skipped_reason: undefined }),
  }),
}));

describe("GrowthWorkshop", () => {
  it("renders title containing the character name", () => {
    render(<GrowthWorkshop projectId="p1" character={CHARACTER} />);
    expect(screen.getByText(/林峰/)).toBeInTheDocument();
  });

  it("renders the check button and empty warnings panel", () => {
    render(<GrowthWorkshop projectId="p1" character={CHARACTER} />);
    expect(screen.getByRole("button", { name: /运行一致性检查/ })).toBeInTheDocument();
    expect(screen.getByText(/暂无一致性警告/)).toBeInTheDocument();
  });
});