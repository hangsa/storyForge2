import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const { mockApi } = vi.hoisted(() => ({
  mockApi: {
    listProjects: vi.fn(),
    createProject: vi.fn(),
    getProjectStats: vi.fn(),
    advance: vi.fn(),
    getConcept: vi.fn(),
    getWorld: vi.fn(),
    getCharacter: vi.fn(),
    getNovelOutline: vi.fn(),
    getOutline: vi.fn(),
    listGenres: vi.fn(),
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
import { WizardProvider } from "../components/wizard/WizardContext";

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
  // Stub wizard data fetches so mounting InitWizardModal doesn't throw.
  mockApi.getConcept.mockResolvedValue(null);
  mockApi.getWorld.mockResolvedValue(null);
  mockApi.getCharacter.mockResolvedValue(null);
  mockApi.getNovelOutline.mockResolvedValue(null);
  mockApi.getOutline.mockResolvedValue(null);
  mockApi.listGenres.mockReset();
  mockApi.listGenres.mockResolvedValue([]);
});

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/"]}>
      <WizardProvider projectId="proj_new">
        <HomePage />
      </WizardProvider>
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
      min_words: 2000,
      target_total_words: 1_000_000,
      target_length_category: "标准商业连载",
    });
    expect(mockApi.advance).toHaveBeenCalledWith("proj_new", "STAGE1");
  });

  it("disables the submit button when intent is empty", () => {
    renderPage();
    const submit = screen.getByTestId("create-submit") as HTMLButtonElement;
    expect(submit).toBeDisabled();
  });

  it("renders the 3 length options with new labels and defaults to 标准商业连载", () => {
    renderPage();
    expect(screen.getByTestId("length-短篇快穿")).toBeInTheDocument();
    expect(screen.getByTestId("length-标准商业连载")).toBeInTheDocument();
    expect(screen.getByTestId("length-宏大史诗巨著")).toBeInTheDocument();
    // 默认选中标准商业连载（index=1）；className 含 bg-primary-container/10
    const medium = screen.getByTestId("length-标准商业连载");
    expect(medium.className).toContain("border-primary-container");
  });

  it("clicking a different length option sends its total/category to createProject", async () => {
    mockApi.createProject.mockResolvedValue({ id: "proj_long" });
    mockApi.advance.mockResolvedValue({ current_stage: "STAGE1" });

    renderPage();
    await act(async () => {
      fireEvent.change(screen.getByTestId("intent-input"), { target: { value: "一个长篇" } });
    });
    await act(async () => {
      screen.getByTestId("length-宏大史诗巨著").click();
    });
    await act(async () => {
      screen.getByTestId("create-submit").click();
    });

    expect(mockApi.createProject).toHaveBeenCalledWith(
      expect.objectContaining({
        target_total_words: 3_000_000,
        target_length_category: "宏大史诗巨著",
        min_words: 2000,
      }),
    );
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

// v1.8.2: HomePage now owns the single /api/project/list fetch. Before this,
// both HomePage AND BookShelf fetched independently, doubling the request.
// This test pins the contract: exactly one call per mount.
describe("HomePage /api/project/list fetch", () => {
  it("calls listProjects exactly once on mount", async () => {
    renderPage();
    // wait for the shelf to render so the useEffect has fired
    expect(await screen.findByTestId("book-shelf")).toBeInTheDocument();
    expect(mockApi.listProjects).toHaveBeenCalledTimes(1);
  });

  it("renders BookShelf cards sorted by the fetched updated_at", async () => {
    mockApi.listProjects.mockResolvedValue([
      {
        id: "old", title: "旧", genre: "cool_novel", current_stage: "STAGE4",
        created_at: "2026-06-30T00:00:00", updated_at: 100, min_words: 4000,
        target_total_words: 4_000_000, target_length_category: "标准商业连载",
      },
      {
        id: "new", title: "新", genre: "cool_novel", current_stage: "STAGE4",
        created_at: "2026-01-01T00:00:00", updated_at: 999, min_words: 4000,
        target_total_words: 4_000_000, target_length_category: "标准商业连载",
      },
    ]);
    renderPage();
    expect(await screen.findByText("新")).toBeInTheDocument();
    const cards = screen.getAllByRole("row");
    expect(cards[0]).toHaveTextContent("新");
    expect(cards[1]).toHaveTextContent("旧");
  });
});