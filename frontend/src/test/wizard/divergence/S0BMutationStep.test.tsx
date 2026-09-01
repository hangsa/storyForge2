import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it, beforeEach, vi } from "vitest";
import S0BMutationStep from "@/components/wizard/divergence/S0BMutationStep";
import api from "@/api/client";

vi.mock("@/api/client", () => ({
  default: {
    getDivergeState: vi.fn(),
    postDivergeWhatIfExpand: vi.fn(),
    postDivergeMutate: vi.fn(),
    postDivergeMutateRegenerate: vi.fn(),
    postDivergeRegenerateVariants: vi.fn(),
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
    (api.getDivergeState as unknown as ReturnType<typeof vi.fn>).mockReset();
    (api.postDivergeWhatIfExpand as unknown as ReturnType<typeof vi.fn>).mockReset();
    (api.postDivergeMutate as unknown as ReturnType<typeof vi.fn>).mockReset();
    (api.postDivergeMutateRegenerate as unknown as ReturnType<typeof vi.fn>).mockReset();

    // S0BMutationStep's effect (matches CreativeDivergenceStep.tsx:68-104):
    //   1) getDivergeState → root_node_id
    //   2) postDivergeWhatIfExpand(root) → child node IDs
    //   3) For each op in MUTATION_OPS, postDivergeMutate the latest new_node.id
    (api.getDivergeState as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      root_node_id: "root-1",
    });
    (api.postDivergeWhatIfExpand as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      nodes: { "c0": { id: "c0", parent_id: "root-1" } },
    });

    let callIdx = 0;
    (api.postDivergeMutate as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      () => {
        const idx = callIdx++;
        const ops = ["inversion", "escalation", "subversion"];
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
    (api.postDivergeRegenerateVariants as unknown as ReturnType<typeof vi.fn>).mockReset();
    (api.postDivergeRegenerateVariants as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      variants: [
        { ...sampleVariant, id: "v-new-1", title: "重新变体1" },
        { ...sampleVariant, id: "v-new-2", title: "重新变体2" },
        { ...sampleVariant, id: "v-new-3", title: "重新变体3" },
      ],
      user_modifications_received: true,
    });
  });

  // Back-nav regression: after generating the core contradiction (Stage C),
  // the user clicks "变体" in StepIndicator to revisit the variants they
  // originally picked. The selection must be visually obvious — a
  // border-primary vs border-outline-variant swap alone is too subtle
  // (the user reported they couldn't tell which cards were picked).
  it("renders explicit 已选 badge on cards that were previously selected (back-nav from Stage C)", async () => {
    render(
      <S0BMutationStep
        projectId="p1"
        rawIntent={{ prompt: "测试", genre_primary: "修仙" }}
        initial={[
          { ...sampleVariant, id: "v1", title: "变体1" },
          { ...sampleVariant, id: "v2", title: "变体2" },
          { ...sampleVariant2, id: "v3", title: "变体3" },
        ]}
        selectedIds={["v1", "v2"]}
        onComplete={() => {}}
        onBack={() => {}}
      />,
    );

    // The two originally-selected variants must show the badge.
    await waitFor(() => {
      expect(screen.getByTestId("selected-badge-v1")).toBeInTheDocument();
      expect(screen.getByTestId("selected-badge-v2")).toBeInTheDocument();
      expect(screen.queryByTestId("selected-badge-v3")).not.toBeInTheDocument();
    });
    // And the counter must agree.
    expect(screen.getByText(/已选 2 \/ 3/)).toBeInTheDocument();
  });

  // Filter orphan IDs out of the selected Set on mount. Otherwise, when
  // /regenerate/variants has minted fresh IDs between sessions, the
  // inherited selectedIds could contain IDs that no longer match any
  // visible card. The counter would then lie (showing "2/3" with no
  // highlighted cards), which on back-nav reads as "I forgot what I
  // picked".
  it("filters orphaned selectedIds that don't match any current variant", async () => {
    render(
      <S0BMutationStep
        projectId="p1"
        rawIntent={{ prompt: "测试", genre_primary: "修仙" }}
        initial={[
          { ...sampleVariant, id: "v-new-1", title: "新1" },
          { ...sampleVariant, id: "v-new-2", title: "新2" },
          { ...sampleVariant, id: "v-new-3", title: "新3" },
        ]}
        // v1, v2 are orphaned — they're in selectedIds but not in current
        // variants (e.g. came from a pre-regenerate canvas).
        selectedIds={["v1", "v2"]}
        onComplete={() => {}}
        onBack={() => {}}
      />,
    );
    await waitFor(() => screen.getAllByTestId(/^variant-card-/));
    // No card highlights → counter shows 0/3 (NOT 2/3).
    expect(screen.getByText(/已选 0 \/ 3/)).toBeInTheDocument();
    expect(screen.queryByTestId("selected-badge-v-new-1")).not.toBeInTheDocument();
  });

  // Toggle-off via the badge: clicking a selected card must remove the
  // badge so the user can edit their selection on back-nav.
  it("toggles the badge off when user clicks an already-selected card on back-nav", async () => {
    render(
      <S0BMutationStep
        projectId="p1"
        rawIntent={{ prompt: "测试", genre_primary: "修仙" }}
        initial={[
          { ...sampleVariant, id: "v1", title: "变体1" },
          { ...sampleVariant, id: "v2", title: "变体2" },
        ]}
        selectedIds={["v1"]}
        onComplete={() => {}}
        onBack={() => {}}
      />,
    );
    await waitFor(() => screen.getByTestId("selected-badge-v1"));
    // Click v1 — should remove from selection.
    fireEvent.click(screen.getByTestId("variant-card-v1"));
    expect(screen.queryByTestId("selected-badge-v1")).not.toBeInTheDocument();
    expect(screen.getByText(/已选 0 \/ 3/)).toBeInTheDocument();
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
      expect(screen.getAllByTestId(/^variant-card-/)).toHaveLength(3);
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
        ["v1", "v2"],
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

  it("regen button calls regen API + updates variants + clears selection", async () => {
    const onCanvasMutated = vi.fn();
    render(
      <S0BMutationStep
        projectId="p1"
        rawIntent={{ prompt: "测试", genre_primary: "修仙" }}
        onComplete={() => {}}
        onBack={() => {}}
        onCanvasMutated={onCanvasMutated}
      />,
    );
    await waitFor(() => screen.getAllByTestId(/^variant-card-/));
    // Pre-select one variant so we can assert selection clears after regen.
    fireEvent.click(screen.getByTestId("variant-card-v1"));

    fireEvent.click(screen.getByTestId("s0b-regenerate"));
    await waitFor(() => {
      expect(screen.getByTestId("regenerate-modal")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId("regenerate-modal-confirm"));

    await waitFor(() => {
      expect(api.postDivergeRegenerateVariants).toHaveBeenCalledWith(
        "p1",
        { user_modifications: "" },
      );
      expect(onCanvasMutated).toHaveBeenCalled();
    });
    // After regen, the new variants replace the old ones.
    await waitFor(() => {
      expect(screen.getByTestId("variant-card-v-new-1")).toBeInTheDocument();
    });
    // Selection counter resets because old IDs no longer exist.
    expect(screen.getByText(/已选 0 \/ 3/)).toBeInTheDocument();
  });

  // Visibility regression: the regenerate button used to render as a tiny
  // 28×28 gray icon-only button that the user kept reporting as missing.
  // It must now show a visible "重新生成" text label so the affordance
  // reads at a glance (icon-only Material Symbols glyphs are easy to miss
  // on a busy wizard page).
  it("renders the regenerate button with a visible 重新生成 text label", async () => {
    render(
      <S0BMutationStep
        projectId="p1"
        rawIntent={{ prompt: "测试", genre_primary: "修仙" }}
        initial={[
          { ...sampleVariant, id: "v1", title: "变体1" },
          { ...sampleVariant, id: "v2", title: "变体2" },
          { ...sampleVariant2, id: "v3", title: "变体3" },
        ]}
        selectedIds={["v1"]}
        onComplete={() => {}}
        onBack={() => {}}
      />,
    );
    const btn = screen.getByTestId("s0b-regenerate");
    // Text label must be in the DOM as visible content (not just an
    // aria-label or title attribute — those aren't surfaced to sighted
    // users without hover/keyboard focus).
    expect(btn).toHaveTextContent(/重新生成/);
  });
});