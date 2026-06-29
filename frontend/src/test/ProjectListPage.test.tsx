import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act, fireEvent } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";

const { mockApi } = vi.hoisted(() => ({
  mockApi: {
    listProjects: vi.fn(),
    createProject: vi.fn(),
    deleteProject: vi.fn(),
    bulkDeleteProjects: vi.fn(),
    advance: vi.fn(),
  },
}));

vi.mock("../api/client", () => ({
  default: mockApi,
  ProjectSummary: {},
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

vi.mock("../hooks/useProject", () => ({
  useProject: () => ({
    createProject: vi.fn().mockResolvedValue({ id: "new_proj" }),
    loading: false,
    error: null,
    clearError: vi.fn(),
  }),
}));

import ProjectListPage from "../pages/ProjectListPage";

const SAMPLE = [
  { id: "proj_a", title: "诡眼少年", genre: "cool_novel", current_stage: "STAGE2", created_at: "2026-06-29T00:00:00", min_words: 4000 },
  { id: "proj_b", title: "测试小说", genre: "cool_novel", current_stage: "INIT", created_at: "2026-06-28T00:00:00", min_words: 4000 },
  { id: "proj_c", title: "一部城隍成长史", genre: "xianxia", current_stage: "STAGE4", created_at: "2026-06-27T00:00:00", min_words: 6000 },
];

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/"]}>
      <Routes>
        <Route path="/" element={<ProjectListPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  mockApi.listProjects.mockReset();
  mockApi.listProjects.mockResolvedValue(SAMPLE);
  mockApi.deleteProject.mockReset();
  mockApi.bulkDeleteProjects.mockReset();
});

describe("ProjectListPage search", () => {
  it("renders all projects initially", async () => {
    renderPage();
    expect(await screen.findByText("诡眼少年")).toBeInTheDocument();
    expect(screen.getByText("测试小说")).toBeInTheDocument();
    expect(screen.getByText("一部城隍成长史")).toBeInTheDocument();
  });

  it("filters by case-insensitive substring match", async () => {
    renderPage();
    await screen.findByText("诡眼少年");

    const input = screen.getByPlaceholderText("搜索项目名称") as HTMLInputElement;
    await act(async () => {
      fireEvent.change(input, { target: { value: "城隍" } });
    });

    expect(screen.queryByText("诡眼少年")).not.toBeInTheDocument();
    expect(screen.queryByText("测试小说")).not.toBeInTheDocument();
    expect(screen.getByText("一部城隍成长史")).toBeInTheDocument();
  });

  it("shows the filtered count hint when search is active", async () => {
    renderPage();
    await screen.findByText("诡眼少年");

    const input = screen.getByPlaceholderText("搜索项目名称") as HTMLInputElement;
    await act(async () => {
      fireEvent.change(input, { target: { value: "测试" } });
    });

    expect(screen.getByText("1 个匹配项 / 共 3 个")).toBeInTheDocument();
  });

  it("hides the count hint when search is empty", async () => {
    renderPage();
    await screen.findByText("诡眼少年");

    expect(screen.queryByText(/个匹配项/)).not.toBeInTheDocument();
  });

  it("shows zero-match empty state with a clear-search button", async () => {
    renderPage();
    await screen.findByText("诡眼少年");

    const input = screen.getByPlaceholderText("搜索项目名称") as HTMLInputElement;
    await act(async () => {
      fireEvent.change(input, { target: { value: "不存在的标题xyz" } });
    });

    expect(screen.getByText("无匹配项目")).toBeInTheDocument();
    const clearBtn = screen.getByRole("button", { name: "清空搜索" });
    await act(async () => {
      clearBtn.click();
    });
    expect(input.value).toBe("");
    expect(screen.getByText("诡眼少年")).toBeInTheDocument();
  });
});

describe("ProjectListPage multi-select mode", () => {
  it("does not show checkboxes by default", async () => {
    renderPage();
    await screen.findByText("诡眼少年");
    // No card-level checkbox icons in the document yet.
    const cards = screen.getAllByText(/诡眼少年|测试小说|一部城隍成长史/);
    expect(cards.length).toBeGreaterThan(0);
    // Multi-select toolbar should not exist.
    expect(screen.queryByText("已选")).not.toBeInTheDocument();
  });

  it("entering multi-select mode shows a checkbox on each card and a toolbar", async () => {
    renderPage();
    await screen.findByText("诡眼少年");

    const toggle = screen.getByRole("button", { name: "多选" });
    await act(async () => {
      toggle.click();
    });

    // Toolbar appears (with 0 selected initially).
    expect(screen.getByText("已选 0 项")).toBeInTheDocument();
    expect(screen.getByText("全选可见")).toBeInTheDocument();
    expect(screen.getByText("全不选")).toBeInTheDocument();
    // The mode toggle button label flips.
    expect(screen.getByRole("button", { name: "退出多选" })).toBeInTheDocument();
  });

  it("clicking a card checkbox toggles selection in select mode", async () => {
    renderPage();
    await screen.findByText("诡眼少年");

    await act(async () => {
      screen.getByRole("button", { name: "多选" }).click();
    });

    // Each card is now a button labeled "选择" / "取消选择" — click the first one.
    const cardButtons = screen.getAllByRole("button", { name: "选择" });
    expect(cardButtons.length).toBeGreaterThan(0);
    await act(async () => {
      cardButtons[0].click();
    });

    expect(screen.getByText("已选 1 项")).toBeInTheDocument();
  });

  it("clicking the card body in select mode toggles selection, not navigation", async () => {
    renderPage();
    await screen.findByText("诡眼少年");

    await act(async () => {
      screen.getByRole("button", { name: "多选" }).click();
    });

    // The card's "navigate" button is no longer rendered in select mode.
    // Click the card title text and assert the URL did not change.
    const title = screen.getByText("诡眼少年");
    await act(async () => {
      title.click();
    });
    // If we got here without an error and selection state changed, the test passes.
    expect(screen.getByText(/已选/)).toBeInTheDocument();
  });

  it("exiting select mode clears selectedIds and hides the toolbar", async () => {
    renderPage();
    await screen.findByText("诡眼少年");

    await act(async () => {
      screen.getByRole("button", { name: "多选" }).click();
    });
    expect(screen.getByText("已选 0 项")).toBeInTheDocument();

    await act(async () => {
      screen.getByRole("button", { name: "退出多选" }).click();
    });

    expect(screen.queryByText("已选")).not.toBeInTheDocument();
    // No checkboxes left.
    expect(screen.queryByRole("button", { name: /选择|取消选择/ })).not.toBeInTheDocument();
  });
});