import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import S2DecomposeStep from "@/components/wizard/divergence_v2/S2DecomposeStep";
import type { DimensionDecomposition } from "@/components/wizard/divergence_v2/types";

const MOCK_DIMENSIONS: DimensionDecomposition[] = [
  {
    dimension: "ontology",
    insight: "本土天道 vs 异域天道的殖民",
    units: [
      { id: "u1", dimension: "ontology", unit_name: "灵窍", description: "灵窍是接口...", follow_up_count: 0, is_irreducible: false },
      { id: "u2", dimension: "ontology", unit_name: "本源", description: "本源是...", follow_up_count: 1, is_irreducible: true },
      { id: "u4", dimension: "ontology", unit_name: "天道", description: "天道是...", follow_up_count: 0, is_irreducible: false },
    ],
    candidates: [],
    dimension_status: "decomposed",
  },
  {
    dimension: "energetics",
    insight: "修炼本质是编译",
    units: [{ id: "u3", dimension: "energetics", unit_name: "修行", description: "...", follow_up_count: 0, is_irreducible: false }],
    candidates: [],
    dimension_status: "decomposed",
  },
  {
    // Round 5: narrative_physics with non-empty insight → 核心矛盾 virtual unit.
    dimension: "narrative_physics",
    insight: "修炼本质是一场与天道的辩论,主角必须以凡人之力证明自己有资格改写规则",
    units: [
      { id: "u_np1", dimension: "narrative_physics", unit_name: "节奏", description: "持久战逻辑", follow_up_count: 0, is_irreducible: false },
    ],
    candidates: [],
    dimension_status: "decomposed",
  },
];

function renderS2(overrides: Partial<Parameters<typeof S2DecomposeStep>[0]> = {}) {
  const onFollowUp = vi.fn();
  const props = {
    dimensions: MOCK_DIMENSIONS,
    followUpLoadingUnitId: null,
    onFollowUp,
    ...overrides,
  };
  return { ...render(<S2DecomposeStep {...props} />), onFollowUp };
}

