import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const { mockApi } = vi.hoisted(() => ({
  mockApi: {
    listProjects: vi.fn(),
    createProject: vi.fn(),
    getProjectStats: vi.fn(),
    advance: vi.fn(),
  },
}));

vi.mock("../api/client", () => ({
  default: mockApi,
  ApiError: class extends Error {
    code: string;
    detail: Record<string, unknown>;
    constructor(code: string, message: string, detail?: Record<string, unknown>) {
      super(message);
      this.code = code;
      this.detail = detail || {};
    }
  },
}));

import HomePage from "../pages/HomePage";

const SAMPLE_STATS = {
  total_books: 3,
  total_chapters: 12,
  total_words: 50000,
  stage_distribution: {
    INIT: 0, STAGE1: 1, STAGE2: 0, STAGE3: 0,
    STAGE4: 2, STAGE5: 0, STAGE6: 0, COMPLETED: 0,
  },
};

beforeEach(() => {
  mockApi.listProjects.mockReset();
  mockApi.listProjects.mockResolvedValue([]);
  mockApi.getProjectStats.mockReset();
  mockApi.getProjectStats.mockResolvedValue(SAMPLE_STATS);
  mockApi.createProject.mockReset();
  mockApi.advance.mockReset();
});

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/"]}>
      <HomePage />
    </MemoryRouter>
  );
}

describe("HomePage layout", () => {
  it("renders StatsSidebar, ManifestoHeader, CreateProjectCard, BookShelf", async () => {
    renderPage();
    expect(screen.getByTestId("stats-sidebar")).toBeInTheDocument();
    expect(screen.getByTestId("manifesto-header")).toBeInTheDocument();
    expect(screen.getByTestId("create-project-card")).toBeInTheDocument();
    expect(screen.getByTestId("book-shelf")).toBeInTheDocument();
  });

  it("renders stats from /api/project/stats", async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText("3")).toBeInTheDocument();
      expect(screen.getByText("12")).toBeInTheDocument();
      expect(screen.getByText("50,000")).toBeInTheDocument();
    });
  });

  it("shows placeholder dashes when stats fetch fails", async () => {
    mockApi.getProjectStats.mockRejectedValue(new Error("boom"));
    renderPage();
    await waitFor(() => {
      expect(screen.getAllByText("—").length).toBeGreaterThan(0);
    });
  });
});

describe("HomePage create flow", () => {
  it("submit calls createProject then advance", async () => {
    mockApi.createProject.mockResolvedValue({ id: "proj_new" });
    mockApi.advance.mockResolvedValue({ current_stage: "STAGE1" });

    renderPage();
    await act(async () => {
      fireEvent.change(screen.getByTestId("intent-input"), {
        target: { value: "一个故事" },
      });
    });
    await act(async () => {
      screen.getByTestId("create-submit").click();
    });

    expect(mockApi.createProject).toHaveBeenCalledTimes(1);
    expect(mockApi.createProject).toHaveBeenCalledWith({
      intent: "一个故事",
      title: undefined,
      genre: "cool_novel",
      min_words: 4000,
    });
    expect(mockApi.advance).toHaveBeenCalledWith("proj_new", "STAGE1");
  });

  it("disables the submit button when intent is empty", () => {
    renderPage();
    const submit = screen.getByTestId("create-submit") as HTMLButtonElement;
    expect(submit).toBeDisabled();
  });

  it("shows the create error on failure", async () => {
    mockApi.createProject.mockRejectedValue(new Error("服务器错误"));
    renderPage();
    await act(async () => {
      fireEvent.change(screen.getByTestId("intent-input"), {
        target: { value: "一个故事" },
      });
    });
    await act(async () => {
      screen.getByTestId("create-submit").click();
    });
    expect(await screen.findByTestId("create-error")).toHaveTextContent("服务器错误");
  });
});

describe("HomePage refresh", () => {
  it("refreshing re-fetches /stats", async () => {
    renderPage();
    await screen.findByTestId("stats-sidebar");
    mockApi.getProjectStats.mockClear();
    await act(async () => {
      screen.getByTestId("qa-refresh").click();
    });
    expect(mockApi.getProjectStats).toHaveBeenCalled();
  });
});
