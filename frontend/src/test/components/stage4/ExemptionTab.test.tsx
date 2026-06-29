import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import ExemptionTab from "../../../components/stage4/ExemptionTab";
import type { ExemptionRequest } from "../../../api/client";

const items: ExemptionRequest[] = [
  {
    id: "ex1", scene_id: "s1",
    rule_to_break: { layer: "L1", rule_id: "r1", rule_description: "rule 1", constraint_type: "soft" },
    creative_intent: "i1", expected_effect: "e1", status: "pending",
    requested_by: "w", requested_at: "2026-06-29T00:00:00Z",
    approved_by: null, rejected_reason: null, outcome: null,
  },
];

describe("ExemptionTab", () => {
  it("rendersExemptionCards", () => {
    render(<ExemptionTab items={items} loading={false} error={null} onSelect={() => {}} onRefresh={() => {}} />);
    expect(screen.getByText(/rule 1/)).toBeInTheDocument();
  });

  it("emptyItems_rendersEmptyStringAndRefresh", () => {
    const cb = vi.fn();
    render(<ExemptionTab items={[]} loading={false} error={null} onSelect={() => {}} onRefresh={cb} />);
    expect(screen.getByText(/暂无待审批的创意豁免请求/)).toBeInTheDocument();
    fireEvent.click(screen.getByText(/刷新/));
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("cardClick_callsOnSelect", () => {
    const cb = vi.fn();
    render(<ExemptionTab items={items} loading={false} error={null} onSelect={cb} onRefresh={() => {}} />);
    fireEvent.click(screen.getByRole("button"));  // The ExemptionCard renders as a <button>.
    expect(cb).toHaveBeenCalledWith(items[0]);
  });
});
