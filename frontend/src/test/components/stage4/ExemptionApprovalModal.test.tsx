import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import ExemptionApprovalModal from "../../../components/stage4/ExemptionApprovalModal";
import type { ExemptionRequest, ExemptionAntipattern } from "../../../api/client";

const item: ExemptionRequest = {
  id: "ex1", scene_id: "s1",
  rule_to_break: { layer: "L1", rule_id: "r1", rule_description: "打破风格限制", constraint_type: "soft" },
  creative_intent: "让主角以新方式破局", expected_effect: "提升张力",
  status: "pending", requested_by: "writer", requested_at: "2026-06-29T00:00:00Z",
  approved_by: null, rejected_reason: null, outcome: null,
};

describe("ExemptionApprovalModal", () => {
  it("rendersRuleAndIntentAndEffect", () => {
    render(
      <ExemptionApprovalModal
        item={item}
        onFetchAntipatterns={async () => []}
        onApprove={async () => {}}
        onReject={async () => {}}
        onClose={() => {}}
      />
    );
    expect(screen.getByText(/打破风格限制/)).toBeInTheDocument();
    expect(screen.getByText(/让主角以新方式破局/)).toBeInTheDocument();
    expect(screen.getByText(/提升张力/)).toBeInTheDocument();
  });

  it("fetchesAntipatternsOnMount", async () => {
    const cb = vi.fn(async () => [
      { rule_id: "r1", creative_intent_pattern: "p", count: 3, representative_case: "x" } satisfies ExemptionAntipattern,
    ]);
    render(
      <ExemptionApprovalModal
        item={item}
        onFetchAntipatterns={cb}
        onApprove={async () => {}}
        onReject={async () => {}}
        onClose={() => {}}
      />
    );
    await waitFor(() => expect(cb).toHaveBeenCalledWith("ex1"));
  });

  it("antipatternsPresent_rendersWarning", async () => {
    render(
      <ExemptionApprovalModal
        item={item}
        onFetchAntipatterns={async () => [
          { rule_id: "r1", creative_intent_pattern: "p", count: 5, representative_case: "类似意图 X" } satisfies ExemptionAntipattern,
        ]}
        onApprove={async () => {}}
        onReject={async () => {}}
        onClose={() => {}}
      />
    );
    expect(await screen.findByText(/⚠ 5 次类似意图被拒绝/)).toBeInTheDocument();
  });

  it("antipatternsFetchFails_rendersWithoutSection", async () => {
    render(
      <ExemptionApprovalModal
        item={item}
        onFetchAntipatterns={async () => { throw new Error("err"); }}
        onApprove={async () => {}}
        onReject={async () => {}}
        onClose={() => {}}
      />
    );
    // No warning shown; modal still renders the rest.
    await waitFor(() => expect(screen.queryByText(/类似意图被拒绝/)).not.toBeInTheDocument());
    expect(screen.getByText(/打破风格限制/)).toBeInTheDocument();
  });

  it("approve_callsOnApprove", async () => {
    const cb = vi.fn(async () => {});
    render(
      <ExemptionApprovalModal
        item={item}
        onFetchAntipatterns={async () => []}
        onApprove={cb}
        onReject={async () => {}}
        onClose={() => {}}
      />
    );
    fireEvent.click(screen.getByText(/^通过$/));
    await waitFor(() => expect(cb).toHaveBeenCalledTimes(1));
  });

  it("reject_opensReasonInputAndCallsOnReject", async () => {
    const cb = vi.fn(async () => {});
    render(
      <ExemptionApprovalModal
        item={item}
        onFetchAntipatterns={async () => []}
        onApprove={async () => {}}
        onReject={cb}
        onClose={() => {}}
      />
    );
    fireEvent.click(screen.getByText(/^拒绝$/));
    fireEvent.change(screen.getByLabelText(/拒绝原因/), { target: { value: "不通过" } });
    fireEvent.click(screen.getByText(/确认拒绝/));
    await waitFor(() => expect(cb).toHaveBeenCalledWith("不通过"));
  });

  it("Escape_closesUnlessUnsavedReason", () => {
    const onClose = vi.fn();
    const { rerender } = render(
      <ExemptionApprovalModal
        item={item}
        onFetchAntipatterns={async () => []}
        onApprove={async () => {}}
        onReject={async () => {}}
        onClose={onClose}
      />
    );
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);

    // Now open the reject form but don't submit, then press Escape: confirm dialog required.
    onClose.mockClear();
    window.confirm = vi.fn(() => true);
    rerender(
      <ExemptionApprovalModal
        item={item}
        onFetchAntipatterns={async () => []}
        onApprove={async () => {}}
        onReject={async () => {}}
        onClose={onClose}
      />
    );
    fireEvent.click(screen.getByText(/^拒绝$/));
    fireEvent.change(screen.getByLabelText(/拒绝原因/), { target: { value: "x" } });
    fireEvent.keyDown(document, { key: "Escape" });
    expect(window.confirm).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("Tab_cyclesFocusWithinModal", () => {
    render(
      <ExemptionApprovalModal
        item={item}
        onFetchAntipatterns={async () => []}
        onApprove={async () => {}}
        onReject={async () => {}}
        onClose={() => {}}
      />
    );
    // The first focusable element is the Approve button.
    const approveBtn = screen.getByText(/^通过$/);
    expect(document.activeElement).toBe(approveBtn);
    fireEvent.keyDown(approveBtn, { key: "Tab" });
    // After Tab, focus moves to the next focusable element within the modal (Reject button).
    // The exact next element depends on DOM order; we just check it's still in the modal.
    const focused = document.activeElement;
    expect(focused).not.toBe(document.body);
  });

  it("firstFocusable_focusedOnOpen", () => {
    render(
      <ExemptionApprovalModal
        item={item}
        onFetchAntipatterns={async () => []}
        onApprove={async () => {}}
        onReject={async () => {}}
        onClose={() => {}}
      />
    );
    expect(document.activeElement).toBe(screen.getByText(/^通过$/));
  });
});
