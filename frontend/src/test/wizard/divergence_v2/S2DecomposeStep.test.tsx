import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
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
  const onSavePrompt = vi.fn();
  const props = {
    dimensions: MOCK_DIMENSIONS,
    topLevelSummary: "",
    decomposePrompt: "",           // new (default empty)
    promptBusy: false,             // new
    followUpLoadingUnitId: null,
    onFollowUp,
    onSavePrompt,                  // new
    ...overrides,
  };
  return { ...render(<S2DecomposeStep {...props} />), onFollowUp, onSavePrompt };
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

  it("renders top_level_summary paragraph without a 「总览」 heading (Round 4 — h3 removed 2026-09-11)", () => {
    renderS2({ topLevelSummary: "一句话总结:这是一个关于修仙殖民的故事" });
    const block = screen.getByTestId("top-level-summary");
    expect(block).toHaveTextContent("一句话总结:这是一个关于修仙殖民的故事");
    // The 「总览」 title row was removed on 2026-09-11 — the block is just
    // a paragraph now, no h3 heading above it.
    expect(block.querySelector("h3")).toBeNull();
    expect(screen.queryByText(/^总览$/)).toBeNull();
  });

  it("top-level summary appears BEFORE dimension blocks (Round 4 — item 5)", () => {
    renderS2({ topLevelSummary: "一句话总结:这是一个关于修仙殖民的故事" });
    const summary = screen.getByTestId("top-level-summary");
    const firstDim = screen.getByTestId("dimension-ontology");
    // summary.compareDocumentPosition(firstDim) & Node.DOCUMENT_POSITION_FOLLOWING === 4
    expect(summary.compareDocumentPosition(firstDim) & 4).toBe(4);
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

  it("labels 追问 buttons by is_irreducible (follow_up_count moved to inline header on 2026-09-19)", () => {
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

  // ── 2026-09-15: stacked cards → horizontal tab strip ──────────────

  describe("S2DecomposeStep tab strip", () => {
    it("renders one tab per dimension in DIMENSION_ORDER (5 total)", () => {
      // MOCK_DIMENSIONS covers ontology/energetics/narrative_physics.
      // power_structure / protagonist_engine 没数据,不应出 tab。
      renderS2();
      expect(screen.getByTestId("dimension-tabs")).toBeInTheDocument();
      expect(screen.getByTestId("dimension-tab-ontology")).toBeInTheDocument();
      expect(screen.getByTestId("dimension-tab-energetics")).toBeInTheDocument();
      expect(screen.getByTestId("dimension-tab-narrative_physics")).toBeInTheDocument();
      expect(screen.queryByTestId("dimension-tab-power_structure")).toBeNull();
      expect(screen.queryByTestId("dimension-tab-protagonist_engine")).toBeNull();
    });

    it("marks the first DIMENSION_ORDER dimension as active by default", () => {
      renderS2();
      expect(screen.getByTestId("dimension-tab-ontology")).toHaveAttribute("aria-selected", "true");
      expect(screen.getByTestId("dimension-tab-energetics")).toHaveAttribute("aria-selected", "false");
      expect(screen.getByTestId("dimension-tab-narrative_physics")).toHaveAttribute("aria-selected", "false");
    });

    it("switches active tab on click", () => {
      renderS2();
      fireEvent.click(screen.getByTestId("dimension-tab-narrative_physics"));
      expect(screen.getByTestId("dimension-tab-narrative_physics")).toHaveAttribute("aria-selected", "true");
      expect(screen.getByTestId("dimension-tab-ontology")).toHaveAttribute("aria-selected", "false");
    });

    it("only one dimension panel is visible at a time; others carry `hidden`", () => {
      // All panels are still in DOM (testids resolve regardless of `hidden`),
      // but only the active one lacks the `hidden` attribute.
      renderS2();
      const ontology = screen.getByTestId("dimension-ontology") as HTMLElement;
      const energetics = screen.getByTestId("dimension-energetics") as HTMLElement;
      const narrative = screen.getByTestId("dimension-narrative_physics") as HTMLElement;
      // 默认 ontology 可见,其它两个 hidden
      expect(ontology.hasAttribute("hidden")).toBe(false);
      expect(energetics.hasAttribute("hidden")).toBe(true);
      expect(narrative.hasAttribute("hidden")).toBe(true);

      // 切到 energetics → 状态互换
      fireEvent.click(screen.getByTestId("dimension-tab-energetics"));
      expect((screen.getByTestId("dimension-ontology") as HTMLElement).hasAttribute("hidden")).toBe(true);
      expect((screen.getByTestId("dimension-energetics") as HTMLElement).hasAttribute("hidden")).toBe(false);
      expect((screen.getByTestId("dimension-narrative_physics") as HTMLElement).hasAttribute("hidden")).toBe(true);
    });

    it("tab labels show Chinese dimension name + unit count", () => {
      renderS2();
      expect(screen.getByTestId("dimension-tab-ontology")).toHaveTextContent("世界构成");
      expect(screen.getByTestId("dimension-tab-ontology")).toHaveTextContent("3");  // 3 units
      expect(screen.getByTestId("dimension-tab-energetics")).toHaveTextContent("能量体系");
      expect(screen.getByTestId("dimension-tab-energetics")).toHaveTextContent("1");
    });

    it("does not render the tab strip when no dimensions are present", () => {
      renderS2({ dimensions: [] });
      expect(screen.queryByTestId("dimension-tabs")).toBeNull();
    });
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

  it("核心矛盾 virtual unit counts toward the dimension tab tally (2026-09-15: header moved to tab)", () => {
    renderS2();
    // narrative_physics had 1 real unit; +1 virtual → tab shows "2".
    const tab = screen.getByTestId("dimension-tab-narrative_physics");
    expect(tab).toHaveTextContent("2");
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
      expect(onFollowUp).toHaveBeenCalledWith("u1", "灵窍如何验证?", "none"),
    );
    expect(screen.queryByTestId("regenerate-modal")).toBeNull();
  });

  it("confirming modal with empty input calls onFollowUp with null (Round 3 — item 4)", () => {
    const { onFollowUp } = renderS2();
    fireEvent.click(screen.getByTestId("follow-up-u1"));
    fireEvent.click(screen.getByTestId("regenerate-modal-confirm"));
    expect(onFollowUp).toHaveBeenCalledWith("u1", null, "none");
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

  // ── 2026-09-15: 追问 modal title/button context (user-reported) ───────

  it("modal title is exactly 「追问 — {unit}」, NOT 「重新生成 — 追问 - {unit}」", () => {
    // Regression guard for the user-reported "auto-regenerate" confusion:
    // the title used to be "重新生成 — 追问 - 灵窍" which mixed both words
    // and made it sound like regenerate was already happening. The new
    // title is just "追问 — 灵窍".
    renderS2();
    fireEvent.click(screen.getByTestId("follow-up-u1"));
    const title = document.getElementById("regenerate-modal-title");
    expect(title?.textContent).toBe("追问 — 灵窍");
    expect(title?.textContent).not.toContain("重新生成");
  });

  it("modal confirm button is labeled 「追问」 (not 「重新生成」)", () => {
    // The user explicitly asked for the button inside the modal to be
    // labeled "追问" — matches the outer button label so the second click
    // feels like a confirmation of the same action.
    renderS2();
    fireEvent.click(screen.getByTestId("follow-up-u1"));
    // Use the modal's specific testid to disambiguate from the per-unit
    // 追问 button (which is still in the DOM with the same label).
    const modal = screen.getByTestId("regenerate-modal");
    expect(within(modal).getByRole("button", { name: "追问" })).toBeInTheDocument();
    expect(within(modal).queryByRole("button", { name: "重新生成" })).toBeNull();
  });

  it("modal busy text becomes 「追问中…」 when followUpLoadingUnitId is set", () => {
    renderS2({ followUpLoadingUnitId: "u1" });
    fireEvent.click(screen.getByTestId("follow-up-u1"));
    expect(screen.getByText("追问中…")).toBeInTheDocument();
  });

  it("does NOT auto-fire onFollowUp when the modal opens — only on confirm", () => {
    // Regression guard for the user-reported "auto-regenerate" behavior.
    // Opening the modal (without clicking confirm) must NOT trigger the
    // follow-up API call.
    const { onFollowUp } = renderS2();
    fireEvent.click(screen.getByTestId("follow-up-u1"));
    expect(onFollowUp).not.toHaveBeenCalled();
    // Cancel also must not fire it.
    fireEvent.click(screen.getByTestId("regenerate-modal-cancel"));
    expect(onFollowUp).not.toHaveBeenCalled();
  });

  // ─— Round 7: edit icon on top-level summary ─────────────────────────────

  describe("S2DecomposeStep edit-decompose-prompt icon", () => {
    it("does NOT render the icon when topLevelSummary is empty", () => {
      renderS2({ topLevelSummary: "" });
      expect(screen.queryByTestId("edit-decompose-prompt-btn")).toBeNull();
    });

    it("renders the edit-decompose-prompt icon next to topLevelSummary", () => {
      renderS2({ topLevelSummary: "一句话总结" });
      const summary = screen.getByTestId("top-level-summary");
      const btn = screen.getByTestId("edit-decompose-prompt-btn");
      expect(summary).toContainElement(btn);
      expect(btn).toHaveAttribute("aria-label", expect.stringMatching(/查看|编辑/));
    });

    it("clicking the icon opens EditPromptModal prefilled with decomposePrompt", () => {
      renderS2({
        topLevelSummary: "一句话",
        decomposePrompt: "你是一位叙事结构诊断师...",
      });
      expect(screen.queryByTestId("edit-prompt-modal")).toBeNull();
      fireEvent.click(screen.getByTestId("edit-decompose-prompt-btn"));
      expect(screen.getByTestId("edit-prompt-modal")).toBeInTheDocument();
      const textarea = screen.getByLabelText("专用提示词") as HTMLTextAreaElement;
      expect(textarea.value).toBe("你是一位叙事结构诊断师...");
    });

    it("confirming EditPromptModal calls onSavePrompt with edited text", () => {
      const onSavePrompt = vi.fn();
      renderS2({
        topLevelSummary: "一句话",
        decomposePrompt: "初始文本",
        onSavePrompt,
      });
      fireEvent.click(screen.getByTestId("edit-decompose-prompt-btn"));
      const textarea = screen.getByLabelText("专用提示词");
      fireEvent.change(textarea, { target: { value: "修改后" } });
      fireEvent.click(screen.getByTestId("edit-prompt-modal-confirm"));
      expect(onSavePrompt).toHaveBeenCalledWith("修改后");
    });

    it("canceling EditPromptModal does NOT call onSavePrompt", () => {
      const onSavePrompt = vi.fn();
      renderS2({
        topLevelSummary: "一句话",
        decomposePrompt: "x",
        onSavePrompt,
      });
      fireEvent.click(screen.getByTestId("edit-decompose-prompt-btn"));
      fireEvent.click(screen.getByTestId("edit-prompt-modal-cancel"));
      expect(onSavePrompt).not.toHaveBeenCalled();
      expect(screen.queryByTestId("edit-prompt-modal")).toBeNull();
    });

    it("does NOT auto-trigger decompose after save — user must click footer regen", () => {
      // The component itself never calls onFollowUp-like; onSavePrompt is the
      // only side-effect. onFollowUp (the existing prop) is for unit 追问 only.
      const onSavePrompt = vi.fn();
      const onFollowUp = vi.fn();
      renderS2({
        topLevelSummary: "一句话",
        decomposePrompt: "x",
        onSavePrompt,
        onFollowUp,
      });
      fireEvent.click(screen.getByTestId("edit-decompose-prompt-btn"));
      fireEvent.click(screen.getByTestId("edit-prompt-modal-confirm"));
      expect(onSavePrompt).toHaveBeenCalled();
      expect(onFollowUp).not.toHaveBeenCalled();
    });

    it("disables the modal save button while promptBusy=true", () => {
      renderS2({
        topLevelSummary: "一句话",
        decomposePrompt: "x",
        promptBusy: true,
      });
      fireEvent.click(screen.getByTestId("edit-decompose-prompt-btn"));
      expect(screen.getByTestId("edit-prompt-modal-confirm")).toBeDisabled();
      expect(screen.getByTestId("edit-prompt-modal-cancel")).toBeDisabled();
    });
  });

  // ── 2026-09-19: S2 追问 modal operator selector (无算子 / 自适应) ─────

  describe("S2DecomposeStep follow-up operator selector", () => {
    it("the follow-up modal exposes an operator dropdown defaulting to 「无算子」", () => {
      // Opening any unit's 追问 modal should reveal a dropdown with two
      // options; the default value should be 「无算子」 (preserves legacy
      // behavior — clicking 追问 without touching the dropdown must keep
      // the original 追问式深化 prompt path).
      renderS2();
      fireEvent.click(screen.getByTestId("follow-up-u1"));
      const dropdown = screen.getByTestId("regenerate-modal-operator") as HTMLSelectElement;
      expect(dropdown).toBeInTheDocument();
      expect(dropdown.value).toBe("none");
      const options = within(dropdown).getAllByRole("option");
      expect(options.map((o) => (o as HTMLOptionElement).value)).toEqual(["none", "adaptive"]);
    });

    it("confirming with 「自适应」 selected forwards operator='adaptive' to onFollowUp", () => {
      const { onFollowUp } = renderS2();
      fireEvent.click(screen.getByTestId("follow-up-u1"));
      const dropdown = screen.getByTestId("regenerate-modal-operator") as HTMLSelectElement;
      fireEvent.change(dropdown, { target: { value: "adaptive" } });
      fireEvent.change(screen.getByLabelText(/修改意见/i), {
        target: { value: "让门派结构更松动" },
      });
      fireEvent.click(screen.getByTestId("regenerate-modal-confirm"));
      expect(onFollowUp).toHaveBeenCalledWith("u1", "让门派结构更松动", "adaptive");
    });

    it("confirming with 「自适应」 + empty text still calls onFollowUp (null question, 'adaptive' operator)", () => {
      // Adaptive mode should work even when the user provides no question —
      // the operator alone is enough for the prompt to scan-and-route.
      const { onFollowUp } = renderS2();
      fireEvent.click(screen.getByTestId("follow-up-u3"));
      const dropdown = screen.getByTestId("regenerate-modal-operator") as HTMLSelectElement;
      fireEvent.change(dropdown, { target: { value: "adaptive" } });
      fireEvent.click(screen.getByTestId("regenerate-modal-confirm"));
      expect(onFollowUp).toHaveBeenCalledWith("u3", null, "adaptive");
    });

    it("cancelling after switching operator does NOT call onFollowUp", () => {
      // The dropdown is open-state; cancel must discard any operator switch.
      const { onFollowUp } = renderS2();
      fireEvent.click(screen.getByTestId("follow-up-u1"));
      fireEvent.change(screen.getByTestId("regenerate-modal-operator"), {
        target: { value: "adaptive" },
      });
      fireEvent.click(screen.getByTestId("regenerate-modal-cancel"));
      expect(onFollowUp).not.toHaveBeenCalled();
    });

    it("the operator resets to 'none' between consecutive 追问 invocations", () => {
      // After closing the modal (cancel or confirm), the next 追问 click
      // must start from the default again — otherwise a single accidental
      // switch would lock the user into adaptive mode for all subsequent
      // units. The hook owns the state; cancel/confirm reset it explicitly.
      const { onFollowUp } = renderS2();
      // First round: switch to adaptive, then cancel.
      fireEvent.click(screen.getByTestId("follow-up-u1"));
      fireEvent.change(screen.getByTestId("regenerate-modal-operator"), {
        target: { value: "adaptive" },
      });
      fireEvent.click(screen.getByTestId("regenerate-modal-cancel"));
      // Second round: open on a different unit, default should be 'none'.
      fireEvent.click(screen.getByTestId("follow-up-u3"));
      expect(
        (screen.getByTestId("regenerate-modal-operator") as HTMLSelectElement).value,
      ).toBe("none");
      fireEvent.click(screen.getByTestId("regenerate-modal-confirm"));
      expect(onFollowUp).toHaveBeenLastCalledWith("u3", null, "none");
    });
  });

  // ── 2026-09-19: UnitCard renders operator label after unit_name ────────

  describe("S2DecomposeStep UnitCard operator label", () => {
    it("renders the operator tag when main_operator is set on the unit", () => {
      // Adaptive follow-up responses carry main_operator / aux_operator /
      // chain_reaction; the UI must surface the chosen operator so users
      // can see what the last round actually applied.
      const dims: DimensionDecomposition[] = [
        {
          dimension: "ontology",
          insight: "",
          units: [
            {
              id: "u_op",
              dimension: "ontology",
              unit_name: "灵窍",
              description: "扭曲后的版本",
              follow_up_count: 1,
              is_irreducible: false,
              main_operator: "distort",
              aux_operator: "break",
              chain_reaction: "参数调试后整个灵脉网络反相",
            },
          ],
          candidates: [],
          dimension_status: "decomposed",
        },
      ];
      renderS2({ dimensions: dims });
      const tag = screen.getByTestId("unit-operator-u_op");
      expect(tag).toHaveTextContent("扭曲");
      expect(tag).toHaveTextContent("打破");
    });

    it("does NOT render an operator tag when main_operator is null", () => {
      // Units produced before the operator feature shipped (or units whose
      // last 追问 was the legacy 无算子 path) have no operator metadata —
      // the UI must render nothing rather than an empty tag.
      renderS2();
      expect(screen.queryByTestId("unit-operator-u1")).toBeNull();
    });

    it("renders only the main operator when aux_operator is null", () => {
      const dims: DimensionDecomposition[] = [
        {
          dimension: "ontology",
          insight: "",
          units: [
            {
              id: "u_main_only",
              dimension: "ontology",
              unit_name: "灵脉",
              description: "融合后",
              follow_up_count: 1,
              is_irreducible: false,
              main_operator: "blend",
              aux_operator: null,
            },
          ],
          candidates: [],
          dimension_status: "decomposed",
        },
      ];
      renderS2({ dimensions: dims });
      const tag = screen.getByTestId("unit-operator-u_main_only");
      expect(tag).toHaveTextContent("融合");
      expect(tag).not.toHaveTextContent("打破");
      expect(tag).not.toHaveTextContent("+");
    });
  });

  // ── 2026-09-19: follow-up count moved from button label to inline header ──

  describe("S2DecomposeStep inline follow-up count badge", () => {
    it("renders the inline badge after unit_name when follow_up_count > 0", () => {
      // 2026-09-19: the "已追问 N 次" label was moved out of the button
      // (where it hijacked the button text on every additional click)
      // into a small header badge next to the operator tag. Same font
      // size as the operator (font-mono text-[10px]).
      const dims: DimensionDecomposition[] = [
        {
          dimension: "ontology",
          insight: "",
          units: [
            {
              id: "u_fup",
              dimension: "ontology",
              unit_name: "灵窍",
              description: "d",
              follow_up_count: 3,
              is_irreducible: false,
            },
          ],
          candidates: [],
          dimension_status: "decomposed",
        },
      ];
      renderS2({ dimensions: dims });
      const badge = screen.getByTestId("unit-followup-count-u_fup");
      expect(badge).toHaveTextContent("已追问 3 次");
      // Same mono/size as the operator badge — they share the header line.
      expect(badge.className).toContain("font-mono");
      expect(badge.className).toContain("text-[10px]");
    });

    it("does NOT render the inline badge when follow_up_count === 0", () => {
      // Fresh units show nothing extra in the header — avoid visual noise.
      renderS2();
      expect(screen.queryByTestId("unit-followup-count-u1")).toBeNull();
      expect(screen.queryByTestId("unit-followup-count-u4")).toBeNull();
    });

    it("does NOT render the inline badge on irreducible units even if follow_up_count > 0", () => {
      // u2 in MOCK_DIMENSIONS has follow_up_count=1 + is_irreducible=true.
      // The badge's purpose is to invite further追问; irreducible units
      // can't be追问ed, so the badge would mislead.
      renderS2();
      expect(screen.queryByTestId("unit-followup-count-u2")).toBeNull();
    });

    it("the 追问 button no longer reads 「已追问 N 次」 — that label moved to the inline badge", () => {
      // Regression guard: this used to be the button label, but on every
      // additional click the button text grew longer and pushed the layout.
      const dims: DimensionDecomposition[] = [
        {
          dimension: "ontology",
          insight: "",
          units: [
            {
              id: "u_long",
              dimension: "ontology",
              unit_name: "灵窍",
              description: "d",
              follow_up_count: 5,
              is_irreducible: false,
            },
          ],
          candidates: [],
          dimension_status: "decomposed",
        },
      ];
      renderS2({ dimensions: dims });
      expect(screen.getByTestId("follow-up-u_long")).toHaveTextContent("追问");
      expect(screen.getByTestId("follow-up-u_long")).not.toHaveTextContent("已追问");
    });
  });
});
