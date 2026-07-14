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

  it("renders start + end input with default end = start+9 when plannedTotal > currentMax", () => {
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
    // start = currentMax + 1 = 6
    expect(screen.getByTestId("add-chapters-start-display")).toHaveTextContent("6");
    const input = screen.getByTestId("add-chapters-end-input") as HTMLInputElement;
    // default end = min(start + 9, plannedTotal) = min(15, 20) = 15
    expect(input.value).toBe("15");
    expect(input.max).toBe("20");
    expect(input.min).toBe("6");
    // hint shows the range + 10 chapters (15 - 6 + 1 = 10)
    expect(screen.getByTestId("add-chapters-cap-hint")).toHaveTextContent(/本次将新增 10 章/);
    expect(screen.getByTestId("add-chapters-cap-hint")).toHaveTextContent(/范围 6 - 20/);
  });

  it("clamps the end input to maxEnd when user types a larger number", async () => {
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
    const input = screen.getByTestId("add-chapters-end-input") as HTMLInputElement;
    await act(async () => {
      fireEvent.change(input, { target: { value: "99" } });
    });
    // maxEnd = 10, so the input clamps to 10
    expect(input.value).toBe("10");
  });

  it("clamps the end input to start when user types a smaller number", async () => {
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
    const input = screen.getByTestId("add-chapters-end-input") as HTMLInputElement;
    await act(async () => {
      fireEvent.change(input, { target: { value: "2" } });
    });
    // min = start = 6
    expect(input.value).toBe("6");
  });

  it("ignores non-numeric input (keeps last valid)", async () => {
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
    const input = screen.getByTestId("add-chapters-end-input") as HTMLInputElement;
    // Default = 15
    expect(input.value).toBe("15");
    await act(async () => {
      fireEvent.change(input, { target: { value: "" } });
    });
    expect(input.value).toBe("15");
  });

  it("default end = start+9 capped at plannedTotal when plannedTotal is small", () => {
    // currentMax=5, plannedTotal=10 → start=6, defaultEnd=min(15, 10)=10
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
    const input = screen.getByTestId("add-chapters-end-input") as HTMLInputElement;
    expect(input.value).toBe("10");
  });

  it("default end = start+9 when no novel_outline (plannedTotal=0)", () => {
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
    // start=1, defaultEnd=1+9=10, maxEnd=10
    const input = screen.getByTestId("add-chapters-end-input") as HTMLInputElement;
    expect(input.value).toBe("10");
    expect(input.max).toBe("10");
    expect(screen.getByTestId("add-chapters-cap-hint")).toHaveTextContent(/默认上限 10 章/);
  });

  it("shows cap-reached message and disables confirm when currentMax >= plannedTotal", () => {
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

  it("clicking confirm invokes onConfirm with the end chapter number", async () => {
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
    const input = screen.getByTestId("add-chapters-end-input") as HTMLInputElement;
    await act(async () => {
      fireEvent.change(input, { target: { value: "10" } });
    });
    await act(async () => {
      screen.getByTestId("add-chapters-confirm").click();
    });
    await waitFor(() => expect(onConfirm).toHaveBeenCalledWith(10));
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
    expect(screen.getByTestId("add-chapters-end-input")).toBeDisabled();
  });
});
