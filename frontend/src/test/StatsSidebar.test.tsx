import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import StatsSidebar from "../components/home/StatsSidebar";

const SAMPLE_STATS = {
  total_books: 12,
  total_chapters: 87,
  total_words: 214000,
  stage_distribution: {
    INIT: 1, STAGE1: 2, STAGE2: 0, STAGE3: 0,
    STAGE4: 5, STAGE5: 0, STAGE6: 0, COMPLETED: 4,
  },
};

beforeEach(() => {
  localStorage.removeItem("storyforge.home.sidebar.collapsed");
});

describe("StatsSidebar", () => {
  it("renders the Nebula Forge brand and stats sections when expanded", () => {
    render(
      <StatsSidebar
        stats={SAMPLE_STATS}
        statsLoading={false}
        onRefresh={() => {}}
        refreshing={false}
      />
    );
    expect(screen.getByText("Nebula Forge")).toBeInTheDocument();
    expect(screen.getByText("统计")).toBeInTheDocument();
    expect(screen.getByText("阶段分布")).toBeInTheDocument();
    expect(screen.getByText("快捷操作")).toBeInTheDocument();
    expect(screen.getByText("总书籍")).toBeInTheDocument();
    expect(screen.getByText("总章节")).toBeInTheDocument();
    expect(screen.getByText("总字数")).toBeInTheDocument();
  });

  it("renders only the collapsed icon column when localStorage says collapsed", () => {
    localStorage.setItem("storyforge.home.sidebar.collapsed", "true");
    render(
      <StatsSidebar
        stats={SAMPLE_STATS}
        statsLoading={false}
        onRefresh={vi.fn()}
        refreshing={false}
      />
    );
    expect(screen.queryByText("统计")).not.toBeInTheDocument();
    expect(screen.queryByText("快捷操作")).not.toBeInTheDocument();
    // Brand text hidden but BrandHeader icon still present
    expect(screen.getByText("auto_stories")).toBeInTheDocument();
  });

  it("forwards refresh / plaza / console / more callbacks to QuickActions", () => {
    const onRefresh = vi.fn();
    const onOpenPlaza = vi.fn();
    const onOpenConsole = vi.fn();
    const onOpenMore = vi.fn();
    render(
      <StatsSidebar
        stats={SAMPLE_STATS}
        statsLoading={false}
        onRefresh={onRefresh}
        refreshing={false}
        onOpenPlaza={onOpenPlaza}
        onOpenConsole={onOpenConsole}
        onOpenMore={onOpenMore}
      />
    );
    screen.getByTestId("qa-refresh").click();
    expect(onRefresh).toHaveBeenCalledTimes(1);
    screen.getByTestId("qa-prompt-square").click();
    expect(onOpenPlaza).toHaveBeenCalledTimes(1);
    screen.getByTestId("qa-ai-console").click();
    expect(onOpenConsole).toHaveBeenCalledTimes(1);
    screen.getByTestId("qa-more").click();
    expect(onOpenMore).toHaveBeenCalledTimes(1);
  });

  it("shows 加载中… when statsLoading is true", () => {
    render(
      <StatsSidebar
        stats={null}
        statsLoading
        onRefresh={() => {}}
        refreshing={false}
      />
    );
    expect(screen.getByText("加载中…")).toBeInTheDocument();
  });
});