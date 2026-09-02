import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it, beforeEach, vi } from "vitest";
import S0CContradictionStep from "@/components/wizard/divergence/S0CContradictionStep";
import api from "@/api/client";
import type { IdeaVariant } from "@/api/client";

vi.mock("@/api/client", () => ({
  default: {
    postDivergeContradict: vi.fn(),
    putDivergeContradict: vi.fn(),
    postDivergeRegenerateContradiction: vi.fn(),
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
    (api.postDivergeRegenerateContradiction as unknown as ReturnType<typeof vi.fn>).mockReset();
    (api.postDivergeRegenerateContradiction as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      user_modifications_received: true,
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
    expect(api.postDivergeContradict).toHaveBeenCalledWith(
      "p1",
      { variant_id: "v1", variant_content: "一个前提" },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
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

  it("re-fetches candidates when navigated back with a previous empty contradiction", async () => {
    // Regression test for proj_f0721bdc 2026-08-31: when the user committed
    // an empty core_contradiction (LLM was down at the time), then navigated
    // back from S0D/S0E to re-pick, the candidate list stayed empty because
    // the useEffect bailed on `if (initial) return`. Now we always re-fetch
    // so the user can pick a fresh contradiction.
    render(
      <S0CContradictionStep
        projectId="p1"
        variants={sampleVariants}
        initial={{
          template_type: "目标×代价",
          statement: "",
          side_a: "",
          side_b: "",
          tension_score: 0,
          is_custom: false,
          confirmed_at: "2026-08-31T00:00:00Z",
        }}
        onComplete={() => {}}
        onBack={() => {}}
      />,
    );
    // postDivergeContradict MUST be called even though `initial` is set.
    await waitFor(() => {
      expect(api.postDivergeContradict).toHaveBeenCalledWith(
        "p1",
        { variant_id: "v1", variant_content: "一个前提" },
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
    });
    // And the candidate list must populate (so the warning banner clears).
    await waitFor(() => {
      expect(screen.getAllByTestId(/^candidate-/)).toHaveLength(3);
    });
  });

  it("regen button clears saved contradiction and re-fetches candidates", async () => {
    const onCanvasMutated = vi.fn();
    render(
      <S0CContradictionStep
        projectId="p1"
        variants={sampleVariants}
        onComplete={() => {}}
        onBack={() => {}}
        onCanvasMutated={onCanvasMutated}
      />,
    );
    // Wait for the initial candidate fetch so we know the baseline.
    await waitFor(() => screen.getAllByTestId(/^candidate-/));
    const callsBefore = (api.postDivergeContradict as unknown as ReturnType<typeof vi.fn>).mock.calls.length;

    fireEvent.click(screen.getByTestId("s0c-regenerate"));
    await waitFor(() => {
      expect(screen.getByTestId("regenerate-modal")).toBeInTheDocument();
    });
    fireEvent.change(screen.getByLabelText("修改意见"), {
      target: { value: "换个矛盾方向" },
    });
    fireEvent.click(screen.getByTestId("regenerate-modal-confirm"));

    await waitFor(() => {
      expect(api.postDivergeRegenerateContradiction).toHaveBeenCalledWith(
        "p1",
        { user_modifications: "换个矛盾方向" },
      );
      expect(onCanvasMutated).toHaveBeenCalled();
    });
    // /regenerate/contradiction only clears the saved contradiction; the
    // child re-fetches candidates via the regenKey effect dep.
    await waitFor(() => {
      expect((api.postDivergeContradict as unknown as ReturnType<typeof vi.fn>).mock.calls.length)
        .toBeGreaterThan(callsBefore);
    });
  });

  it("uses persisted candidates when initialCandidates.variant_id matches variants[0].id", async () => {
    // Fast-path: when the user navigates back from a later stage without
    // changing anything upstream, the canvas already has the candidate set
    // the user originally picked from. S0C reads it instead of re-running
    // the LLM. Asserting that postDivergeContradict is NOT called proves
    // the cache short-circuit fired.
    const onCanvasMutated = vi.fn();
    render(
      <S0CContradictionStep
        projectId="p1"
        variants={sampleVariants}
        initialCandidates={{
          variant_id: "v1",
          variant_content: "一个前提",
          generated_at: "2026-09-01T00:00:00Z",
          candidates,
        }}
        onComplete={() => {}}
        onBack={() => {}}
        onCanvasMutated={onCanvasMutated}
      />,
    );
    await waitFor(() => screen.getAllByTestId(/^candidate-/));
    // The cached set is 3 (2 candidates + 1 custom). Both template cards
    // must be present without any LLM call.
    expect(screen.getByTestId("candidate-能力×限制")).toBeInTheDocument();
    expect(screen.getByTestId("candidate-目标×代价")).toBeInTheDocument();
    expect(api.postDivergeContradict).not.toHaveBeenCalled();
    // Sanity: parent hasn't been told to mutate canvas (no LLM round-trip).
    expect(onCanvasMutated).not.toHaveBeenCalled();
  });

  it("re-fetches when initialCandidates.variant_id does NOT match variants[0].id", async () => {
    // After a /regenerate/variants call, variants[0].id is new but the
    // persisted candidates are stale (still keyed by the old variant_id).
    // The fast-path should NOT fire — we need a fresh /contradict call.
    render(
      <S0CContradictionStep
        projectId="p1"
        variants={[{ ...sampleVariants[0], id: "v99" }, ...sampleVariants]}
        initialCandidates={{
          variant_id: "v1",  // stale — variants[0].id is now v99
          variant_content: "old premise",
          generated_at: "2026-09-01T00:00:00Z",
          candidates,
        }}
        onComplete={() => {}}
        onBack={() => {}}
      />,
    );
    await waitFor(() => {
      expect(api.postDivergeContradict).toHaveBeenCalledWith(
        "p1",
        { variant_id: "v99", variant_content: "一个前提" },
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
    });
  });

  it("calls onCanvasMutated after a fresh /contradict POST so D→C back-nav hits the fast-path", async () => {
    // Repro of the bug found 2026-09-02: S0C's fetch handler only updated
    // local candidates + selected state. Parent's state.contradictionCandidates
    // is the ONLY thing the fast-path checks on remount, and it only syncs
    // from canvas via loadCanvas() — which never re-ran between C's fetch and
    // a plain C→D→back-to-C sequence. So every D→C back-nav triggered a fresh
    // 15-20s LLM expansion. The fix: call onCanvasMutated after the POST
    // resolves, so the parent's loadCanvas syncs state.contradictionCandidates
    // from canvas's persisted candidates.
    const onCanvasMutated = vi.fn();
    render(
      <S0CContradictionStep
        projectId="p1"
        variants={sampleVariants}
        onComplete={() => {}}
        onBack={() => {}}
        onCanvasMutated={onCanvasMutated}
      />,
    );
    await waitFor(() => {
      expect(api.postDivergeContradict).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(onCanvasMutated).toHaveBeenCalled();
    });
  });

  it("does NOT call onCanvasMutated on the fast-path (initialCandidates already cached)", async () => {
    // Inverse of the above: when the fast-path hits (variant_id matches,
    // candidates cached), there's no new canvas write to sync — onCanvasMutated
    // would only trigger an unnecessary loadCanvas round-trip. Pairs with
    // the test above to lock in the conditional behavior.
    const onCanvasMutated = vi.fn();
    render(
      <S0CContradictionStep
        projectId="p1"
        variants={sampleVariants}
        initialCandidates={{
          variant_id: "v1",  // matches variants[0].id
          variant_content: "一个前提",
          generated_at: "2026-09-01T00:00:00Z",
          candidates,
        }}
        onComplete={() => {}}
        onBack={() => {}}
        onCanvasMutated={onCanvasMutated}
      />,
    );
    await waitFor(() => screen.getAllByTestId(/^candidate-/));
    // Fast-path populated candidates without a fetch, so no canvas mutation
    // happened — onCanvasMutated must not be called.
    expect(api.postDivergeContradict).not.toHaveBeenCalled();
    expect(onCanvasMutated).not.toHaveBeenCalled();
  });

  // Regression for the S0A-S0E audit's #1 gap: S0B's user selection used to
  // be dead state. S0C always used variants[0] (INVERSION/m0) regardless
  // of which variants the user picked. After fix: the first picked variant
  // is the source of the contradiction, so the user sees their pick drive
  // the generation, not just back-nav highlight.
  it("uses S0B's first selected variant for /contradict when selectedVariantIds provided", async () => {
    render(
      <S0CContradictionStep
        projectId="p1"
        variants={[
          { ...sampleVariants[0], id: "v1", title: "变体1", premise_one_line: "前提1" },
          { ...sampleVariants[0], id: "v2", title: "变体2", premise_one_line: "前提2" },
          { ...sampleVariants[0], id: "v3", title: "变体3", premise_one_line: "前提3" },
        ]}
        selectedVariantIds={["v3", "v1"]}  // first picked = v3, not variants[0]=v1
        onComplete={() => {}}
        onBack={() => {}}
      />,
    );
    await waitFor(() => {
      expect(api.postDivergeContradict).toHaveBeenCalledWith(
        "p1",
        { variant_id: "v3", variant_content: "前提3" },
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
    });
  });

  // Defensive fallback: S0B submit is disabled at selected.size === 0 so
  // this branch shouldn't fire in production, but if a future flow bypasses
  // S0B (e.g. quick-mode-from-A-to-C without B), S0C must still work using
  // variants[0] as the source.
  it("falls back to variants[0] for /contradict when selectedVariantIds is empty", async () => {
    render(
      <S0CContradictionStep
        projectId="p1"
        variants={[
          { ...sampleVariants[0], id: "v1", premise_one_line: "前提1" },
          { ...sampleVariants[0], id: "v2", premise_one_line: "前提2" },
        ]}
        selectedVariantIds={[]}
        onComplete={() => {}}
        onBack={() => {}}
      />,
    );
    await waitFor(() => {
      expect(api.postDivergeContradict).toHaveBeenCalledWith(
        "p1",
        { variant_id: "v1", variant_content: "前提1" },
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
    });
  });
});