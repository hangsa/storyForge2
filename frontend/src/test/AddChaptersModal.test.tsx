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

  it("accepts the raw typed value without silent clamping on change", async () => {
    // Pre-fix, onChange silently clamped on every keystroke, so typing
    // "99" with maxEnd=10 made the field read "10" — making it look like
    // the input was unresponsive. Now the raw value is held until blur.
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
    expect(input.value).toBe("99");
  });

  it("clamps the end input to maxEnd on blur (not on change)", async () => {
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
    await act(async () => {
      fireEvent.blur(input);
    });
    // maxEnd = 10, so on blur the input clamps to 10
    expect(input.value).toBe("10");
  });

  it("clamps the end input to start on blur when user typed below start", async () => {
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
    await act(async () => {
      fireEvent.blur(input);
    });
    // min = start = 6
    expect(input.value).toBe("6");
  });

  it("allows clearing the field to retype without snap-back", async () => {
    // Pre-fix, empty input was rejected (no setState), so the controlled
    // value snapped back to the last value on the next render — making the
    // field feel uneditable. Now empty is a valid transient state.
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
    expect(input.value).toBe("15");
    await act(async () => {
      fireEvent.change(input, { target: { value: "" } });
    });
    expect(input.value).toBe("");
    // Hint falls back to the default count while the field is empty.
    expect(screen.getByTestId("add-chapters-cap-hint")).toHaveTextContent(/本次将新增 10 章/);
  });

  it("reverts empty input to default on blur", async () => {
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
      fireEvent.change(input, { target: { value: "" } });
    });
    await act(async () => {
      fireEvent.blur(input);
    });
    expect(input.value).toBe("15");  // default = start + 9 = 6 + 9 = 15
  });

  it("rejects decimal input on change (browser allows but we clamp via parseEnd)", async () => {
    // Browsers do allow `<input type="number">` to hold a decimal like "1.5".
    // Our handler accepts anything matching /^\d+$/, so the raw "1.5" is
    // dropped (the state stays at the previous value), which is the safest
    // behavior since Math.floor on blur would silently pick "1" otherwise.
    // Letters and signs are filtered by the browser before the change event
    // fires, so we don't (and can't) test them here — the regex is purely
    // a defense-in-depth guard for non-browser input.
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
    expect(input.value).toBe("15");
    await act(async () => {
      fireEvent.change(input, { target: { value: "1.5" } });
    });
    // Decimal rejected by the /^\d+$/ regex — value unchanged.
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
