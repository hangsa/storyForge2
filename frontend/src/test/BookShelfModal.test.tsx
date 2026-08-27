import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("../api/client", () => ({
  default: {
    bulkDeleteProjects: vi.fn(),
  },
}));

// v1.9 genre-catalog unification: BookShelfModal now calls useGenres() (instead
// of importing the static GENRE_LABELS map). Stub the hook so we don't need a
// real API call in unit tests.
vi.mock("../hooks/useGenres", () => ({
  useGenres: () => [
    { id: "cool_novel", label_zh: "爽文", label_en: "Power Fantasy", family: "power_fantasy", ui_visible: true },
    { id: "xianxia", label_zh: "仙侠", label_en: "Xianxia", family: "cultivation", ui_visible: true },
    { id: "xuanyi", label_zh: "悬疑", label_en: "Mystery", family: "mystery", ui_visible: true },
  ],
}));

import api from "../api/client";
import BookShelfModal from "../components/home/BookShelfModal";

type ModalProps = Parameters<typeof BookShelfModal>[0];
type Proj = ModalProps["projects"][number];

function renderModal(props: Partial<ModalProps> = {}) {
  const projects = props.projects ?? ([
    { id: "proj_a", title: "诡眼少年", genre: "cool_novel", current_stage: "STAGE4", created_at: "2026-07-10T00:00:00", updated_at: 1, min_words: 4000, target_total_words: 4000, target_length_category: "", chapter_count: 0, word_count: 0 },
    { id: "proj_b", title: "测试小说", genre: "cool_novel", current_stage: "INIT", created_at: "2026-07-09T00:00:00", updated_at: 0, min_words: 4000, target_total_words: 4000, target_length_category: "", chapter_count: 0, word_count: 0 },
  ] as Proj[]);
  return render(
    <MemoryRouter>
      <BookShelfModal
        projects={projects}
        onClose={props.onClose ?? (() => {})}
        onProjectsDeleted={props.onProjectsDeleted}
      />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  (api.bulkDeleteProjects as ReturnType<typeof vi.fn>).mockReset();
});

describe("BookShelfModal navigation", () => {
  // v1.9: workspace defaults to manual mode, so the entry URL no longer
  // forces ?mode=managed — the user opts into managed via the top-bar switcher.
  it("links STAGE4 projects to /workspace (default manual mode)", () => {
    renderModal({ projects: [
      { id: "proj_post", title: "已完成", genre: "cool_novel", current_stage: "STAGE4", created_at: "2026-07-10T00:00:00", updated_at: 0, min_words: 4000, target_total_words: 4000, target_length_category: "", chapter_count: 0, word_count: 0 },
    ] });
    const link = screen.getByRole("link", { name: /已完成/ });
    expect(link.getAttribute("href")).toBe("/project/proj_post/workspace");
  });

  it("links INIT/STAGE1-3 projects to /wizard so users can resume initialization", () => {
    renderModal({ projects: [
      { id: "proj_pre", title: "未完成", genre: "cool_novel", current_stage: "STAGE2", created_at: "2026-07-09T00:00:00", updated_at: 0, min_words: 4000, target_total_words: 4000, target_length_category: "", chapter_count: 0, word_count: 0 },
    ] });
    const link = screen.getByRole("link", { name: /未完成/ });
    expect(link.getAttribute("href")).toBe("/project/proj_pre/wizard");
  });

  it("links STAGE5 (diagnosis) projects to /stage5 instead of the workspace", () => {
    renderModal({ projects: [
      { id: "diag", title: "诊断项目", genre: "cool_novel", current_stage: "STAGE5", created_at: "2026-07-12T00:00:00", updated_at: 0, min_words: 4000, target_total_words: 4000, target_length_category: "", chapter_count: 0, word_count: 0 },
    ] });
    const link = screen.getByRole("link", { name: /诊断项目/ });
    expect(link.getAttribute("href")).toBe("/project/diag/stage5");
  });

  it("links STAGE6 (export) projects to /stage6 instead of the workspace", () => {
    renderModal({ projects: [
      { id: "export", title: "导出项目", genre: "cool_novel", current_stage: "STAGE6", created_at: "2026-07-12T00:00:00", updated_at: 0, min_words: 4000, target_total_words: 4000, target_length_category: "", chapter_count: 0, word_count: 0 },
    ] });
    const link = screen.getByRole("link", { name: /导出项目/ });
    expect(link.getAttribute("href")).toBe("/project/export/stage6");
  });
});

