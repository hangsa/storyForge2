import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
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

const GENRES = [
  { id: "cool_novel", label_zh: "爽文", label_en: "Power Fantasy", family: "power_fantasy" },
  { id: "xianxia",    label_zh: "仙侠", label_en: "Xianxia",        family: "cultivation" },
  { id: "xuanhuan",   label_zh: "玄幻", label_en: "Xuanhuan",       family: "cultivation" },
  { id: "dushi",      label_zh: "都市", label_en: "Contemporary",   family: "contemporary" },
  { id: "kehuan",     label_zh: "科幻", label_en: "Sci-Fi",         family: "sci_fi" },
  { id: "xuanyi",     label_zh: "悬疑", label_en: "Mystery",        family: "mystery" },
  { id: "yanqing",    label_zh: "言情", label_en: "Romance",        family: "romance" },
];

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(api, "bulkDeleteProjects").mockResolvedValue({
    deleted: ["p1"],
    failed: [],
    deleted_count: 1,
    failed_count: 0,
  });
  // useGenres() resolves its option list asynchronously on first mount; mock
  // it so the 题材/篇幅/阶段 dropdowns actually have entries to render.
  vi.spyOn(api, "listGenres").mockResolvedValue(GENRES);
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
    expect(screen.getByText("正在加载项目…")).toBeInTheDocument();
  });

  it("shows the empty state when there are no projects at all", () => {
    render(<BookShelf projects={[]} loading={false} onProjectsDeleted={() => {}} />);
    expect(screen.getByText(/还没有项目/)).toBeInTheDocument();
  });

  it("does not filter until 查询 is clicked (search input is held locally)", () => {
    // Mirrors the dropdowns' behavior: typing in the search box updates
    // local state but doesn't narrow the table until the user commits
    // via 查询. Avoids per-keystroke re-renders and chained-condition
    // thrash.
    const onRefresh = vi.fn();
    render(<BookShelf projects={PROJECTS} loading={false} onProjectsDeleted={() => {}} onRefresh={onRefresh} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "翻天" } });
    // Both rows still visible before 查询 — no narrowing yet.
    expect(screen.getByText("翻天")).toBeInTheDocument();
    expect(screen.getByText("另一书")).toBeInTheDocument();
    expect(onRefresh).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "查询" }));
    expect(onRefresh).toHaveBeenCalledTimes(1);
    // After 查询, the search narrows the list.
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

  it("header checkbox and row checkboxes share the same visual classes", () => {
    // Both render through TableCheckbox — same wrapper + same input classes.
    // This guards against future drift where someone tweaks one in isolation.
    const { container } = render(<BookShelf projects={PROJECTS} loading={false} onProjectsDeleted={() => {}} />);
    const selectAll = screen.getByTestId("select-all");
    const rowCheckboxes = screen.getAllByRole("checkbox").slice(1);
    const expectedClasses = "w-4 h-4 accent-primary";
    expect(selectAll.className).toContain(expectedClasses);
    for (const cb of rowCheckboxes) {
      expect(cb.className).toContain(expectedClasses);
    }
    // Wrapper divs should also be identical.
    const headerWrapper = container.querySelector('[data-testid="select-all"]')?.parentElement;
    const rowWrapper = rowCheckboxes[0].parentElement;
    expect(headerWrapper?.className).toBe(rowWrapper?.className);
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

  it("重置 button clears every filter back to defaults without firing onRefresh", async () => {
    const onRefresh = vi.fn();
    render(<BookShelf projects={PROJECTS} loading={false} onProjectsDeleted={() => {}} onRefresh={onRefresh} />);
    // Fill every slot, then commit via 查询 so the table actually narrows.
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "翻天" } });
    fireEvent.click(screen.getByRole("button", { name: /题材.*所有题材/ }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "玄幻" })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: "玄幻" }));
    fireEvent.click(screen.getByRole("button", { name: "查询" }));
    expect(screen.queryByText("另一书")).not.toBeInTheDocument();
    expect(onRefresh).toHaveBeenCalledTimes(1);
    // Click 重置 — every condition should snap back. No second fetch:
    // the table is already showing server truth.
    fireEvent.click(screen.getByTestId("reset-filters"));
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(screen.getByText("翻天")).toBeInTheDocument();
    expect(screen.getByText("另一书")).toBeInTheDocument();
    expect((screen.getByRole("textbox") as HTMLInputElement).value).toBe("");
    expect(screen.getByRole("button", { name: /题材.*所有题材/ })).toBeInTheDocument();
  });

  it("applies local genre/length filters AND fires onRefresh when 查询 is clicked", async () => {
    const onRefresh = vi.fn();
    const projects: ProjectSummary[] = [
      { ...PROJECTS[0], genre: "xuanhuan", target_length_category: "标准连载" },
      { ...PROJECTS[1], genre: "yanqing", target_length_category: "短篇" },
    ];
    render(<BookShelf projects={projects} loading={false} onProjectsDeleted={() => {}} onRefresh={onRefresh} />);
    // Open the 题材 dropdown, then wait for useGenres() to resolve so 玄幻
    // appears as an option. (Options only render once the dropdown is open.)
    const genreDropdown = screen.getByRole("button", { name: /题材.*所有题材/ });
    fireEvent.click(genreDropdown);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "玄幻" })).toBeInTheDocument();
    });
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

