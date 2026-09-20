import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { RegenerateModal } from "@/components/shared/RegenerateModal";

// Minimal coverage for the operator selector branch added in v2.x
// (S2 follow-up picks "无算子" vs "自适应"). The default hint row
// (without `operators`) is the contract used by S2 regenerate — verify it
// is unchanged so the legacy callers don't regress.

const TWO_OPS = [
  { value: "none", label: "无算子" },
  { value: "adaptive", label: "自适应" },
] as const;

describe("RegenerateModal", () => {
  it("renders nothing when closed", () => {
    render(
      <RegenerateModal
        open={false}
        target="灵窍"
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(screen.queryByTestId("regenerate-modal")).toBeNull();
  });

  it("renders title with target name and the original hint row when operators is not provided", () => {
    // Default mode (S2 regenerate): the original "留空 = 仅重新生成 · 最多 N 字"
    // hint must still be visible — this is the contract callers depend on
    // before the operator feature shipped.
    render(
      <RegenerateModal
        open
        target="灵窍"
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(screen.getByText(/重新生成 — 灵窍/)).toBeInTheDocument();
    expect(screen.getByText(/留空 = 仅重新生成/)).toBeInTheDocument();
    expect(screen.queryByTestId("regenerate-modal-operator")).toBeNull();
  });

  it("renders the operator dropdown instead of the hint row when operators prop is provided", () => {
    // S2 follow-up mode: the modal swaps the hint row for a controlled
    // operator dropdown. This is the entry point the user toggles to
    // switch from "无算子" (default) to "自适应".
    render(
      <RegenerateModal
        open
        target="灵窍"
        operator="none"
        operators={TWO_OPS}
        onOperatorChange={() => {}}
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    const dropdown = screen.getByTestId("regenerate-modal-operator");
    expect(dropdown).toBeInTheDocument();
    expect(within(dropdown).getByRole("option", { name: "无算子" })).toBeInTheDocument();
    expect(within(dropdown).getByRole("option", { name: "自适应" })).toBeInTheDocument();
    // The legacy hint row is suppressed in operator mode.
    expect(screen.queryByText(/留空 = 仅重新生成/)).toBeNull();
  });

  it("calls onOperatorChange when the user picks a different option", () => {
    const onOperatorChange = vi.fn();
    render(
      <RegenerateModal
        open
        target="灵窍"
        operator="none"
        operators={TWO_OPS}
        onOperatorChange={onOperatorChange}
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    fireEvent.change(screen.getByTestId("regenerate-modal-operator"), {
      target: { value: "adaptive" },
    });
    expect(onOperatorChange).toHaveBeenCalledWith("adaptive");
  });

  it("reflects the controlled operator prop in the dropdown's current value", () => {
    // The dropdown is fully controlled — when the parent flips
    // `operator` from "none" to "adaptive", the rendered <select>'s
    // .value must mirror that without any internal state lag.
    const { rerender } = render(
      <RegenerateModal
        open
        target="灵窍"
        operator="none"
        operators={TWO_OPS}
        onOperatorChange={() => {}}
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(
      (screen.getByTestId("regenerate-modal-operator") as HTMLSelectElement).value,
    ).toBe("none");
    rerender(
      <RegenerateModal
        open
        target="灵窍"
        operator="adaptive"
        operators={TWO_OPS}
        onOperatorChange={() => {}}
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(
      (screen.getByTestId("regenerate-modal-operator") as HTMLSelectElement).value,
    ).toBe("adaptive");
  });

  it("confirming passes the textarea text verbatim (operator is owned by parent)", () => {
    // The confirm callback signature is unchanged — onConfirm(text). The
    // parent already holds the operator and reads it from its own state at
    // confirm-time. We assert only the text contract here.
    const onConfirm = vi.fn();
    render(
      <RegenerateModal
        open
        target="灵窍"
        operator="adaptive"
        operators={TWO_OPS}
        onOperatorChange={() => {}}
        onConfirm={onConfirm}
        onCancel={() => {}}
      />,
    );
    fireEvent.change(screen.getByLabelText("修改意见"), {
      target: { value: "让节奏更紧凑" },
    });
    fireEvent.click(screen.getByTestId("regenerate-modal-confirm"));
    expect(onConfirm).toHaveBeenCalledWith("让节奏更紧凑");
  });
});
