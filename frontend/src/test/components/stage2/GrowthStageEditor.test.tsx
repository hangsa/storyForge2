import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import GrowthStageEditor from "../../../components/stage2/GrowthStageEditor";
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
];

describe("GrowthStageEditor", () => {
  it("renders one row per stage", () => {
    render(<GrowthStageEditor stages={STAGES} onChange={() => {}} />);
    expect(screen.getByDisplayValue("起点")).toBeInTheDocument();
    expect(screen.getByDisplayValue("1")).toBeInTheDocument();
  });

  it("invokes onChange when bound_chapter is changed", async () => {
    // React controlled `<input type="number">` does not synchronize the DOM
    // value back to the parent state immediately after `userEvent.clear`, so
    // `userEvent.type` appends to the stale DOM value. Using
    // `userEvent.setup().clear()` to clear the controlled value, then
    // `fireEvent.change` to set the new value, is the reliable pattern.
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<GrowthStageEditor stages={STAGES} onChange={onChange} />);
    const input = screen.getByDisplayValue("1");
    await user.clear(input);
    fireEvent.change(input, { target: { value: "5" } });
    expect(onChange).toHaveBeenCalled();
    const lastCall = onChange.mock.calls[onChange.mock.calls.length - 1][0] as GrowthStage[];
    expect(lastCall[0].bound_chapter).toBe(5);
  });
});
