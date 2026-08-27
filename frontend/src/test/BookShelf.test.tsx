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
    skipped: [],
  } as unknown as Awaited<ReturnType<typeof api.bulkDeleteProjects>>);
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

  it("exposes the bulk action bar after a row is selected", () => {
    render(<BookShelf projects={PROJECTS} loading={false} onProjectsDeleted={() => {}} />);
    const checkboxes = screen.getAllByRole("checkbox");
    fireEvent.click(checkboxes[0]);
    expect(screen.getByText(/1 已选/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "删除" })).toBeInTheDocument();
  });

  it("opens BulkDeleteModal when 删除 is clicked and forwards IDs on confirm", async () => {
    const onDeleted = vi.fn();
    render(<BookShelf projects={PROJECTS} loading={false} onProjectsDeleted={onDeleted} />);
    const checkboxes = screen.getAllByRole("checkbox");
    fireEvent.click(checkboxes[0]);
    fireEvent.click(screen.getByRole("button", { name: "删除" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "删除" }));
    // Wait for the awaited api.bulkDeleteProjects to resolve
    await new Promise((r) => setTimeout(r, 0));
    expect(onDeleted).toHaveBeenCalledWith(["p1"]);
    expect(api.bulkDeleteProjects).toHaveBeenCalledWith(["p1"]);
  });
});
