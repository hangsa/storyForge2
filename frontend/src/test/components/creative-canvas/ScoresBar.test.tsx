import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ScoresBar } from "@/components/creative-canvas/ScoresBar";

describe("ScoresBar", () => {
  it("renders all 4 PRD §16 quality dimensions with their labels", () => {
    // PRD §16.1 enumerates 4 metrics: 新颖度, 冲突强度, 故事潜力,
    // 独特性. The component must surface all 4 labels so users see the
    // full quality picture rather than only the 2 the backend currently
    // populates.
    render(
      <ScoresBar
        scores={{
          novelty: 0.8,
          conflict: 0.7,
          story_potential: 0.6,
          uniqueness: 0.9,
        }}
      />,
    );
    expect(screen.getByTestId("score-novelty")).toBeInTheDocument();
    expect(screen.getByTestId("score-conflict")).toBeInTheDocument();
    expect(screen.getByTestId("score-story_potential")).toBeInTheDocument();
    expect(screen.getByTestId("score-uniqueness")).toBeInTheDocument();
    expect(screen.getByTestId("score-novelty")).toHaveTextContent(/新颖度/);
    expect(screen.getByTestId("score-conflict")).toHaveTextContent(/冲突/);
    expect(screen.getByTestId("score-story_potential")).toHaveTextContent(/故事潜力/);
    expect(screen.getByTestId("score-uniqueness")).toHaveTextContent(/独特性/);
  });

  it("renders percentages normalized from 0-1 to 0-100", () => {
    render(
      <ScoresBar
        scores={{
          novelty: 0.87,
          conflict: 0.91,
          story_potential: 0.88,
          uniqueness: 0.84,
        }}
      />,
    );
    expect(screen.getByTestId("score-novelty")).toHaveTextContent("87");
    expect(screen.getByTestId("score-conflict")).toHaveTextContent("91");
    expect(screen.getByTestId("score-story_potential")).toHaveTextContent("88");
    expect(screen.getByTestId("score-uniqueness")).toHaveTextContent("84");
  });

  it("shows a placeholder for metrics the backend hasn't populated yet", () => {
    // PRD §16.3: story_potential + uniqueness are deferred to a future
    // task. Until then the backend returns 0.0 (see
    // _refresh_top_level_scores:725-728). Show an em-dash placeholder
    // instead of "0%" so users can tell which scores are real vs
    // pending rather than seeing a misleading 0.
    render(
      <ScoresBar
        scores={{
          novelty: 0.5,
          conflict: 0.5,
          story_potential: 0,
          uniqueness: 0,
        }}
      />,
    );
    expect(screen.getByTestId("score-novelty")).toHaveTextContent("50");
    expect(screen.getByTestId("score-conflict")).toHaveTextContent("50");
    expect(screen.getByTestId("score-story_potential")).toHaveTextContent("—");
    expect(screen.getByTestId("score-uniqueness")).toHaveTextContent("—");
  });

  it("clamps over-range (>1) scores to 100 and leaves sub-zero values for pending handling", () => {
    // Defensive: backend could in theory send >1 values during
    // migration or partial compute. Clamp to 100 so the bar widths
    // don't render as >100%. Negative values share the `<=0` branch
    // with pending metrics (we can't distinguish "real 0" from
    // "backend hasn't populated yet") — those render as "—" instead
    // of being clamped.
    render(
      <ScoresBar
        scores={{
          novelty: 1.5,
          conflict: 2.0,
          story_potential: 0,
          uniqueness: 0,
        }}
      />,
    );
    expect(screen.getByTestId("score-novelty")).toHaveTextContent("100");
    expect(screen.getByTestId("score-conflict")).toHaveTextContent("100");
    expect(screen.getByTestId("score-story_potential")).toHaveTextContent("—");
    expect(screen.getByTestId("score-uniqueness")).toHaveTextContent("—");
  });
});