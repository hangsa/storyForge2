import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// v1.8.2: BookShelf is now controlled — it no longer calls listProjects itself,
// but HomePage (which still does) shares the same mock module.
vi.mock("../api/client", () => ({
  default: {
    listProjects: vi.fn(),
    bulkDeleteProjects: vi.fn(),
    // v1.9 genre-catalog unification: CreateProjectCard now calls useGenres()
    // → api.listGenres(). Stub it so HomePage integration tests don't crash.
    listGenres: vi.fn().mockResolvedValue([
      { id: "cool_novel", label_zh: "爽文", label_en: "Power Fantasy", family: "power_fantasy", ui_visible: true },
      { id: "xuanyi", label_zh: "悬疑", label_en: "Mystery", family: "mystery", ui_visible: true },
    ]),
  },
}));

// v1.9 genre-catalog unification: BookShelf now calls useGenres() (instead of
// importing the static GENRE_LABELS map). Stub the hook so we don't need a
// real API call in unit tests.
vi.mock("../hooks/useGenres", () => ({
  useGenres: () => [
    { id: "cool_novel", label_zh: "爽文", label_en: "Power Fantasy", family: "power_fantasy", ui_visible: true },
    { id: "xianxia", label_zh: "仙侠", label_en: "Xianxia", family: "cultivation", ui_visible: true },
    { id: "xuanyi", label_zh: "悬疑", label_en: "Mystery", family: "mystery", ui_visible: true },
  ],
}));

import api from "../api/client";
import BookShelf from "../components/home/BookShelf";

// v1.8.2: BookShelf now sorts by `updated_at` DESC directly from each project,
// so the SAMPLE fixture orders updated_at descending — proj_a is newest, proj_f
// is oldest and falls below the visible top-5 window.
const SAMPLE = [
  { id: "proj_a", title: "诡眼少年", genre: "cool_novel", current_stage: "STAGE2", created_at: "2026-06-29T00:00:00", updated_at: 9000, target_total_words: 4_000_000, target_length_category: "标准商业连载", min_words: 4000 },
  { id: "proj_b", title: "测试小说", genre: "cool_novel", current_stage: "INIT", created_at: "2026-06-28T00:00:00", updated_at: 8000, target_total_words: 4_000_000, target_length_category: "标准商业连载", min_words: 4000 },
  { id: "proj_c", title: "一部城隍成长史", genre: "xianxia", current_stage: "STAGE4", created_at: "2026-06-27T00:00:00", updated_at: 7000, target_total_words: 6_000_000, target_length_category: "标准商业连载", min_words: 6000 },
  { id: "proj_d", title: "数据星河", genre: "kehuan", current_stage: "STAGE4", created_at: "2026-06-26T00:00:00", updated_at: 6000, target_total_words: 8_000_000, target_length_category: "标准商业连载", min_words: 8000 },
  { id: "proj_e", title: "山野笔记", genre: "dushi", current_stage: "STAGE1", created_at: "2026-06-25T00:00:00", updated_at: 5000, target_total_words: 5_000_000, target_length_category: "标准商业连载", min_words: 5000 },
  { id: "proj_f", title: "雪落无声", genre: "xianxia", current_stage: "STAGE4", created_at: "2026-06-24T00:00:00", updated_at: 4000, target_total_words: 5_000_000, target_length_category: "标准商业连载", min_words: 5000 },
];

beforeEach(() => {
  (api.bulkDeleteProjects as ReturnType<typeof vi.fn>).mockReset();
});

function renderShelf(props: {
  projects?: typeof SAMPLE;
  loading?: boolean;
  onProjectsDeleted?: (deletedIds: string[]) => void;
} = {}) {
  const onProjectsDeleted = props.onProjectsDeleted ?? vi.fn();
  return render(
    <BookShelf
      projects={props.projects ?? SAMPLE}
      loading={props.loading ?? false}
      onProjectsDeleted={onProjectsDeleted}
    />,
  );
}

