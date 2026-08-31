import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it, beforeEach, vi } from "vitest";
import S0CContradictionStep from "@/components/wizard/divergence/S0CContradictionStep";
import api from "@/api/client";
import type { IdeaVariant } from "@/api/client";

vi.mock("@/api/client", () => ({
  default: {
    postDivergeContradict: vi.fn(),
    putDivergeContradict: vi.fn(),
  },
}));

const sampleVariants: IdeaVariant[] = [
  {
    id: "v1",
    title: "变体1",
    premise_one_line: "一个前提",
    mutation_type: "inversion",
    mutation_logic: "反转",
    estimated_novelty: 0.5,
    trope_tags: [],
    regenerated_count: 0,
  },
];

const candidates = [
  {
    template_type: "能力×限制",
    preview_statement: "主角有超强能力,但被封印",
    side_a: "能力",
    side_b: "限制",
    tension_score: 80,
  },
  {
    template_type: "目标×代价",
    preview_statement: "救赎需要付出代价",
    side_a: "目标",
    side_b: "代价",
    tension_score: 65,
  },
];

describe("S0CContradictionStep", () => {
  beforeEach(() => {
    (api.postDivergeContradict as unknown as ReturnType<typeof vi.fn>).mockReset();
    (api.putDivergeContradict as unknown as ReturnType<typeof vi.fn>).mockReset();
    (api.postDivergeContradict as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      { candidates },
    );
    (api.putDivergeContradict as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      core_contradiction: {
        template_type: "能力×限制",
        statement: "主角有超强能力,但被封印",
        side_a: "能力",
        side_b: "限制",
        tension_score: 80,
        is_custom: false,
        confirmed_at: "2026-08-31T00:00:00Z",
      },
    });
  });

  it("shows candidate cards after fetch", async () => {
    render(
      <S0CContradictionStep
        projectId="p1"
        variants={sampleVariants}
        onComplete={() => {}}
        onBack={() => {}}
      />,
    );
    await waitFor(() => {
      expect(screen.getAllByTestId(/^candidate-/)).toHaveLength(3); // 2 candidates + custom
    });
  });

  it("highlights tension score with color bands (green >= 80)", async () => {
    render(
      <S0CContradictionStep
        projectId="p1"
        variants={sampleVariants}
        onComplete={() => {}}
        onBack={() => {}}
      />,
    );
    await waitFor(() => screen.getAllByTestId(/^candidate-/));
    const card = screen.getByTestId("candidate-能力×限制");
    const tensionBadge = card.querySelector(".text-success, .text-warning, .text-error");
    expect(tensionBadge).not.toBeNull();
    expect(tensionBadge!.className).toMatch(/text-success/);
  });

  it("calls onComplete with selected contradiction", async () => {
    const onComplete = vi.fn();
    render(
      <S0CContradictionStep
        projectId="p1"
        variants={sampleVariants}
        onComplete={onComplete}
        onBack={() => {}}
      />,
    );
    await waitFor(() => screen.getAllByTestId(/^candidate-/));
    fireEvent.click(screen.getByTestId("candidate-能力×限制"));
    fireEvent.click(screen.getByTestId("s0c-submit"));
    await waitFor(() => {
      expect(api.putDivergeContradict).toHaveBeenCalledWith(
        "p1",
        expect.objectContaining({
          template_type: "能力×限制",
          statement: "主角有超强能力,但被封印",
          side_a: "能力",
          side_b: "限制",
          tension_score: 80,
          is_custom: false,
        }),
      );
      expect(onComplete).toHaveBeenCalledWith(
        expect.objectContaining({
          template_type: "能力×限制",
          tension_score: 80,
        }),
      );
    });
  });

  it("uses first variant for contradict call", async () => {
    render(
      <S0CContradictionStep
        projectId="p1"
        variants={sampleVariants}
        onComplete={() => {}}
        onBack={() => {}}
      />,
    );
    await waitFor(() => screen.getAllByTestId(/^candidate-/));
    expect(api.postDivergeContradict).toHaveBeenCalledWith("p1", {
      variant_id: "v1",
      variant_content: "一个前提",
    });
  });

  it("supports custom contradiction entry", async () => {
    const onComplete = vi.fn();
    render(
      <S0CContradictionStep
        projectId="p1"
        variants={sampleVariants}
        onComplete={onComplete}
        onBack={() => {}}
      />,
    );
    await waitFor(() => screen.getAllByTestId(/^candidate-/));
    fireEvent.click(screen.getByTestId("candidate-__custom__"));
    fireEvent.change(screen.getByTestId("custom-statement"), {
      target: { value: "我自己定义的核心矛盾" },
    });
    fireEvent.click(screen.getByTestId("s0c-submit"));
    await waitFor(() => {
      expect(api.putDivergeContradict).toHaveBeenCalledWith(
        "p1",
        expect.objectContaining({
          template_type: "CUSTOM",
          statement: "我自己定义的核心矛盾",
          is_custom: true,
        }),
      );
      expect(onComplete).toHaveBeenCalled();
    });
  });

  it("rejects custom submit when statement empty", async () => {
    (api.putDivergeContradict as unknown as ReturnType<typeof vi.fn>).mockClear();
    render(
      <S0CContradictionStep
        projectId="p1"
        variants={sampleVariants}
        onComplete={() => {}}
        onBack={() => {}}
      />,
    );
    await waitFor(() => screen.getAllByTestId(/^candidate-/));
    fireEvent.click(screen.getByTestId("candidate-__custom__"));
    fireEvent.click(screen.getByTestId("s0c-submit"));
    await waitFor(() => {
      expect(screen.getByText("自定义矛盾不能为空")).toBeInTheDocument();
      expect(api.putDivergeContradict).not.toHaveBeenCalled();
    });
  });

  it("fires onBack when back button clicked", async () => {
    const onBack = vi.fn();
    render(
      <S0CContradictionStep
        projectId="p1"
        variants={sampleVariants}
        onComplete={() => {}}
        onBack={onBack}
      />,
    );
    await waitFor(() => screen.getAllByTestId(/^candidate-/));
    fireEvent.click(screen.getByTestId("s0c-back"));
    expect(onBack).toHaveBeenCalled();
  });
});