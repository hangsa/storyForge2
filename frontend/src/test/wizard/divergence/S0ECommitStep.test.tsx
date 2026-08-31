import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it, beforeEach, vi } from "vitest";
import S0ECommitStep from "@/components/wizard/divergence/S0ECommitStep";
import api from "@/api/client";
import type { CommitResponse, NoveltyScores } from "@/api/client";

vi.mock("@/api/client", () => ({
  default: {
    getDivergeNovelty: vi.fn(),
    postDivergeCommit: vi.fn(),
  },
}));

const novelty: NoveltyScores = {
  market_saturation: 70,
  trope_similarity: 60,
  contradiction_depth: 80,
  discussion_potential: 50,
  composite: 65,
  grade: "中等",
  computed_at: "2026-08-31T00:00:00Z",
  trope_extraction_status: "completed",
};

const commitResp: CommitResponse = {
  concept_preview: { title: "Test Concept" },
  story_dna_preview: { value_stack: [] },
  novelty_summary: novelty,
  next_step_url: "/project/p1/wizard?step=2",
  warnings: [],
  source: "canvas",
  committed_at: "2026-08-31T00:00:00Z",
};

describe("S0ECommitStep", () => {
  beforeEach(() => {
    (api.getDivergeNovelty as unknown as ReturnType<typeof vi.fn>).mockReset();
    (api.postDivergeCommit as unknown as ReturnType<typeof vi.fn>).mockReset();
    (api.getDivergeNovelty as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      novelty,
    );
    (api.postDivergeCommit as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      commitResp,
    );
  });

  it("renders the 4 novelty dimensions after fetch", async () => {
    render(
      <S0ECommitStep
        projectId="p1"
        selectedPath={["root", "c1"]}
        onComplete={() => {}}
        onBack={() => {}}
      />,
    );
    await waitFor(() => {
      expect(screen.getByText(/市场饱和度/)).toBeInTheDocument();
      expect(screen.getByText(/套路相似度/)).toBeInTheDocument();
      expect(screen.getByText(/矛盾深度/)).toBeInTheDocument();
      expect(screen.getByText(/讨论潜力/)).toBeInTheDocument();
    });
  });

  it("shows warning banner when composite < 40 but does not disable submit", async () => {
    (api.getDivergeNovelty as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ...novelty,
      composite: 35,
    });
    render(
      <S0ECommitStep
        projectId="p1"
        selectedPath={["root", "c1"]}
        onComplete={() => {}}
        onBack={() => {}}
      />,
    );
    await waitFor(() => {
      expect(screen.getByTestId("warning-low-novelty")).toBeInTheDocument();
    });
    expect(screen.getByTestId("s0e-submit")).not.toBeDisabled();
  });

  it("calls onComplete with response on submit", async () => {
    const onComplete = vi.fn();
    render(
      <S0ECommitStep
        projectId="p1"
        selectedPath={["root", "c1"]}
        onComplete={onComplete}
        onBack={() => {}}
      />,
    );
    await waitFor(() => screen.getByTestId("s0e-submit"));
    fireEvent.click(screen.getByTestId("s0e-submit"));
    await waitFor(() => {
      expect(api.postDivergeCommit).toHaveBeenCalledWith(
        "p1",
        expect.objectContaining({ confirmed_path_ids: ["root", "c1"] }),
      );
      expect(onComplete).toHaveBeenCalledWith(
        expect.objectContaining({ next_step_url: expect.any(String) }),
      );
    });
  });

  it("allows hand-edit of value_stack before commit (4 layers)", async () => {
    render(
      <S0ECommitStep
        projectId="p1"
        selectedPath={["root", "c1"]}
        onComplete={() => {}}
        onBack={() => {}}
      />,
    );
    await waitFor(() => screen.getByTestId("s0e-submit"));
    fireEvent.click(screen.getByTestId("edit-value-stack"));
    const inputs = screen.getAllByTestId(/^vs-input-/);
    expect(inputs.length).toBeGreaterThanOrEqual(4);
    expect(screen.getByTestId("vs-input-personal")).toBeInTheDocument();
    expect(screen.getByTestId("vs-input-social")).toBeInTheDocument();
    expect(screen.getByTestId("vs-input-philosophical")).toBeInTheDocument();
    expect(screen.getByTestId("vs-input-existential")).toBeInTheDocument();
  });

  it("sends value_stack_override when edited", async () => {
    const onComplete = vi.fn();
    render(
      <S0ECommitStep
        projectId="p1"
        selectedPath={["root", "c1"]}
        onComplete={onComplete}
        onBack={() => {}}
      />,
    );
    await waitFor(() => screen.getByTestId("s0e-submit"));
    fireEvent.click(screen.getByTestId("edit-value-stack"));
    fireEvent.change(screen.getByTestId("vs-input-personal"), {
      target: { value: "自由, 束缚" },
    });
    fireEvent.change(screen.getByTestId("vs-input-social"), {
      target: { value: "归属, 孤独" },
    });
    fireEvent.change(screen.getByTestId("vs-input-philosophical"), {
      target: { value: "理性, 信仰" },
    });
    fireEvent.change(screen.getByTestId("vs-input-existential"), {
      target: { value: "存在, 虚无" },
    });
    fireEvent.click(screen.getByTestId("s0e-submit"));
    await waitFor(() => {
      expect(api.postDivergeCommit).toHaveBeenCalledWith(
        "p1",
        expect.objectContaining({
          value_stack_override: expect.arrayContaining([
            expect.objectContaining({
              level: "personal",
              value_a: "自由",
              value_b: "束缚",
            }),
          ]),
        }),
      );
    });
  });

  it("fires onBack when back button clicked", async () => {
    const onBack = vi.fn();
    render(
      <S0ECommitStep
        projectId="p1"
        selectedPath={["root", "c1"]}
        onComplete={() => {}}
        onBack={onBack}
      />,
    );
    await waitFor(() => screen.getByTestId("s0e-submit"));
    fireEvent.click(screen.getByTestId("s0e-back"));
    expect(onBack).toHaveBeenCalled();
  });
});