import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import BookShelf from "../components/home/BookShelf";
import api from "../api/client";
import type { ProjectSummary } from "../api/client";

const PROJECTS: ProjectSummary[] = [
  {
    id: "p1", title: "翻天", genre: "xuanhuan", current_stage: "STAGE4",
    created_at: "2026-01-01T00:00:00Z", updated_at: 1700000100,
    min_words: 1000, target_total_words: 200000, target_length_category: "标准连载",
    chapter_count: 118, word_count: 452000,
  },
  {
    id: "p2", title: "另一书", genre: "yanqing", current_stage: "COMPLETED",
    created_at: "2026-01-02T00:00:00Z", updated_at: 1700000000,
    min_words: 1000, target_total_words: 50000, target_length_category: "短篇",
    chapter_count: 23, word_count: 121000,
  },
];

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(api, "bulkDeleteProjects").mockResolvedValue({
    deleted: ["p1"],
    failed: [],
    deleted_count: 1,
    failed_count: 0,
  });
});

describe("BookShelf table", () => {
  it("renders one row per project with stats columns", () => {
    render(<BookShelf projects={PROJECTS} loading={false} onProjectsDeleted={() => {}} />);
    expect(screen.getByText("翻天")).toBeInTheDocument();
    expect(screen.getByText("另一书")).toBeInTheDocument();
    expect(screen.getByText("118")).toBeInTheDocument();
    expect(screen.getByText("45.2w")).toBeInTheDocument();
    expect(screen.getByText("23")).toBeInTheDocument();
    expect(screen.getByText("12.1w")).toBeInTheDocument();
  });

  it("shows the loading spinner when loading is true and projects is empty", () => {
    render(<BookShelf projects={[]} loading onProjectsDeleted={() => {}} />);
    expect(screen.getByText("加载中…")).toBeInTheDocument();
  });

  it("shows the empty state when there are no projects at all", () => {
    render(<BookShelf projects={[]} loading={false} onProjectsDeleted={() => {}} />);
    expect(screen.getByText(/还没有项目/)).toBeInTheDocument();
  });

  it("filters by search input in real time", () => {
    render(<BookShelf projects={PROJECTS} loading={false} onProjectsDeleted={() => {}} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "翻天" } });
    expect(screen.getByText("翻天")).toBeInTheDocument();
    expect(screen.queryByText("另一书")).not.toBeInTheDocument();
  });

  it("disables the 删除 button when no rows are selected", () => {
    render(<BookShelf projects={PROJECTS} loading={false} onProjectsDeleted={() => {}} />);
    const trigger = screen.getByTestId("bulk-delete-trigger");
    expect(trigger).toBeDisabled();
  });

  it("opens BulkDeleteModal when 删除 is clicked and forwards IDs on confirm", async () => {
    const onDeleted = vi.fn();
    render(<BookShelf projects={PROJECTS} loading={false} onProjectsDeleted={onDeleted} />);
    // First checkbox is the header select-all; row checkboxes follow.
    const checkboxes = screen.getAllByRole("checkbox");
    fireEvent.click(checkboxes[1]);
    fireEvent.click(screen.getByTestId("bulk-delete-trigger"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "删除" }));
    // Wait for the awaited api.bulkDeleteProjects to resolve
    await new Promise((r) => setTimeout(r, 0));
    expect(onDeleted).toHaveBeenCalledWith(["p1"]);
    expect(api.bulkDeleteProjects).toHaveBeenCalledWith(["p1"]);
  });

  it("toggles every visible row when the select-all checkbox is clicked", () => {
    render(<BookShelf projects={PROJECTS} loading={false} onProjectsDeleted={() => {}} />);
    const selectAll = screen.getByTestId("select-all");
    expect(selectAll).not.toBeChecked();

    fireEvent.click(selectAll);
    const rowCheckboxes = screen.getAllByRole("checkbox").slice(1);
    expect(rowCheckboxes).toHaveLength(PROJECTS.length);
    for (const cb of rowCheckboxes) expect(cb).toBeChecked();
    expect(screen.getByTestId("bulk-delete-trigger")).not.toBeDisabled();

    fireEvent.click(selectAll);
    for (const cb of rowCheckboxes) expect(cb).not.toBeChecked();
    expect(screen.getByTestId("bulk-delete-trigger")).toBeDisabled();
  });

  it("navigates to /project/<id>/stage4 when a post-wizard row is clicked", () => {
    const assignSpy = vi.fn();
    const originalAssign = window.location.assign;
    Object.defineProperty(window, "location", {
      value: { ...window.location, assign: assignSpy },
      writable: true,
      configurable: true,
    });
    try {
      render(<BookShelf projects={PROJECTS} loading={false} onProjectsDeleted={() => {}} />);
      // p1 has STAGE4 — row body click should navigate to /project/p1/stage4
      fireEvent.click(screen.getByText("翻天"));
      expect(assignSpy).toHaveBeenCalledWith("/project/p1/stage4");
    } finally {
      Object.defineProperty(window, "location", {
        value: { ...window.location, assign: originalAssign },
        writable: true,
        configurable: true,
      });
    }
  });

  it("re-opens the wizard via onResumeWizard when a pre-wizard row is clicked", () => {
    const onResume = vi.fn();
    const projects: ProjectSummary[] = [
      {
        ...PROJECTS[0],
        id: "init1",
        title: "未开张",
        current_stage: "INIT",
      },
    ];
    render(<BookShelf projects={projects} loading={false} onProjectsDeleted={() => {}} onResumeWizard={onResume} />);
    fireEvent.click(screen.getByText("未开张"));
    expect(onResume).toHaveBeenCalledWith("init1");
  });

  it("fires onRefresh when 查询 is clicked, even with no filters set", () => {
    const onRefresh = vi.fn();
    render(<BookShelf projects={PROJECTS} loading={false} onProjectsDeleted={() => {}} onRefresh={onRefresh} />);
    fireEvent.click(screen.getByRole("button", { name: "查询" }));
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it("applies local genre/length filters AND fires onRefresh when 查询 is clicked", () => {
    const onRefresh = vi.fn();
    const projects: ProjectSummary[] = [
      { ...PROJECTS[0], genre: "xuanhuan", target_length_category: "标准连载" },
      { ...PROJECTS[1], genre: "yanqing", target_length_category: "短篇" },
    ];
    render(<BookShelf projects={projects} loading={false} onProjectsDeleted={() => {}} onRefresh={onRefresh} />);
    // Open the 题材 dropdown and pick 玄幻. The table also has a 题材
    // header button, so scope to the dropdown container.
    const genreDropdown = screen.getByRole("button", { name: /题材.*所有题材/ });
    fireEvent.click(genreDropdown);
    fireEvent.click(screen.getByRole("button", { name: "玄幻" }));
    // filtersApplied is still false, so the 言情 row remains visible until 查询.
    expect(screen.getByText("翻天")).toBeInTheDocument();
    expect(screen.getByText("另一书")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "查询" }));
    expect(onRefresh).toHaveBeenCalledTimes(1);
    // 玄幻 row still visible, 言情 row filtered out — onRefresh is additive,
    // it doesn't undo the local filter.
    expect(screen.getByText("翻天")).toBeInTheDocument();
    expect(screen.queryByText("另一书")).not.toBeInTheDocument();
  });
});
