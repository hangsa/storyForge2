import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import ManagedDashboard from "../components/workspace/ManagedDashboard";

describe("ManagedDashboard", () => {
  const chapters = [
    { chapter_number: 1, status: "completed" as const },
    { chapter_number: 2, status: "writing" as const },
    { chapter_number: 3, status: "planned" as const },
    { chapter_number: 4, status: "pending" as const },
  ];

  it("renders the status strip only when autopilotActive=true", () => {
    const { rerender } = render(
      <ManagedDashboard chapters={chapters} autopilotActive={false} onChapterClick={() => {}} onAddChapter={() => {}} onRefresh={() => {}} />,
    );
    expect(screen.queryByTestId("status-strip")).not.toBeInTheDocument();
    rerender(
      <ManagedDashboard chapters={chapters} autopilotActive={true} currentTask="生成第 2 章" onChapterClick={() => {}} onAddChapter={() => {}} onRefresh={() => {}} />,
    );
    expect(screen.getByTestId("status-strip")).toBeInTheDocument();
    expect(screen.getByTestId("status-strip").textContent).toContain("生成第 2 章");
  });

  it("renders one cell per chapter with status color", () => {
    render(
      <ManagedDashboard chapters={chapters} autopilotActive={false} onChapterClick={() => {}} onAddChapter={() => {}} onRefresh={() => {}} />,
    );
    const cell1 = screen.getByTestId("chapter-cell-1");
    const cell2 = screen.getByTestId("chapter-cell-2");
    expect(cell1.className).toMatch(/green|emerald/);
    expect(cell2.className).toMatch(/blue/);
  });

  it("clicking a cell fires onChapterClick with chapter_number", () => {
    const onChapterClick = vi.fn();
    render(
      <ManagedDashboard chapters={chapters} autopilotActive={false} onChapterClick={onChapterClick} onAddChapter={() => {}} onRefresh={() => {}} />,
    );
    fireEvent.click(screen.getByTestId("chapter-cell-3"));
    expect(onChapterClick).toHaveBeenCalledWith(3, "planned");
  });

  it("+ new chapter and refresh buttons call their handlers", () => {
    const onAdd = vi.fn();
    const onRefresh = vi.fn();
    render(
      <ManagedDashboard chapters={chapters} autopilotActive={false} onChapterClick={() => {}} onAddChapter={onAdd} onRefresh={onRefresh} />,
    );
    fireEvent.click(screen.getByTestId("add-chapter"));
    fireEvent.click(screen.getByTestId("refresh"));
    expect(onAdd).toHaveBeenCalled();
    expect(onRefresh).toHaveBeenCalled();
  });

  // v1.8.1: workspace defaults to "stopped"; user explicitly starts/stops.
  it("renders '▶ 启动托管' when stopped; clicking it fires onToggleAutopilot", () => {
    const onToggle = vi.fn();
    render(
      <ManagedDashboard chapters={chapters} autopilotActive={false} onChapterClick={() => {}} onAddChapter={() => {}} onRefresh={() => {}} onToggleAutopilot={onToggle} />,
    );
    const btn = screen.getByTestId("autopilot-toggle");
    expect(btn.textContent).toContain("启动");
    fireEvent.click(btn);
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("renders '⏸ 停止托管' when running; clicking it fires onToggleAutopilot", () => {
    const onToggle = vi.fn();
    render(
      <ManagedDashboard chapters={chapters} autopilotActive={true} currentTask="生成第 5 章" onChapterClick={() => {}} onAddChapter={() => {}} onRefresh={() => {}} onToggleAutopilot={onToggle} />,
    );
    const btn = screen.getByTestId("autopilot-toggle");
    expect(btn.textContent).toContain("停止");
    fireEvent.click(btn);
    expect(onToggle).toHaveBeenCalledTimes(1);
  });
});
