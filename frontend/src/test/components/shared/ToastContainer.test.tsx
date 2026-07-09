import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import ToastContainer from "../../../components/shared/ToastContainer";
import { ToastProvider, useToast } from "../../../hooks/useToast";

function Harness({ message, onClick }: { message: string; onClick?: () => void }) {
  const { show } = useToast();
  return (
    <button onClick={() => show(message, onClick ? { onClick } : undefined)}>trigger</button>
  );
}

describe("ToastContainer", () => {
  it("renders_toastMessage", () => {
    render(
      <ToastProvider>
        <Harness message="预检完成" />
        <ToastContainer />
      </ToastProvider>
    );
    fireEvent.click(screen.getByText("trigger"));
    expect(screen.getByText("预检完成")).toBeInTheDocument();
  });

  it("clickingToast_invokesOnClick", () => {
    const cb = vi.fn();
    render(
      <ToastProvider>
        <Harness message="click me" onClick={cb} />
        <ToastContainer />
      </ToastProvider>
    );
    fireEvent.click(screen.getByText("trigger"));
    fireEvent.click(screen.getByText("click me"));
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("has_roleStatusForScreenReader", () => {
    render(
      <ToastProvider>
        <Harness message="hi" />
        <ToastContainer />
      </ToastProvider>
    );
    fireEvent.click(screen.getByText("trigger"));
    expect(screen.getByRole("status")).toBeInTheDocument();
  });
});