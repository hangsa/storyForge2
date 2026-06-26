import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";

vi.mock("../../hooks/useBranchSimulation", () => ({
  default: vi.fn(),
}));

import BranchSimulationPage from "../../pages/BranchSimulationPage";
import useBranchSimulation from "../../hooks/useBranchSimulation";
import type { SimulationHistoryItem } from "../../api/client";

const mockUseBranchSimulation = useBranchSimulation as unknown as ReturnType<typeof vi.fn>;

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/project/proj_x/stage3/branches"]}>
      <Routes>
        <Route path="/project/:projectId/stage3/branches" element={<BranchSimulationPage />} />
      </Routes>
    </MemoryRouter>
  );
}

describe("BranchSimulationPage", () => {
  beforeEach(() => {
    mockUseBranchSimulation.mockReturnValue({
      status: "idle",
      description: "",
      currentReport: null,
      history: [],
      error: null,
      setDescription: vi.fn(),
      runSimulation: vi.fn(),
      selectHistoryItem: vi.fn(),
      loadHistory: vi.fn(),
    });
  });

  it("renders title and empty state when no report", () => {
    renderPage();
    // Empty state from ResultViewer when report is null
    expect(screen.getByText(/输入分支描述并点击.+执行模拟/)).toBeInTheDocument();
  });

  it("calls runSimulation when execute button is clicked", () => {
    const runSimulation = vi.fn();
    mockUseBranchSimulation.mockReturnValue({
      status: "idle",
      description: "改变主角职业",
      currentReport: null,
      history: [],
      error: null,
      setDescription: vi.fn(),
      runSimulation,
      selectHistoryItem: vi.fn(),
      loadHistory: vi.fn(),
    });
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /执行模拟/ }));
    expect(runSimulation).toHaveBeenCalledTimes(1);
  });

  it("displays error when hook returns an error", () => {
    mockUseBranchSimulation.mockReturnValue({
      status: "error",
      description: "",
      currentReport: null,
      history: [],
      error: "LLM 调用失败",
      setDescription: vi.fn(),
      runSimulation: vi.fn(),
      selectHistoryItem: vi.fn(),
      loadHistory: vi.fn(),
    });
    renderPage();
    expect(screen.getByText("LLM 调用失败")).toBeInTheDocument();
  });

  it("renders history list when items present", () => {
    mockUseBranchSimulation.mockReturnValue({
      status: "idle",
      description: "",
      currentReport: null,
      history: [
        { id: "20260620T120000_simulation", description: "测试分支1", created_at: "2026-06-20T12:00:00" },
        { id: "20260621T120000_simulation", description: "测试分支2", created_at: "2026-06-21T12:00:00" },
      ],
      error: null,
      setDescription: vi.fn(),
      runSimulation: vi.fn(),
      selectHistoryItem: vi.fn(),
      loadHistory: vi.fn(),
    });
    renderPage();
    expect(screen.getByText("测试分支1")).toBeInTheDocument();
    expect(screen.getByText("测试分支2")).toBeInTheDocument();
  });

  it("calls selectHistoryItem when a history entry is clicked", () => {
    const selectHistoryItem = vi.fn();
    const item: SimulationHistoryItem = {
      id: "abc123",
      description: "测试",
      created_at: "2026-06-20T00:00:00",
    };
    mockUseBranchSimulation.mockReturnValue({
      status: "idle",
      description: "",
      currentReport: null,
      history: [item],
      error: null,
      setDescription: vi.fn(),
      runSimulation: vi.fn(),
      selectHistoryItem,
      loadHistory: vi.fn(),
    });
    renderPage();
    fireEvent.click(screen.getByText("测试"));
    // The hook's selectHistoryItem takes the full SimulationHistoryItem object
    expect(selectHistoryItem).toHaveBeenCalledWith(item);
  });

  it("calls loadHistory on mount", () => {
    const loadHistory = vi.fn();
    mockUseBranchSimulation.mockReturnValue({
      status: "idle",
      description: "",
      currentReport: null,
      history: [],
      error: null,
      setDescription: vi.fn(),
      runSimulation: vi.fn(),
      selectHistoryItem: vi.fn(),
      loadHistory,
    });
    renderPage();
    expect(loadHistory).toHaveBeenCalledTimes(1);
  });
});