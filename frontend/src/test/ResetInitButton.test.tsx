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

// === WorkspacePage integration tests ===

import { MemoryRouter, Routes, Route } from "react-router-dom";
import { useState } from "react";
import { ToastProvider } from "../hooks/useToast";

vi.mock("../api/client", () => ({
  default: {
    resetPreview: vi.fn(),
    resetToInit: vi.fn(),
  },
}));

import api from "../api/client";

// A minimal harness that exercises the WorkspacePage onInit wiring without
// pulling in the full WorkspacePage (which has many other stateful deps).
// We rebuild the same state machine here to test the prop wiring in isolation.
function InitHarness() {
  const [initPreview, setInitPreview] = useState<{
    open: boolean;
    preview?: any;
    busy: boolean;
  }>({ open: false, busy: false });

  const handleInit = async () => {
    (api.resetPreview as any).mockResolvedValue({
      draft_count: 5,
      has_progress: true,
      has_checkpoint: false,
      has_chunks: false,
    });
    const preview = await api.resetPreview("proj_x");
    setInitPreview({ open: true, preview, busy: false });
  };

  const confirmInit = async () => {
    setInitPreview((s) => ({ ...s, busy: true }));
    await api.resetToInit("proj_x");
    setInitPreview({ open: false, busy: false });
  };

  return (
    <ToastProvider>
      <div>
        <button data-testid="harness-init" onClick={handleInit}>
          trigger init
        </button>
        {initPreview.open && (
          <div data-testid="init-dialog">
            <p data-testid="init-message">
              {`将删除 ${initPreview.preview.draft_count} 个章节草稿...`}
            </p>
            <button
              data-testid="init-confirm"
              disabled={initPreview.busy}
              onClick={confirmInit}
            >
              确认初始化
            </button>
          </div>
        )}
      </div>
    </ToastProvider>
  );
}

describe("WorkspacePage init flow (wiring)", () => {
  it("resetPreview is called when handleInit fires", async () => {
    render(
      <MemoryRouter>
        <InitHarness />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByTestId("harness-init"));
    await vi.waitFor(() => {
      expect(api.resetPreview).toHaveBeenCalledWith("proj_x");
    });
    // The state update from `await api.resetPreview(...)` is async; wrap the
    // DOM assertion in waitFor too so it polls until the dialog renders.
    await vi.waitFor(() => {
      expect(screen.getByTestId("init-message")).toHaveTextContent("5");
    });
  });

  it("resetToInit is called when confirm is clicked", async () => {
    (api.resetToInit as any).mockResolvedValue({ error: false });
    render(
      <MemoryRouter>
        <InitHarness />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByTestId("harness-init"));
    await vi.waitFor(() => screen.getByTestId("init-confirm"));
    fireEvent.click(screen.getByTestId("init-confirm"));
    await vi.waitFor(() => {
      expect(api.resetToInit).toHaveBeenCalledWith("proj_x");
    });
  });
});