describe("BookShelf", () => {
  it("limits visible books to 5 by default", async () => {
    renderShelf();
    await screen.findByText("诡眼少年");
    // 6 projects in SAMPLE — only 5 should appear initially.
    const titles = ["诡眼少年", "测试小说", "一部城隍成长史", "数据星河", "山野笔记"];
    titles.forEach((t) => expect(screen.getByText(t)).toBeInTheDocument());
    expect(screen.queryByText("雪落无声")).not.toBeInTheDocument();
  });

  it("sorts by updated_at desc (most recently updated first)", async () => {
    // Build a custom set where proj_f has the highest updated_at; everything
    // else gets a lower one. We replace the default SAMPLE so the sort test
    // doesn't conflict with the default ordering in `renderShelf`.
    const projects = SAMPLE.map((p, i) => ({
      ...p,
      updated_at: p.id === "proj_f" ? 9999 : 1000 + i,
    }));
    renderShelf({ projects });
    await screen.findByText("雪落无声");
    const cards = document.querySelectorAll('[data-testid="book-card"]');
    // proj_f is the newest → should be the first visible card.
    expect(cards[0].textContent).toContain("雪落无声");
    // proj_a is the oldest (updated_at 1000) → should be excluded from the top 5.
    expect(screen.queryByText("诡眼少年")).not.toBeInTheDocument();
  });

  it("filters by case-insensitive title match", async () => {
    renderShelf();
    await screen.findByText("诡眼少年");
    const input = screen.getByPlaceholderText(/搜索/) as HTMLInputElement;
    await act(async () => {
      fireEvent.change(input, { target: { value: "城隍" } });
    });
    expect(screen.queryByText("诡眼少年")).not.toBeInTheDocument();
    expect(screen.getByText("一部城隍成长史")).toBeInTheDocument();
  });

  it("shows zero-match empty state", async () => {
    renderShelf();
    await screen.findByText("诡眼少年");
    const input = screen.getByPlaceholderText(/搜索/);
    await act(async () => {
      fireEvent.change(input, { target: { value: "不存在的标题xyz" } });
    });
    expect(screen.getByText(/未找到匹配项目/)).toBeInTheDocument();
  });

  it("shows empty state when no projects at all", async () => {
    renderShelf({ projects: [] });
    expect(await screen.findByText(/还没有项目/)).toBeInTheDocument();
  });

  it("renders a '查看全部' button that opens the modal", async () => {
    renderShelf();
    await screen.findByText("诡眼少年");
    await act(async () => {
      screen.getByRole("button", { name: /查看全部/ }).click();
    });
    // The 6th project (雪落无声) now appears in the modal.
    expect(await screen.findByText("雪落无声")).toBeInTheDocument();
  });

  it("does not render the '多选' button on the shelf (it moved to the 查看全部 modal)", async () => {
    // The shelf is now display-only — selection / bulk-delete lives in the
    // modal. Asserting absence here guards against accidentally re-adding the
    // button to the shelf header.
    renderShelf();
    await screen.findByText("诡眼少年");
    expect(screen.queryByRole("button", { name: /多选/ })).not.toBeInTheDocument();
    expect(screen.queryByTestId("bulk-action-bar")).not.toBeInTheDocument();
  });

  it("opening the 查看全部 modal surfaces the 多选 button", async () => {
    renderShelf();
    await screen.findByText("诡眼少年");
    await act(async () => {
      screen.getByRole("button", { name: /查看全部/ }).click();
    });
    expect(await screen.findByRole("button", { name: /多选/ })).toBeInTheDocument();
  });

  it("INIT-stage book click navigates to the wizard deep-link", async () => {
    const assignSpy = vi.fn();
    const original = window.location.assign;
    Object.defineProperty(window, "location", {
      value: { ...window.location, assign: assignSpy },
      writable: true,
    });
    try {
      renderShelf();
      await screen.findByText("测试小说"); // proj_b has current_stage "INIT"
      const initCard = screen.getByText("测试小说").closest('[data-testid="book-card"]')!;
      await act(async () => {
        initCard.click();
      });
      expect(assignSpy).toHaveBeenCalledWith("/project/proj_b/wizard");
    } finally {
      Object.defineProperty(window, "location", {
        value: { ...window.location, assign: original },
        writable: true,
      });
    }
  });

  it("STAGE2 (世界观) book click navigates to the wizard deep-link", async () => {
    // A book that's mid-wizard (concept done, world step in progress) should
    // re-enter the init wizard — not the standalone /stage1 concept page.
    const assignSpy = vi.fn();
    const original = window.location.assign;
    Object.defineProperty(window, "location", {
      value: { ...window.location, assign: assignSpy },
      writable: true,
    });
    try {
      renderShelf();
      await screen.findByText("诡眼少年"); // proj_a has current_stage "STAGE2"
      const card = screen.getByText("诡眼少年").closest('[data-testid="book-card"]')!;
      await act(async () => {
        card.click();
      });
      expect(assignSpy).toHaveBeenCalledWith("/project/proj_a/wizard");
    } finally {
      Object.defineProperty(window, "location", {
        value: { ...window.location, assign: original },
        writable: true,
      });
    }
  });

  it("STAGE4 (工作台) book click navigates to stage1 — wizard already finished", async () => {
    const assignSpy = vi.fn();
    const original = window.location.assign;
    Object.defineProperty(window, "location", {
      value: { ...window.location, assign: assignSpy },
      writable: true,
    });
    try {
      renderShelf();
      await screen.findByText("数据星河"); // proj_d has current_stage "STAGE4"
      const card = screen.getByText("数据星河").closest('[data-testid="book-card"]')!;
      await act(async () => {
        card.click();
      });
      expect(assignSpy).toHaveBeenCalledWith("/project/proj_d/workspace");
    } finally {
      Object.defineProperty(window, "location", {
        value: { ...window.location, assign: original },
        writable: true,
      });
    }
  });
});

