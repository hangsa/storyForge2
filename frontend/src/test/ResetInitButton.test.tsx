import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import ChapterTreePanel from "../components/workspace/ChapterTreePanel";

const baseProps = () => ({
  volumes: [],
  currentChapter: 1,
  currentScene: null,
  onSelectChapter: vi.fn(),
  onSelectScene: vi.fn(),
  onRefresh: vi.fn(),
});

describe("ChapterTreePanel — init button", () => {
  it("does not render 初始化 button when onInit is omitted", () => {
    render(<ChapterTreePanel {...baseProps()} />);
    expect(screen.queryByTestId("init-project")).not.toBeInTheDocument();
  });

  it("renders 初始化 button when onInit is provided", () => {
    render(<ChapterTreePanel {...baseProps()} onInit={vi.fn()} />);
    expect(screen.getByTestId("init-project")).toBeInTheDocument();
    expect(screen.getByTestId("init-project")).toHaveTextContent("初始化");
  });

  it("renders 初始化 BEFORE 刷新 in DOM order", () => {
    render(<ChapterTreePanel {...baseProps()} onInit={vi.fn()} />);
    const initBtn = screen.getByTestId("init-project");
    const refreshBtn = screen.getByTestId("refresh");
    expect(
      initBtn.compareDocumentPosition(refreshBtn) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("clicking 初始化 triggers onInit callback", () => {
    const onInit = vi.fn();
    render(<ChapterTreePanel {...baseProps()} onInit={onInit} />);
    fireEvent.click(screen.getByTestId("init-project"));
    expect(onInit).toHaveBeenCalledTimes(1);
  });
});