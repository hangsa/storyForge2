import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ParamSliders from "../../../components/style/ParamSliders";
import { DEFAULT_SANDBOX_PARAMS, type SandboxParams } from "../../../api/client";

describe("ParamSliders", () => {
  it("renders all 5 group headings", () => {
    render(<ParamSliders params={DEFAULT_SANDBOX_PARAMS} onChange={() => {}} />);
    expect(screen.getByText("句长")).toBeInTheDocument();
    expect(screen.getByText("对白")).toBeInTheDocument();
    expect(screen.getByText("节奏")).toBeInTheDocument();
    expect(screen.getByText("密度")).toBeInTheDocument();
    expect(screen.getByText("爽点")).toBeInTheDocument();
  });

  it("invokes onChange when a slider value changes", async () => {
    // React controlled `<input type="number">` does not synchronize the DOM
    // value back to the parent state immediately after `userEvent.clear`, so
    // `userEvent.type` appends to the stale DOM value. Using
    // `userEvent.setup().clear()` to clear the controlled value, then
    // `fireEvent.change` to set the new value, is the reliable pattern.
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ParamSliders params={DEFAULT_SANDBOX_PARAMS} onChange={onChange} />);
    const ratio = screen.getByLabelText(/对白占比/) as HTMLInputElement;
    await user.clear(ratio);
    fireEvent.change(ratio, { target: { value: "0.5" } });
    expect(onChange).toHaveBeenCalled();
    const last = onChange.mock.calls[onChange.mock.calls.length - 1][0] as SandboxParams;
    expect(last.dialogue.ratio).toBe(0.5);
  });
});