describe("S2DecomposeStep", () => {
  it("renders all dimension blocks by id", () => {
    renderS2();
    expect(screen.getByTestId("dimension-ontology")).toBeInTheDocument();
    expect(screen.getByTestId("dimension-energetics")).toBeInTheDocument();
    expect(screen.getByTestId("dimension-narrative_physics")).toBeInTheDocument();
  });

  it("does not render the Stage-2 header or causal_map (both removed 2026-09-08)", () => {
    renderS2();
    expect(screen.queryByText(/Stage 2 · 第一性拆解/)).toBeNull();
    expect(screen.queryByTestId("causal-map")).toBeNull();
  });

  it("renders a 追问 button for every non-virtual reducible unit", () => {
    renderS2();
    // u2 is irreducible (disabled) but the button still renders.
    expect(screen.getByTestId("follow-up-u1")).toBeInTheDocument();
    expect(screen.getByTestId("follow-up-u2")).toBeInTheDocument();
    expect(screen.getByTestId("follow-up-u3")).toBeInTheDocument();
    expect(screen.getByTestId("follow-up-u4")).toBeInTheDocument();
    expect(screen.getByTestId("follow-up-u_np1")).toBeInTheDocument();
    // The virtual __core_contradiction__ unit must NOT have a follow-up button.
    expect(screen.queryByTestId("follow-up-__core_contradiction__")).toBeNull();
  });

  it("labels 追问 buttons by follow_up_count and is_irreducible", () => {
    renderS2();
    expect(screen.getByTestId("follow-up-u1")).toHaveTextContent("追问");
    expect(screen.getByTestId("follow-up-u2")).toHaveTextContent("已不可再分");
    expect(screen.getByTestId("follow-up-u3")).toHaveTextContent("追问");
    expect(screen.getByTestId("follow-up-u4")).toHaveTextContent("追问");
  });

  it("disables the button on irreducible units", () => {
    renderS2();
    expect(screen.getByTestId("follow-up-u1")).not.toBeDisabled();
    expect(screen.getByTestId("follow-up-u2")).toBeDisabled();
    expect(screen.getByTestId("follow-up-u3")).not.toBeDisabled();
    expect(screen.getByTestId("follow-up-u4")).not.toBeDisabled();
  });

  it("applies opacity-50 to the unit card while its follow-up is loading", () => {
    const { container } = renderS2({ followUpLoadingUnitId: "u1" });
    const card = container.querySelector('[data-testid="unit-u1"]') as HTMLElement;
    expect(card.className).toContain("opacity-50");
  });

  it("survives undefined dimensions without crashing (defense-in-depth)", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    renderS2({ dimensions: undefined as any });
    expect(screen.queryAllByTestId(/^dimension-/)).toHaveLength(0);
  });

  // 「总览」 top-level summary was removed on 2026-09-11 — the scroll
  // container now goes straight to dimension blocks. The state field
  // `state.topLevelSummary` is still persisted (round-trip with backend)
  // but S2 no longer surfaces it. See S2DecomposeStep.tsx for the rationale.

  // ── Round 5 — narrative_physics prepends 核心矛盾 virtual unit ──────

  it("narrative_physics prepends 核心矛盾 virtual unit when insight is non-empty (Round 5 — item 6)", () => {
    renderS2();
    // The virtual unit card exists with the canonical id and badge.
    expect(screen.getByTestId("unit-__core_contradiction__")).toBeInTheDocument();
    expect(screen.getByTestId("core-contradiction-badge-__core_contradiction__")).toBeInTheDocument();
    // Its description equals the dimension's insight.
    const card = screen.getByTestId("unit-__core_contradiction__");
    expect(card).toHaveTextContent("修炼本质是一场与天道的辩论,主角必须以凡人之力证明自己有资格改写规则");
  });

  it("核心矛盾 virtual unit is irreducible (no 追问 button, no dialog)", () => {
    renderS2();
    expect(screen.queryByTestId("follow-up-__core_contradiction__")).toBeNull();
    // Clicking around its card must not open the follow-up modal.
    fireEvent.click(screen.getByTestId("unit-__core_contradiction__"));
    expect(screen.queryByTestId("regenerate-modal")).toBeNull();
  });

  it("核心矛盾 virtual unit counts toward the dimension header tally", () => {
    renderS2();
    // narrative_physics had 1 real unit; +1 virtual → "2 单元"
    const dimHeader = screen.getByTestId("dimension-narrative_physics");
    expect(dimHeader).toHaveTextContent("2 单元");
  });

  it("核心矛盾 virtual unit NOT prepended when narrative_physics has empty insight", () => {
    const dims: DimensionDecomposition[] = [
      {
        dimension: "narrative_physics",
        insight: "",
        units: [{ id: "np_only", dimension: "narrative_physics", unit_name: "节奏", description: "...", follow_up_count: 0, is_irreducible: false }],
        candidates: [],
        dimension_status: "decomposed",
      },
    ];
    renderS2({ dimensions: dims });
    expect(screen.queryByTestId("unit-__core_contradiction__")).toBeNull();
    expect(screen.getByTestId("unit-np_only")).toBeInTheDocument();
  });

  it("核心矛盾 virtual unit NOT prepended on other dimensions even with non-empty insight", () => {
    // ontology has insight but should NOT get the virtual unit — the
    // virtual unit is specific to narrative_physics.
    renderS2();
    // 4 ontology units total (u1, u2, u4, + only these 3 — no virtual)
    const ontologyBlock = screen.getByTestId("dimension-ontology");
    expect(ontologyBlock.querySelectorAll('[data-testid^="unit-"]')).toHaveLength(3);
    expect(ontologyBlock.querySelector('[data-testid="unit-__core_contradiction__"]')).toBeNull();
  });

  // ── Round 3 — follow-up moved to top-level RegenerateModal ─────────

  it("clicking 追问 opens top-level RegenerateModal with unit name in title (Round 3 — item 4)", () => {
    renderS2();
    expect(screen.queryByTestId("regenerate-modal")).toBeNull();
    fireEvent.click(screen.getByTestId("follow-up-u1"));
    expect(screen.getByTestId("regenerate-modal")).toBeInTheDocument();
    expect(screen.getByText(/追问 — 灵窍|追问 - 灵窍/)).toBeInTheDocument();
  });

  it("confirming modal with text calls onFollowUp with the trimmed question (Round 3 — item 4)", async () => {
    const { onFollowUp } = renderS2();
    fireEvent.click(screen.getByTestId("follow-up-u1"));
    fireEvent.change(screen.getByLabelText(/修改意见/i), {
      target: { value: "  灵窍如何验证?  " },
    });
    fireEvent.click(screen.getByTestId("regenerate-modal-confirm"));
    await waitFor(() =>
      expect(onFollowUp).toHaveBeenCalledWith("u1", "灵窍如何验证?"),
    );
    expect(screen.queryByTestId("regenerate-modal")).toBeNull();
  });

  it("confirming modal with empty input calls onFollowUp with null (Round 3 — item 4)", () => {
    const { onFollowUp } = renderS2();
    fireEvent.click(screen.getByTestId("follow-up-u1"));
    fireEvent.click(screen.getByTestId("regenerate-modal-confirm"));
    expect(onFollowUp).toHaveBeenCalledWith("u1", null);
  });

  it("canceling modal does not call onFollowUp (Round 3 — item 4)", () => {
    const { onFollowUp } = renderS2();
    fireEvent.click(screen.getByTestId("follow-up-u1"));
    fireEvent.click(screen.getByTestId("regenerate-modal-cancel"));
    expect(onFollowUp).not.toHaveBeenCalled();
    expect(screen.queryByTestId("regenerate-modal")).toBeNull();
  });

  it("switching to a different unit swaps the modal title (Round 3 — item 4)", () => {
    // The top-level modal is a singleton — clicking a different unit's
    // 追问 while the modal is already open should re-target it to the new
    // unit's name. We assert the title text reflects the most recent click.
    renderS2();
    fireEvent.click(screen.getByTestId("follow-up-u1"));
    // Cancel u1's dialog, then open u3 (different dimension).
    fireEvent.click(screen.getByTestId("regenerate-modal-cancel"));
    fireEvent.click(screen.getByTestId("follow-up-u3"));
    expect(screen.getByText(/追问 — 修行|追问 - 修行/)).toBeInTheDocument();
  });
});
