import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import ChapterRangeRegenerateModal from "../components/workspace/editors/ChapterRangeRegenerateModal";

describe("ChapterRangeRegenerateModal", () => {
  const defaultProps = {
    open: true,
    chapterCount: 10,
    onConfirm: vi.fn().mockResolvedValue(undefined),
    onCancel: vi.fn(),
  };

  it("renders 2 number inputs (start, end), warning banner, textarea", () => {
    render(<ChapterRangeRegenerateModal {...defaultProps} />);
    expect(screen.getByTestId("chapter-range-warning")).toBeInTheDocument();
    expect(screen.getByTestId("chapter-range-start")).toBeInTheDocument();
    expect(screen.getByTestId("chapter-range-end")).toBeInTheDocument();
    expect(screen.getByTestId("chapter-range-mods")).toBeInTheDocument();
  });

  it("submit calls onConfirm with parsed values", async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    render(<ChapterRangeRegenerateModal {...defaultProps} onConfirm={onConfirm} />);

    fireEvent.change(screen.getByTestId("chapter-range-start"), { target: { value: "3" } });
    fireEvent.change(screen.getByTestId("chapter-range-end"), { target: { value: "5" } });
    fireEvent.change(screen.getByTestId("chapter-range-mods"), { target: { value: "make it tight" } });
    fireEvent.click(screen.getByTestId("chapter-range-confirm"));

    await waitFor(() =>
      expect(onConfirm).toHaveBeenCalledWith(3, 5, "make it tight"),
    );
  });

  it("start > end disables confirm button (or shows error before submit)", () => {
    render(<ChapterRangeRegenerateModal {...defaultProps} />);
    fireEvent.change(screen.getByTestId("chapter-range-start"), { target: { value: "5" } });
    fireEvent.change(screen.getByTestId("chapter-range-end"), { target: { value: "3" } });
    const btn = screen.getByTestId("chapter-range-confirm") as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it("out-of-range input disables confirm button", () => {
    render(<ChapterRangeRegenerateModal {...defaultProps} />);
    fireEvent.change(screen.getByTestId("chapter-range-start"), { target: { value: "0" } });
    const btn = screen.getByTestId("chapter-range-confirm") as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it("Escape cancels", () => {
    const onCancel = vi.fn();
    render(<ChapterRangeRegenerateModal {...defaultProps} onCancel={onCancel} />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onCancel).toHaveBeenCalled();
  });

  it("busy disables inputs and confirm", () => {
    render(<ChapterRangeRegenerateModal {...defaultProps} busy />);
    expect((screen.getByTestId("chapter-range-start") as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByTestId("chapter-range-confirm") as HTMLButtonElement).disabled).toBe(true);
  });
});