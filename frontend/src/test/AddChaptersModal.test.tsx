import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act, waitFor, fireEvent } from "@testing-library/react";
import AddChaptersModal from "../components/workspace/AddChaptersModal";

describe("AddChaptersModal", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("does not render when open=false", () => {
    render(
      <AddChaptersModal
        open={false}
        currentMax={0}
        plannedTotal={30}
        progress={null}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );
    expect(screen.queryByTestId("add-chapters-modal")).not.toBeInTheDocument();
  });

  it("renders the count input + cap hint when plannedTotal > currentMax", () => {
    render(
      <AddChaptersModal
        open
        currentMax={5}
        plannedTotal={20}
        progress={null}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );
    expect(screen.getByTestId("add-chapters-modal")).toBeInTheDocument();
    const input = screen.getByTestId("add-chapters-count") as HTMLInputElement;
    expect(input.value).toBe("1");
    expect(input.max).toBe("15"); // 20 - 5 = 15
    expect(screen.getByTestId("add-chapters-cap-hint")).toHaveTextContent(/可加 15 章/);
  });

  it("input max falls back to 10 when no novel_outline (plannedTotal=0)", () => {
    render(
      <AddChaptersModal
        open
        currentMax={0}
        plannedTotal={0}
        progress={null}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );
    const input = screen.getByTestId("add-chapters-count") as HTMLInputElement;
    expect(input.max).toBe("10");
    expect(screen.getByTestId("add-chapters-cap-hint")).toHaveTextContent(/默认上限 10 章/);
  });

  it("clamps the input to the cap when user types a larger number", async () => {
    render(
      <AddChaptersModal
        open
        currentMax={5}
        plannedTotal={10}
        progress={null}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );
    const input = screen.getByTestId("add-chapters-count") as HTMLInputElement;
    await act(async () => {
      // user types 99 — clamp to cap (5); the modal's onChange uses
      // Math.min(v, cap), so the displayed value should equal 5 after the
      // change event propagates through React.
      fireEvent.change(input, { target: { value: "99" } });
    });
    expect(input.value).toBe("5");
  });

  it("ignores non-numeric / zero / negative input (keeps last valid)", async () => {
    render(
      <AddChaptersModal
        open
        currentMax={5}
        plannedTotal={20}
        progress={null}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );
    const input = screen.getByTestId("add-chapters-count") as HTMLInputElement;
    // Start at 1 (initial).
    expect(input.value).toBe("1");
    await act(async () => {
      fireEvent.change(input, { target: { value: "" } });
    });
    expect(input.value).toBe("1");
  });

  it("shows cap-reached message and disables confirm when currentMax === plannedTotal", () => {
    render(
      <AddChaptersModal
        open
        currentMax={30}
        plannedTotal={30}
        progress={null}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );
    expect(screen.getByTestId("add-chapters-cap-reached")).toHaveTextContent(/已达到全书大纲的上限/);
    expect(screen.getByTestId("add-chapters-confirm")).toBeDisabled();
  });

  it("clicking confirm invokes onConfirm with the count", async () => {
    const onConfirm = vi.fn();
    render(
      <AddChaptersModal
        open
        currentMax={5}
        plannedTotal={20}
        progress={null}
        onCancel={vi.fn()}
        onConfirm={onConfirm}
      />,
    );
    const input = screen.getByTestId("add-chapters-count") as HTMLInputElement;
    await act(async () => {
      fireEvent.change(input, { target: { value: "3" } });
    });
    await act(async () => {
      screen.getByTestId("add-chapters-confirm").click();
    });
    await waitFor(() => expect(onConfirm).toHaveBeenCalledWith(3));
  });

  it("clicking cancel invokes onCancel", async () => {
    const onCancel = vi.fn();
    render(
      <AddChaptersModal
        open
        currentMax={5}
        plannedTotal={20}
        progress={null}
        onCancel={onCancel}
        onConfirm={vi.fn()}
      />,
    );
    await act(async () => {
      screen.getByTestId("add-chapters-cancel").click();
    });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("shows progress text and disables confirm while progress is non-null", () => {
    render(
      <AddChaptersModal
        open
        currentMax={5}
        plannedTotal={20}
        progress={{ done: 2, total: 5 }}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );
    expect(screen.getByTestId("add-chapters-progress")).toHaveTextContent(/第 2 \/ 5 章/);
    expect(screen.getByTestId("add-chapters-confirm")).toBeDisabled();
    expect(screen.getByTestId("add-chapters-count")).toBeDisabled();
  });
});
