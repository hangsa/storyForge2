import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { IdeaRootNode } from "@/components/creative-canvas/IdeaRootNode";

describe("IdeaRootNode", () => {
  it("renders the full prompt text without truncation", () => {
    // PRD §11.2: the user-supplied Idea is the only core input and
    // must remain visible after init. Previously IdeaRootNode used
    // `prompt.slice(0, 8) + "…"` which truncated "修仙对抗外星" to
    // "修仙对抗外…" — the user could not see what they had just
    // input, blocking their mental model of the canvas.
    const longPrompt = "修仙对抗外星文明：星际时代的门派冲突与时间悖论";
    render(<IdeaRootNode prompt={longPrompt} />);
    // Look for the prompt text via a partial match — full containment
    // works as long as the rendered DOM contains the original string
    // somewhere (e.g., wrapped across lines).
    expect(screen.getByTestId("idea-root-node")).toHaveTextContent(longPrompt);
  });

  it("renders the genre label when provided", () => {
    // PRD §11.2: empty state surfaces both prompt and 类型. The root
    // node should also surface it so users can see "this is my 仙侠
    // idea" at a glance rather than only on the empty form.
    render(<IdeaRootNode prompt="test prompt" genre="xianxia" />);
    expect(screen.getByTestId("idea-root-genre")).toHaveTextContent(/xianxia|仙侠/);
  });

  it("omits the genre label when no genre is provided", () => {
    // Defensive: legacy canvas_state.json files might have genre="".
    // Don't render an empty badge in that case.
    render(<IdeaRootNode prompt="test prompt" />);
    expect(screen.queryByTestId("idea-root-genre")).toBeNull();
  });

  it("shows a placeholder when the prompt is empty", () => {
    // Defensive: a canvas_state.json produced mid-init (between root_idea
    // write and raw_intent write, or for a freshly-imported project) may
    // have prompt="" — don't render nothing, render an explicit
    // placeholder so the column still has visual weight.
    render(<IdeaRootNode prompt="" />);
    expect(screen.getByTestId("idea-root-node")).toBeInTheDocument();
    expect(screen.getByTestId("idea-root-node")).toHaveTextContent(/原始想法|暂无/);
  });
});

describe("IdeaRootNode onContinue", () => {
  it("does not render 继续 button when onContinue is undefined", () => {
    render(<IdeaRootNode prompt="修仙对抗外星" genre="xianxia" />);
    expect(screen.queryByTestId("idea-root-continue")).toBeNull();
  });

  it("renders 继续 button when onContinue is provided", () => {
    render(
      <IdeaRootNode
        prompt="修仙对抗外星"
        genre="xianxia"
        onContinue={() => {}}
      />,
    );
    const btn = screen.getByTestId("idea-root-continue");
    expect(btn).toBeInTheDocument();
    // Accessible label points to 继续 / 推进 / generate-next semantics.
    expect(btn).toHaveAttribute("aria-label", "继续生成下一步");
  });

  it("invokes onContinue callback when the button is clicked", () => {
    const onContinue = vi.fn();
    render(
      <IdeaRootNode
        prompt="修仙对抗外星"
        genre="xianxia"
        onContinue={onContinue}
      />,
    );
    fireEvent.click(screen.getByTestId("idea-root-continue"));
    expect(onContinue).toHaveBeenCalledTimes(1);
  });

  it("shows spinner + disables button when continueLoading=true", () => {
    render(
      <IdeaRootNode
        prompt="修仙对抗外星"
        genre="xianxia"
        onContinue={() => {}}
        continueLoading
      />,
    );
    expect(screen.getByTestId("idea-root-continue")).toBeDisabled();
    expect(screen.getByTestId("idea-root-continue-spinner")).toBeInTheDocument();
  });

  it("does not invoke onContinue when the button is disabled (loading)", () => {
    const onContinue = vi.fn();
    render(
      <IdeaRootNode
        prompt="修仙对抗外星"
        genre="xianxia"
        onContinue={onContinue}
        continueLoading
      />,
    );
    fireEvent.click(screen.getByTestId("idea-root-continue"));
    expect(onContinue).not.toHaveBeenCalled();
  });
});