describe("BookShelfModal default-select mode", () => {
  it("bulk-action-bar is hidden by default (no selections yet)", () => {
    renderModal();
    expect(screen.queryByTestId("bulk-action-bar")).not.toBeInTheDocument();
  });

  it("does NOT render a 多选 toggle button (selection is default)", () => {
    renderModal();
    expect(screen.queryByRole("button", { name: /多选/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /退出多选/ })).not.toBeInTheDocument();
  });

  it("全选 and 全不选 are visible in the header by default (not gated by selection)", () => {
    renderModal();
    expect(screen.getByRole("button", { name: /^全选$/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^全不选$/ })).toBeInTheDocument();
  });

  it("clicking a card body toggles selection and reveals the bulk-action-bar", () => {
    renderModal();
    expect(screen.queryByTestId("bulk-action-bar")).not.toBeInTheDocument();
    const card = screen.getByText("诡眼少年").closest('[data-testid="book-card-modal"]')!;
    act(() => { card.click(); });
    expect(screen.getByTestId("bulk-action-bar")).toBeInTheDocument();
    expect(screen.getByText(/已选 1 项/)).toBeInTheDocument();
  });

  it("clicking a card body twice toggles selection off and hides the bulk-action-bar", () => {
    renderModal();
    const card = screen.getByText("诡眼少年").closest('[data-testid="book-card-modal"]')!;
    act(() => { card.click(); });
    expect(screen.getByTestId("bulk-action-bar")).toBeInTheDocument();
    act(() => { card.click(); });
    expect(screen.queryByTestId("bulk-action-bar")).not.toBeInTheDocument();
  });

  it("clicking 全选 selects every currently visible (filtered) project", () => {
    renderModal();
    expect(screen.queryByTestId("bulk-action-bar")).not.toBeInTheDocument();
    act(() => { screen.getByRole("button", { name: /^全选$/ }).click(); });
    expect(screen.getByText(/已选 2 项/)).toBeInTheDocument();
    expect(screen.getByTestId("bulk-action-bar")).toBeInTheDocument();
  });

  it("clicking 全选 after a search filter only selects the filtered projects", () => {
    renderModal();
    const search = screen.getByPlaceholderText("搜索");
    fireEvent.change(search, { target: { value: "诡眼" } });
    act(() => { screen.getByRole("button", { name: /^全选$/ }).click(); });
    expect(screen.getByText(/已选 1 项/)).toBeInTheDocument();
  });

  it("clicking 全不选 clears selection and hides the bulk-action-bar", () => {
    renderModal();
    act(() => { screen.getByRole("button", { name: /^全选$/ }).click(); });
    expect(screen.getByText(/已选 2 项/)).toBeInTheDocument();
    act(() => { screen.getByRole("button", { name: /^全不选$/ }).click(); });
    expect(screen.queryByTestId("bulk-action-bar")).not.toBeInTheDocument();
  });

  it("clicking the card title navigates (does NOT toggle selection)", () => {
    renderModal();
    const titleLink = screen.getByRole("link", { name: /诡眼少年/ });
    expect(titleLink.getAttribute("href")).toBe("/project/proj_a/workspace");
    fireEvent.click(titleLink);
    expect(screen.queryByTestId("bulk-action-bar")).not.toBeInTheDocument();
  });

  it("selection persists when the search filter narrows the result", () => {
    renderModal();
    const cards = document.querySelectorAll('[data-testid="book-card-modal"]');
    act(() => { (cards[0] as HTMLElement).click(); });
    act(() => { (cards[1] as HTMLElement).click(); });
    expect(screen.getByText(/已选 2 项/)).toBeInTheDocument();
    const search = screen.getByPlaceholderText("搜索");
    fireEvent.change(search, { target: { value: "诡眼" } });
    expect(screen.getByText(/已选 2 项/)).toBeInTheDocument();
  });

  it("batch-delete confirm calls bulkDeleteProjects and notifies parent via onProjectsDeleted", async () => {
    (api.bulkDeleteProjects as ReturnType<typeof vi.fn>).mockResolvedValue({
      deleted: ["proj_a", "proj_b"], failed: [], deleted_count: 2, failed_count: 0,
    });
    const onProjectsDeleted = vi.fn();
    renderModal({ onProjectsDeleted });
    const cards = document.querySelectorAll('[data-testid="book-card-modal"]');
    act(() => {
      (cards[0] as HTMLElement).click();
      (cards[1] as HTMLElement).click();
    });
    expect(screen.getByText(/已选 2 项/)).toBeInTheDocument();
    await act(async () => {
      screen.getByRole("button", { name: /批量删除/ }).click();
    });
    await act(async () => {
      screen.getByRole("button", { name: "确认删除" }).click();
    });
    expect(api.bulkDeleteProjects).toHaveBeenCalledTimes(1);
    expect(api.bulkDeleteProjects).toHaveBeenCalledWith(
      expect.arrayContaining(["proj_a", "proj_b"]),
    );
    expect(onProjectsDeleted).toHaveBeenCalledWith(["proj_a", "proj_b"]);
  });
});