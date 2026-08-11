import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, act, fireEvent } from "@testing-library/react";
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
  it("renders expanded by default with brand, stats, distribution, actions", () => {
    render(
      <StatsSidebar
        stats={SAMPLE_STATS}
        statsLoading={false}
        onRefresh={() => {}}
        refreshing={false}
      />
    );
    expect(screen.getByText("StoryForge")).toBeInTheDocument();
    expect(screen.getAllByTestId("stat-card").length).toBeGreaterThanOrEqual(3);
    expect(screen.getByTestId("stage-distribution")).toBeInTheDocument();
    expect(screen.getByTestId("quick-actions")).toBeInTheDocument();
  });

  it("shows placeholder values when stats is null", () => {
    render(
      <StatsSidebar
        stats={null}
        statsLoading={false}
        onRefresh={() => {}}
        refreshing={false}
      />
    );
    const cards = screen.getAllByTestId("stat-card");
    expect(cards.length).toBeGreaterThanOrEqual(3);
    cards.forEach((c) => {
      expect(c.textContent).toContain("—");
    });
  });

  it("collapses to icon-only mode when toggle is clicked", () => {
    render(
      <StatsSidebar
        stats={SAMPLE_STATS}
        statsLoading={false}
        onRefresh={() => {}}
        refreshing={false}
      />
    );
    const toggle = screen.getByRole("button", { name: /collapse|收起|折叠/ });
    expect(toggle).toBeInTheDocument();
    act(() => {
      toggle.click();
    });
    // After collapse, the brand text is hidden.
    expect(screen.queryByText("StoryForge")).not.toBeInTheDocument();
    // Quick actions remain (they are still useful when collapsed).
    expect(screen.getByTestId("quick-actions")).toBeInTheDocument();
  });

  it("persists collapsed state to localStorage", () => {
    render(
      <StatsSidebar
        stats={SAMPLE_STATS}
        statsLoading={false}
        onRefresh={() => {}}
        refreshing={false}
      />
    );
    const toggle = screen.getByRole("button", { name: /collapse|收起|折叠/ });
    act(() => {
      toggle.click();
    });
    expect(localStorage.getItem("storyforge.home.sidebar.collapsed")).toBe("true");
  });

  it("hydrates from localStorage on mount", () => {
    localStorage.setItem("storyforge.home.sidebar.collapsed", "true");
    render(
      <StatsSidebar
        stats={SAMPLE_STATS}
        statsLoading={false}
        onRefresh={() => {}}
        refreshing={false}
      />
    );
    expect(screen.queryByText("StoryForge")).not.toBeInTheDocument();
  });

  it("invokes onRefresh when the refresh action is clicked", () => {
    let called = 0;
    render(
      <StatsSidebar
        stats={SAMPLE_STATS}
        statsLoading={false}
        onRefresh={() => { called += 1; }}
        refreshing={false}
      />
    );
    act(() => {
      screen.getByTestId("qa-refresh").click();
    });
    expect(called).toBe(1);
  });

  it("renders the three numeric tiles with total_books, total_chapters, total_words", () => {
    render(
      <StatsSidebar
        stats={SAMPLE_STATS}
        statsLoading={false}
        onRefresh={() => {}}
        refreshing={false}
      />
    );
    expect(screen.getByText("12")).toBeInTheDocument();
    expect(screen.getByText("87")).toBeInTheDocument();
    expect(screen.getByText("214,000")).toBeInTheDocument();
  });

  it("更多 button is enabled and calls onOpenMore when clicked", () => {
    const onOpenMore = vi.fn();
    render(
      <StatsSidebar
        stats={SAMPLE_STATS}
        statsLoading={false}
        onRefresh={() => {}}
        refreshing={false}
        onOpenMore={onOpenMore}
      />
    );
    const moreBtn = screen.getByTestId("qa-more");
    expect(moreBtn).not.toBeDisabled();
    act(() => {
      moreBtn.click();
    });
    expect(onOpenMore).toHaveBeenCalledTimes(1);
  });
});