// Generates N projects with predictable ids/titles so pagination tests can
// reason about which page should contain which row. updated_at is set so
// 书1 has the most-recent timestamp — BookShelf's default sort is desc by
// updated_at, which means 书1 lands at the top of the list and ends up on
// page 1. (Without this, default-sort would flip the order and page-1
// assertions would all break.)
function makeProjects(n: number): ProjectSummary[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `p${i + 1}`,
    title: `书${i + 1}`,
    genre: "xuanhuan",
    current_stage: "STAGE4" as const,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: 1_700_000_000 + (n - i),
    min_words: 1000,
    target_total_words: 100000,
    target_length_category: "标准连载",
    chapter_count: 10,
    word_count: 30000,
  }));
}

describe("BookShelf pagination", () => {
  it("does not render a 书架 title header at the top of the section", () => {
    // The page-level header was removed so the table can sit flush under
    // HomePage's main column without a redundant title. Total count lives
    // in the pagination footer instead (bookshelf-total).
    render(<BookShelf projects={PROJECTS} loading={false} onProjectsDeleted={() => {}} />);
    expect(screen.queryByRole("heading", { name: "书架" })).not.toBeInTheDocument();
    // Total count now lives in the footer, not the (gone) header.
    expect(screen.getByTestId("bookshelf-total").textContent).toBe("共 2 本");
  });

  it("renders the page-size selector with default 15 / 页", () => {
    render(<BookShelf projects={makeProjects(20)} loading={false} onProjectsDeleted={() => {}} />);
    // Default label on the page-size dropdown.
    expect(screen.getByRole("button", { name: /每页.*15/ })).toBeInTheDocument();
  });

  it("shows total book count (共 N 本) in the pagination footer", () => {
    render(<BookShelf projects={makeProjects(20)} loading={false} onProjectsDeleted={() => {}} />);
    expect(screen.getByTestId("bookshelf-total").textContent).toBe("共 20 本");
  });

  it("paginates by default 15 per page and shows only 15 rows on page 1", () => {
    render(<BookShelf projects={makeProjects(20)} loading={false} onProjectsDeleted={() => {}} />);
    // 15 of the 20 should be rendered (page 1).
    expect(screen.getByTestId("pager-current").textContent).toBe("1 / 2");
    for (let i = 1; i <= 15; i++) {
      expect(screen.getByText(`书${i}`)).toBeInTheDocument();
    }
    for (let i = 16; i <= 20; i++) {
      expect(screen.queryByText(`书${i}`)).not.toBeInTheDocument();
    }
  });

  it("navigates to the next page and back via the prev button", () => {
    render(<BookShelf projects={makeProjects(20)} loading={false} onProjectsDeleted={() => {}} />);
    fireEvent.click(screen.getByTestId("pager-next"));
    expect(screen.getByTestId("pager-current").textContent).toBe("2 / 2");
    // Page 2 holds rows 16-20.
    for (let i = 16; i <= 20; i++) {
      expect(screen.getByText(`书${i}`)).toBeInTheDocument();
    }
    expect(screen.queryByText("书1")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("pager-prev"));
    expect(screen.getByTestId("pager-current").textContent).toBe("1 / 2");
    expect(screen.getByText("书1")).toBeInTheDocument();
    expect(screen.queryByText("书16")).not.toBeInTheDocument();
  });

  it("disables first/prev on page 1 and next/last on the last page", () => {
    render(<BookShelf projects={makeProjects(20)} loading={false} onProjectsDeleted={() => {}} />);
    expect(screen.getByTestId("pager-first")).toBeDisabled();
    expect(screen.getByTestId("pager-prev")).toBeDisabled();
    expect(screen.getByTestId("pager-next")).not.toBeDisabled();
    expect(screen.getByTestId("pager-last")).not.toBeDisabled();

    fireEvent.click(screen.getByTestId("pager-last"));
    expect(screen.getByTestId("pager-next")).toBeDisabled();
    expect(screen.getByTestId("pager-last")).toBeDisabled();
    expect(screen.getByTestId("pager-first")).not.toBeDisabled();
    expect(screen.getByTestId("pager-prev")).not.toBeDisabled();
  });

  it("changes the page size to 30 / 页 and re-renders all rows on page 1", async () => {
    render(<BookShelf projects={makeProjects(20)} loading={false} onProjectsDeleted={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /每页.*15/ }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "30 / 页" })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: "30 / 页" }));
    // After switching to 30 per page, all 20 fit on page 1.
    expect(screen.getByTestId("pager-current").textContent).toBe("1 / 1");
    for (let i = 1; i <= 20; i++) {
      expect(screen.getByText(`书${i}`)).toBeInTheDocument();
    }
  });

  it("changing page size resets to page 1", () => {
    render(<BookShelf projects={makeProjects(40)} loading={false} onProjectsDeleted={() => {}} />);
    // 40 projects at 15/page = 3 pages. Jump to page 3.
    fireEvent.click(screen.getByTestId("pager-last"));
    expect(screen.getByTestId("pager-current").textContent).toBe("3 / 3");
    // Switch to 50/page — page should snap back to 1.
    fireEvent.click(screen.getByRole("button", { name: /每页.*15/ }));
    fireEvent.click(screen.getByRole("button", { name: "50 / 页" }));
    expect(screen.getByTestId("pager-current").textContent).toBe("1 / 1");
  });

  it("clamps page when filters narrow the dataset below the current page", async () => {
    const projects = makeProjects(40).map((p, i) => ({
      ...p,
      // Make every title unique so the search narrows to exactly one match.
      title: i === 0 ? "独苗书" : `填充${i}`,
    }));
    render(<BookShelf projects={projects} loading={false} onProjectsDeleted={() => {}} onRefresh={vi.fn()} />);
    fireEvent.click(screen.getByTestId("pager-last"));
    expect(screen.getByTestId("pager-current").textContent).toBe("3 / 3");
    // Search for the unique title — narrows the dataset to a single row.
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "独苗" } });
    fireEvent.click(screen.getByRole("button", { name: "查询" }));
    await waitFor(() => {
      expect(screen.getByTestId("pager-current").textContent).toBe("1 / 1");
    });
    expect(screen.getByTestId("bookshelf-total").textContent).toBe("共 1 本");
  });

  it("select-all toggles only the rows on the current page", async () => {
    const projects = makeProjects(20);
    const onDeleted = vi.fn();
    render(<BookShelf projects={projects} loading={false} onProjectsDeleted={onDeleted} />);
    // Page 1 (1-15): click select-all.
    fireEvent.click(screen.getByTestId("select-all"));
    const page1Ids = projects.slice(0, 15).map((p) => p.id);
    for (const id of page1Ids) {
      expect(screen.getByTestId(`row-select-${id}`)).toBeChecked();
    }
    // Jump to page 2 — those rows should NOT be selected.
    fireEvent.click(screen.getByTestId("pager-next"));
    for (let i = 16; i <= 20; i++) {
      expect(screen.getByTestId(`row-select-p${i}`)).not.toBeChecked();
    }
    // Selecting on page 2 should add to the existing selection, not replace it.
    fireEvent.click(screen.getByTestId("select-all"));
    const page2Ids = projects.slice(15, 20).map((p) => p.id);
    for (const id of page2Ids) {
      expect(screen.getByTestId(`row-select-${id}`)).toBeChecked();
    }
    // Bulk-delete modal should report all 20 selected ids.
    fireEvent.click(screen.getByTestId("bulk-delete-trigger"));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "删除" }));
    await new Promise((r) => setTimeout(r, 0));
    expect(api.bulkDeleteProjects).toHaveBeenCalledWith(expect.arrayContaining(page1Ids.concat(page2Ids)));
    expect(onDeleted).toHaveBeenCalledTimes(1);
  });

  it("wraps rows in a scrollable container so the footer is never hidden by overflow", () => {
    render(<BookShelf projects={makeProjects(50)} loading={false} onProjectsDeleted={() => {}} />);
    const rowsArea = screen.getByTestId("bookshelf-rows");
    expect(rowsArea.className).toContain("overflow-y-auto");
    // The footer lives outside the scroll area — it's a sibling, so overflow
    // can't push it off-screen.
    const footer = screen.getByTestId("bookshelf-footer");
    expect(footer).toBeInTheDocument();
    expect(footer.contains(screen.getByTestId("bookshelf-total"))).toBe(true);
    expect(footer.contains(screen.getByTestId("bookshelf-pager"))).toBe(true);
  });

  it("page-size selector opens upward so its menu isn't clipped by the card", () => {
    render(<BookShelf projects={makeProjects(20)} loading={false} onProjectsDeleted={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /每页.*15/ }));
    const menu = screen.getByRole("button", { name: "30 / 页" }).parentElement;
    // DropdownSelect renders the menu with `bottom-full` when direction="up"
    // — opens above the trigger instead of being clipped by the rounded card
    // the footer sits inside.
    expect(menu?.className).toContain("bottom-full");
    expect(menu?.className).not.toContain("top-full");
  });

  it("leaves pl-4 padding on the search row and action row so they don't hug the sidebar", () => {
    render(
      <BookShelf
        projects={makeProjects(20)}
        loading={false}
        onProjectsDeleted={() => {}}
        onOpenCreate={() => {}}
      />
    );
    // Search row contains the search input; action row contains 新建项目/删除/查询.
    const searchRow = screen.getByRole("textbox").parentElement!.parentElement!;
    const createBtn = screen.getByRole("button", { name: "+ 新建项目" });
    const actionRow = createBtn.parentElement!;
    expect(searchRow.className).toContain("pl-4");
    expect(actionRow.className).toContain("pl-4");
    // Sanity: the rows area + footer don't inherit the left padding —
    // only the two header rows do, so the table card can still sit flush
    // with the left edge per the spec.
    expect(screen.getByTestId("bookshelf-rows").className).not.toContain("pl-4");
    expect(screen.getByTestId("bookshelf-footer").className).not.toContain("pl-4");
  });

  it("table card has a fixed height so the rows area scrolls internally, not the page", () => {
    render(<BookShelf projects={makeProjects(50)} loading={false} onProjectsDeleted={() => {}} />);
    const card = screen.getByTestId("bookshelf-card");
    // Fixed height via inline style — keeps the pagination footer pinned
    // to the card's bottom while the rows area scrolls.
    expect(card.style.height).toBe("640px");
    expect(card.className).toContain("flex-col");
    // Section itself is NOT flex-1 / not filling the viewport — the page
    // scrolls naturally above the card.
    const shelf = screen.getByTestId("book-shelf");
    expect(shelf.className).not.toContain("flex-1");
    expect(shelf.className).not.toContain("min-h-0");
  });

  it("bookshelf-footer stays anchored at the bottom (shrink-0) while rows scroll", () => {
    render(<BookShelf projects={makeProjects(50)} loading={false} onProjectsDeleted={() => {}} />);
    const footer = screen.getByTestId("bookshelf-footer");
    const rows = screen.getByTestId("bookshelf-rows");
    expect(footer.className).toContain("shrink-0");
    // Rows are the scrolling region — flex-1, not shrink-0.
    expect(rows.className).not.toContain("shrink-0");
    expect(rows.className).toContain("overflow-y-auto");
  });

  it("重置 button also resets the page to 1", () => {
    render(<BookShelf projects={makeProjects(40)} loading={false} onProjectsDeleted={() => {}} />);
    fireEvent.click(screen.getByTestId("pager-last"));
    expect(screen.getByTestId("pager-current").textContent).toBe("3 / 3");
    fireEvent.click(screen.getByTestId("reset-filters"));
    // 重置 only clears filters, not data — page snaps to 1 but total
    // pages stays at 3 (40 projects / 15 per page).
    expect(screen.getByTestId("pager-current").textContent).toBe("1 / 3");
    expect(screen.getByTestId("bookshelf-total").textContent).toBe("共 40 本");
  });
});
