import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act, fireEvent } from "@testing-library/react";

vi.mock("../api/client", () => ({
  default: {
    listProjects: vi.fn(),
    bulkDeleteProjects: vi.fn(),
  },
}));

import api from "../api/client";
import BookShelf from "../components/home/BookShelf";

const SAMPLE = [
  { id: "proj_a", title: "诡眼少年", genre: "cool_novel", current_stage: "STAGE2", created_at: "2026-06-29T00:00:00", min_words: 4000 },
  { id: "proj_b", title: "测试小说", genre: "cool_novel", current_stage: "INIT", created_at: "2026-06-28T00:00:00", min_words: 4000 },
  { id: "proj_c", title: "一部城隍成长史", genre: "xianxia", current_stage: "STAGE4", created_at: "2026-06-27T00:00:00", min_words: 6000 },
  { id: "proj_d", title: "数据星河", genre: "kehuan", current_stage: "STAGE4", created_at: "2026-06-26T00:00:00", min_words: 8000 },
  { id: "proj_e", title: "山野笔记", genre: "dushi", current_stage: "STAGE1", created_at: "2026-06-25T00:00:00", min_words: 5000 },
  { id: "proj_f", title: "雪落无声", genre: "xianxia", current_stage: "STAGE4", created_at: "2026-06-24T00:00:00", min_words: 5000 },
];

interface ProjectMtime {
  id: string;
  mtime: number;
}

beforeEach(() => {
  (api.listProjects as ReturnType<typeof vi.fn>).mockReset();
  (api.listProjects as ReturnType<typeof vi.fn>).mockResolvedValue(SAMPLE);
  (api.bulkDeleteProjects as ReturnType<typeof vi.fn>).mockReset();
});

function renderShelf(props: {
  mtimes?: ProjectMtime[];
} = {}) {
  // Default mtimes: assign HIGHEST mtime to proj_a (the project the test expects to see
  // in the top 5), descending toward proj_f. This mimics a scenario where proj_a was
  // updated most recently and proj_f least recently.
  const mtimes = props.mtimes ?? SAMPLE.map((p, i) => ({ id: p.id, mtime: 1000 + (SAMPLE.length - i) }));
  return render(<BookShelf mtimes={mtimes} />);
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

  it("sorts by mtime desc (most recently updated first)", async () => {
    // Give proj_f (雪落无声) the highest mtime; everything else gets a lower one.
    const mtimes = SAMPLE.map((p, i) => ({ id: p.id, mtime: p.id === "proj_f" ? 9999 : 1000 + i }));
    renderShelf({ mtimes });
    await screen.findByText("雪落无声");
    const cards = document.querySelectorAll('[data-testid="book-card"]');
    // proj_f is the newest → should be the first visible card.
    expect(cards[0].textContent).toContain("雪落无声");
    // proj_a is the oldest (mtime 1000) → should be excluded from the top 5.
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
    (api.listProjects as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    renderShelf();
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

  it("batch-delete popconfirm calls bulkDeleteProjects on confirm", async () => {
    (api.bulkDeleteProjects as ReturnType<typeof vi.fn>).mockResolvedValue({
      deleted: ["proj_a", "proj_b"], failed: [], deleted_count: 2, failed_count: 0,
    });
    renderShelf();
    await screen.findByText("诡眼少年");
    await act(async () => {
      screen.getByRole("button", { name: /多选/ }).click();
    });
    // Select first two cards.
    const selectButtons = await screen.findAllByRole("button", { name: "选择" });
    await act(async () => {
      selectButtons[0].click();
      selectButtons[1].click();
    });
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
  });
});