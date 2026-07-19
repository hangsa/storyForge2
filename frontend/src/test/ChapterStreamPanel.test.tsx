import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

let lastHookReturn: any = null;

vi.mock("../hooks/useChapterStream", () => ({
  useChapterStream: () => lastHookReturn,
}));

import ChapterStreamPanel from "../components/workspace/ChapterStreamPanel";

describe("ChapterStreamPanel", () => {
  beforeEach(() => {
    lastHookReturn = null;
  });

  it("renders a waiting placeholder when no scene has started yet", () => {
    lastHookReturn = {
      text: "", lastSeq: 0, active: false, failed: false,
      error: null, charCount: 0, current: null,
    };
    render(<ChapterStreamPanel projectId="p1" />);
    // Always rendered so the user sees the connection is live.
    const panel = screen.getByTestId("chapter-stream-panel");
    expect(panel.textContent).toMatch(/等待 AI 开始下一场景/);
  });

  it("renders idle state with previous scene's text", () => {
    lastHookReturn = {
      text: "沈渡靠在墙上", lastSeq: 12, active: false, failed: false,
      error: null, charCount: 6, current: { chapter: 17, scene: 2 },
    };
    render(<ChapterStreamPanel projectId="p1" />);
    expect(screen.getByTestId("chapter-stream-text").textContent)
      .toContain("沈渡靠在墙上");
    expect(screen.getByTestId("chapter-stream-panel").textContent)
      .toMatch(/空闲|最近/);
  });

  it("renders writing state with cursor and chapter info", () => {
    lastHookReturn = {
      text: "夜风如", lastSeq: 3, active: true, failed: false,
      error: null, charCount: 3, current: { chapter: 17, scene: 2 },
    };
    render(<ChapterStreamPanel projectId="p1" />);
    expect(screen.getByTestId("chapter-stream-panel").textContent)
      .toMatch(/正在写入/);
    expect(screen.getByTestId("chapter-stream-panel").textContent)
      .toMatch(/第 17 章 第 2 场景/);
    // Cursor "▌" should be present (rendered conditionally when active)
    expect(screen.getByTestId("chapter-stream-text").textContent).toContain("▌");
  });

  it("renders failed state with error message", () => {
    lastHookReturn = {
      text: "保留", lastSeq: 1, active: false, failed: true,
      error: "LLM 时间超时", charCount: 2, current: { chapter: 5, scene: 3 },
    };
    render(<ChapterStreamPanel projectId="p1" />);
    expect(screen.getByTestId("chapter-stream-panel").textContent).toMatch(/写入失败/);
    expect(screen.getByTestId("chapter-stream-panel").textContent).toMatch(/已保留/);
  });

  it("renders empty-state hint when text is empty but a scene has started", () => {
    lastHookReturn = {
      text: "", lastSeq: 0, active: true, failed: false,
      error: null, charCount: 0, current: { chapter: 1, scene: 1 },
    };
    render(<ChapterStreamPanel projectId="p1" />);
    expect(screen.getByTestId("chapter-stream-panel").textContent)
      .toMatch(/等待 AI 输出第一个字/);
  });

  it("auto-scrolls to bottom when text grows (mocked scrollHeight)", () => {
    lastHookReturn = {
      text: "alpha", lastSeq: 1, active: true, failed: false,
      error: null, charCount: 5, current: { chapter: 1, scene: 1 },
    };
    const { rerender } = render(<ChapterStreamPanel projectId="p1" />);
    const container = screen.getByTestId("chapter-stream-text");
    // jsdom doesn't lay out — simulate the layout by stubbing properties.
    Object.defineProperty(container, "scrollHeight", { value: 1000, configurable: true });
    Object.defineProperty(container, "clientHeight", { value: 340, configurable: true });
    Object.defineProperty(container, "scrollTop", { value: 0, writable: true });

    lastHookReturn = {
      ...lastHookReturn, text: "alpha beta gamma delta", charCount: 27,
    };
    rerender(<ChapterStreamPanel projectId="p1" />);
    // After text grow, scrollTop should be set to scrollHeight - clientHeight.
    expect(container.scrollTop).toBe(660);
  });

  it("surfaces outline_exhausted reason when session is stopped", () => {
    lastHookReturn = {
      text: "", lastSeq: 0, active: false, failed: false,
      error: null, charCount: 0, current: null,
    };
    render(
      <ChapterStreamPanel
        projectId="p1"
        sessionState="stopped"
        stopReason="outline_exhausted"
      />,
    );
    const panel = screen.getByTestId("chapter-stream-panel");
    expect(panel.textContent).toMatch(/已停止/);
    expect(panel.textContent).toMatch(/大纲已用完/);
    // Empty placeholder should reflect the stopped state, not "等待 AI..."
    expect(panel.textContent).not.toMatch(/等待 AI 开始下一场景/);
  });

  it("surfaces user_requested stop reason with friendly label", () => {
    lastHookReturn = {
      text: "", lastSeq: 0, active: false, failed: false,
      error: null, charCount: 0, current: null,
    };
    render(
      <ChapterStreamPanel
        projectId="p1"
        sessionState="stopped"
        stopReason="user_requested"
      />,
    );
    const panel = screen.getByTestId("chapter-stream-panel");
    expect(panel.textContent).toMatch(/已停止/);
    expect(panel.textContent).toMatch(/用户手动停止/);
  });

  it("falls back to a generic stopped label when stopReason is missing", () => {
    lastHookReturn = {
      text: "", lastSeq: 0, active: false, failed: false,
      error: null, charCount: 0, current: null,
    };
    render(<ChapterStreamPanel projectId="p1" sessionState="stopped" />);
    const panel = screen.getByTestId("chapter-stream-panel");
    expect(panel.textContent).toMatch(/已停止/);
    expect(panel.textContent).toMatch(/未启动托管/);
  });

  it("still shows the writing state even when sessionState is stopped (transient)", () => {
    // Defensive: if a chunk arrives while the runner is shutting down, the
    // streaming status takes precedence over the stopped status.
    lastHookReturn = {
      text: "沈渡", lastSeq: 1, active: true, failed: false,
      error: null, charCount: 2, current: { chapter: 1, scene: 1 },
    };
    render(
      <ChapterStreamPanel
        projectId="p1"
        sessionState="stopped"
        stopReason="outline_exhausted"
      />,
    );
    expect(screen.getByTestId("chapter-stream-panel").textContent).toMatch(/正在写入/);
  });
});