// --- Integration: HomePage owns the fetch and passes projects down to BookShelf ---

import HomePage from "../pages/HomePage";
import { WizardProvider } from "../components/wizard/WizardContext";

describe("HomePage → BookShelf wiring", () => {
  beforeEach(() => {
    (api.listProjects as ReturnType<typeof vi.fn>).mockReset();
  });

  it("HomePage renders projects sorted by updated_at (top card newest)", async () => {
    // The project with the higher updated_at ("新") should appear before the
    // one with the higher created_at ("旧") — proving the BookShelf sort uses
    // updated_at, not created_at.
    (api.listProjects as ReturnType<typeof vi.fn>).mockResolvedValue([
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

    render(
      <MemoryRouter initialEntries={["/"]}>
        <WizardProvider projectId="new">
          <HomePage />
        </WizardProvider>
      </MemoryRouter>,
    );

    expect(await screen.findByText("新")).toBeInTheDocument();
    const cards = screen.getAllByTestId("book-card");
    expect(cards[0]).toHaveTextContent("新");
    expect(cards[1]).toHaveTextContent("旧");
  });

  it("HomePage fetches /api/project/list exactly once on mount (v1.8.2 dedup)", async () => {
    // v1.8.2 contract: HomePage is the sole fetcher. BookShelf receiving the
    // list as a prop means there should be exactly one listProjects call per
    // mount, not two.
    (api.listProjects as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    render(
      <MemoryRouter initialEntries={["/"]}>
        <WizardProvider projectId="proj_new">
          <HomePage />
        </WizardProvider>
      </MemoryRouter>,
    );

    // Wait for the shelf to render (loading completes).
    expect(await screen.findByTestId("book-shelf")).toBeInTheDocument();

    expect(api.listProjects).toHaveBeenCalledTimes(1);
  });
});