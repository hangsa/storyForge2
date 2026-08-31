import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it, beforeEach, vi } from "vitest";
import S0BMutationStep from "@/components/wizard/divergence/S0BMutationStep";
import api from "@/api/client";

vi.mock("@/api/client", () => ({
  default: {
    postDivergeMutate: vi.fn(),
    postDivergeMutateRegenerate: vi.fn(),
  },
}));

const sampleVariant = {
  id: "v1",
  title: "变体1",
  premise_one_line: "一个短的前提",
  mutation_type: "inversion",
  mutation_logic: "反转原命题",
  estimated_novelty: 0.7,
  trope_tags: [],
  regenerated_count: 0,
};

const sampleVariant2 = {
  id: "v2",
  title: "变体2",
  premise_one_line: "另一个前提",
  mutation_type: "fusion",
  mutation_logic: "融合流派",
  estimated_novelty: 0.5,
  trope_tags: [],
  regenerated_count: 0,
};

describe("S0BMutationStep", () => {
  beforeEach(() => {
    (api.postDivergeMutate as unknown as ReturnType<typeof vi.fn>).mockReset();
    (api.postDivergeMutateRegenerate as unknown as ReturnType<typeof vi.fn>).mockReset();
    let callIdx = 0;
    (api.postDivergeMutate as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      () => {
        const idx = callIdx++;
        const ops = ["inversion", "fusion", "escalation", "constraint"];
        return Promise.resolve({
          new_node: {
            id: `v${idx + 1}`,
            title: `变体${idx + 1}`,
          },
          mutation_result: {
            operation: ops[idx] ?? "unknown",
            core_premise: `前提 ${idx + 1}`,
            novelty_hook: `逻辑 ${idx + 1}`,
          },
          dimmed_count: 0,
        });
      },
    );
    (api.postDivergeMutateRegenerate as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      variant: { ...sampleVariant, regenerated_count: 1, title: "新变体" },
    });
  });

  it("renders variant cards after mutate calls", async () => {
    render(
      <S0BMutationStep
        projectId="p1"
        rawIntent={{ prompt: "测试", genre_primary: "修仙" }}
        onComplete={() => {}}
        onBack={() => {}}
      />,
    );
    await waitFor(() => {
      expect(screen.getAllByTestId(/^variant-card-/)).toHaveLength(4);
    });
  });

  it("limits selection to 3 variants", async () => {
    const onComplete = vi.fn();
    render(
      <S0BMutationStep
        projectId="p1"
        rawIntent={{ prompt: "测试", genre_primary: "修仙" }}
        onComplete={onComplete}
        onBack={() => {}}
      />,
    );
    await waitFor(() => screen.getAllByTestId(/^variant-card-/));
    const cards = screen.getAllByTestId(/^variant-card-/);
    fireEvent.click(cards[0]);
    fireEvent.click(cards[1]);
    fireEvent.click(screen.getByTestId("s0b-submit"));
    await waitFor(() => {
      expect(onComplete).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ id: "v1" }),
          expect.objectContaining({ id: "v2" }),
        ]),
      );
    });
  });

  it("regenerate button calls regenerate endpoint", async () => {
    render(
      <S0BMutationStep
        projectId="p1"
        rawIntent={{ prompt: "测试", genre_primary: "修仙" }}
        onComplete={() => {}}
        onBack={() => {}}
      />,
    );
    await waitFor(() => screen.getAllByTestId(/^variant-card-/));
    fireEvent.click(screen.getByTestId("regen-v1"));
    await waitFor(() => {
      expect(api.postDivergeMutateRegenerate).toHaveBeenCalledWith("p1", "v1");
    });
  });

  it("fires onBack when back button clicked", async () => {
    const onBack = vi.fn();
    render(
      <S0BMutationStep
        projectId="p1"
        rawIntent={{ prompt: "测试", genre_primary: "修仙" }}
        onComplete={() => {}}
        onBack={onBack}
      />,
    );
    await waitFor(() => screen.getAllByTestId(/^variant-card-/));
    fireEvent.click(screen.getByTestId("s0b-back"));
    expect(onBack).toHaveBeenCalled();
  });
});