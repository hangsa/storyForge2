import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import ExemptionCard from "../../../components/stage4/ExemptionCard";
import type { ExemptionRequest } from "../../../api/client";

const baseItem: ExemptionRequest = {
  id: "ex1", scene_id: "s1",
  rule_to_break: { layer: "L1", rule_id: "r1", rule_description: "打破风格限制", constraint_type: "soft" },
  creative_intent: "让主角以新方式破局", expected_effect: "提升张力",
  status: "pending", requested_by: "writer", requested_at: "2026-06-29T00:00:00Z",
  approved_by: null, rejected_reason: null, outcome: null,
};

describe("ExemptionCard", () => {
  it("rendersFields", () => {
    render(<ExemptionCard item={baseItem} onClick={() => {}} />);
    expect(screen.getByText(/打破风格限制/)).toBeInTheDocument();
    expect(screen.getByText(/提升张力/)).toBeInTheDocument();
  });

  it("truncatesCreativeIntentToLimit", () => {
    const longIntent = "x".repeat(200);
    const item = { ...baseItem, creative_intent: longIntent };
    render(<ExemptionCard item={item} onClick={() => {}} />);
    // The truncated view should not contain the full 200-char string verbatim.
    expect(screen.queryByText(longIntent)).not.toBeInTheDocument();
  });

  it("click_callsOnClick", () => {
    const cb = vi.fn();
    render(<ExemptionCard item={baseItem} onClick={cb} />);
    fireEvent.click(screen.getByRole("button"));
    expect(cb).toHaveBeenCalledTimes(1);
  });
});
