import { useCallback, useEffect, useState } from "react";
import api, {
  type ContradictionCandidate,
  type CoreContradiction,
  type IdeaVariant,
  type RawIntent,
  type WhatIfNode,
} from "../../api/client";
import StepIndicator, {
  type SubStage,
} from "./divergence/StepIndicator";
import S0AInputStep from "./divergence/S0AInputStep";
import S0BMutationStep from "./divergence/S0BMutationStep";
import S0CContradictionStep from "./divergence/S0CContradictionStep";
import S0DWhatIfStep from "./divergence/S0DWhatIfStep";
import S0ECommitStep from "./divergence/S0ECommitStep";

interface Props {
  projectId: string;
}

/**
 * Persisted snapshot of the 5 contradiction candidates returned by
 * /contradict POST. Keyed by the variant they were derived from so a
 * C→D→back-to-C navigation can rehydrate the picker without re-running
 * the LLM (the candidates are non-deterministic — they may differ across
 * runs depending on LLM temperature/state). On variant change the cache
 * becomes stale and the frontend effect re-fetches.
 */
export interface PersistedCandidates {
  variant_id: string;
  variant_content: string;
  generated_at: string;
  candidates: ContradictionCandidate[];
}

interface DivergenceState {
  subStage: SubStage;
  rawIntent: RawIntent | null;
  variants: IdeaVariant[];
  /**
   * IDs of variants the user previously selected in S0B. Tracked separately
   * from `variants` so back-nav from C/D/E rehydrates the visual selection
   * (a Set is local component state and lost on remount).
   */
  selectedVariantIds: string[];
  /**
   * Last /contradict POST result, persisted by the backend on canvas.
   * S0C uses this to avoid re-running the LLM when the user navigates
   * back to C without changing anything upstream.
   */
  contradictionCandidates: PersistedCandidates | null;
  coreContradiction: CoreContradiction | null;
  selectedPath: string[];
  /**
   * Fusion variant returned by S0-A's /fuse call. Threaded through the
   * state so S0-B can render it as a distinguished card above the
   * mutation-chain variants, with the user's pick preserved across
   * C/D/E back-nav. Null when fusion was disabled or /fuse was not
   * attempted. S0-B owns its own copy (`fusionVariantState`) seeded from
   * this prop and manages re-rolls locally via 「重新融合」.
   */
  fusionVariant: IdeaVariant | null;
  /**
   * User-facing banner string shown above S0-B when /fuse failed (so the
   * user knows fusion was skipped, not silently absent). Stays across
   * C/D/E back-nav for the lifetime of the session; cleared on A
   * re-save (the next /fuse result replaces this either way).
   */
  fusionBanner: string | null;
  quickMode: boolean;
  loading: boolean;
  /**
   * Highest sub-stage the user has ever reached during this session.
   * Monotonic — only `nextAfterX` advances it. StepIndicator uses this
   * (not `subStage`) to compute clickable stages so the user can navigate
   * back without losing access to later stages. Initialized in the
   * mount effect from `inferSubStage(backend-state)`.
   */
  maxReachedSubStage: SubStage;
}

const INITIAL: DivergenceState = {
  subStage: "A",
  rawIntent: null,
  variants: [],
  selectedVariantIds: [],
  contradictionCandidates: null,
  coreContradiction: null,
  selectedPath: [],
  fusionVariant: null,
  fusionBanner: null,
  quickMode: false,
  loading: true,
  maxReachedSubStage: "A",
};

// Returns a DivergenceState patch with strictly-downstream fields cleared.
// When the user edits subStage X and clicks "下一步", we want fields past
// X to be empty so each S0* component's auto-trigger rebuilds them instead
// of seeing stale data from a prior run. Without this, the picker-list and
// tree would show contradictions / what-if paths built from the old prompt
// instead of the new one (the "you edited earlier and saved but the canvas
// still shows the old expansion" bug).
//
// Field ownership map:
//
//   A → rawIntent         clears {variants, contradictionCandidates,
//                          coreContradiction, selectedPath, fusionVariant,
//                          fusionBanner}
//   B → variants          clears {contradictionCandidates, coreContradiction,
//                          selectedPath}
//   C → coreContradiction clears {selectedPath}
//   D → selectedPath      no-op (last producing stage)
//   E → terminal          not applicable
//
// `contradictionCandidates` is cleared on A/B regen because the variants
// they're keyed by are being replaced (regen A re-rolls raw_intent which
// produces new variants; regen B re-rolls all 3 variants). The picker
// must rebuild from a fresh LLM call. C-regen clears the candidates via
// its own /regenerate/contradiction call.
//
// `fusionVariant` + `fusionBanner` are cleared on A-regen because S0-A
// owns the /fuse call (it runs on submit). Re-save A must produce a
// fresh /fuse result, so the prior pick + banner are stale.
//
// SubStage ordering for compare: A < B < C < D < E.
const SUB_STAGE_ORDER: SubStage[] = ["A", "B", "C", "D", "E"];

export function clearDownstream(current: SubStage): Partial<DivergenceState> {
  const idx = SUB_STAGE_ORDER.indexOf(current);
  if (idx < 0) return {};
  const cleared: Partial<DivergenceState> = {};
  // We clear all fields owned by a later sub-stage, except `quickMode`
  // (a sticky preference that survives edits) and `loading` / `subStage`
  // (managed by the calling onComplete callbacks).
  for (let later = idx + 1; later < SUB_STAGE_ORDER.length; later++) {
    const laterStage = SUB_STAGE_ORDER[later];
    if (laterStage === "B") {
      cleared.variants = [];
      cleared.selectedVariantIds = [];
    }
    else if (laterStage === "C") {
      // contradictionCandidates is owned by C (it's C's input — the
      // 5 options S0C asks the user to pick from). Clearing it on B-regen
      // ensures the picker re-fetches against the new variants.
      cleared.contradictionCandidates = null;
      cleared.coreContradiction = null;
    }
    else if (laterStage === "D") cleared.selectedPath = [];
    // E is terminal and owns no DivergenceState field.
  }
  // A owns the /fuse call — when re-saving A, clear the prior pick + banner
  // so the next /fuse result isn't shadowed. B/C/D/E don't reach this branch
  // (the user can't re-save A from those stages), so the prior /fuse result
  // remains valid as long as rawIntent didn't change.
  if (current === "A") {
    cleared.fusionVariant = null;
    cleared.fusionBanner = null;
  }
  return cleared;
}

// Pure merge helpers that mirror what each S0* onComplete callback does
// internally — spread `prev`, then spread cleared-downstream fields, then set
// the just-completed field + advance `subStage`. Extracted so tests can
// assert spread order without driving setState via React.
//
// Spread order matters: if `...prev` were placed after `...clearDownstream(...)`,
// the cleared fields would be re-applied with stale data and downstream edits
// (variants, coreContradiction, selectedPath) would survive an upstream resave —
// exactly the bug 9da1b89 fixed.

// Monotonic "highest stage reached" tracker. Independent of `subStage` (the
// current position) so navigating back via StepIndicator doesn't drop later
// stages from the clickable set. Internal-only — every call site is a
// `nextAfterX` helper, which already has the new target stage in scope.
function advanceMaxReached(prev: SubStage, next: SubStage): SubStage {
  return SUB_STAGE_ORDER.indexOf(prev) >= SUB_STAGE_ORDER.indexOf(next)
    ? prev
    : next;
}

export function nextAfterA(
  prev: DivergenceState,
  rawIntent: RawIntent,
  fusionVariant?: IdeaVariant | null,
  fusionBanner?: string | null,
): DivergenceState {
  // Task 11 wires the (fusionVariant, fusionBanner) tuple into the
  // DivergenceState. S0-A's onComplete signature already passes them up
  // (Task 9); this helper is where they become observable to S0-B's
  // parent render and to the banner. `clearDownstream("A")` resets both
  // fields to null first, then we apply the new values on top so a stale
  // pick from a prior run can't leak through after re-save.
  return {
    ...prev,
    ...clearDownstream("A"),
    rawIntent,
    fusionVariant: fusionVariant ?? null,
    fusionBanner: fusionBanner ?? null,
    subStage: "B",
    maxReachedSubStage: advanceMaxReached(prev.maxReachedSubStage, "B"),
  };
}

export function nextAfterB(
  prev: DivergenceState,
  variants: IdeaVariant[],
  selectedIds: string[],
): DivergenceState {
  return {
    ...prev,
    ...clearDownstream("B"),
    variants,
    selectedVariantIds: selectedIds,
    subStage: "C",
    maxReachedSubStage: advanceMaxReached(prev.maxReachedSubStage, "C"),
  };
}

export function nextAfterC(
  prev: DivergenceState,
  coreContradiction: CoreContradiction,
): DivergenceState {
  const nextSub = prev.quickMode ? "E" : "D";
  return {
    ...prev,
    ...clearDownstream("C"),
    coreContradiction,
    subStage: nextSub,
    maxReachedSubStage: advanceMaxReached(prev.maxReachedSubStage, nextSub),
  };
}

export function nextAfterD(
  prev: DivergenceState,
  path: string[],
): DivergenceState {
  return {
    ...prev,
    ...clearDownstream("D"),
    selectedPath: path,
    subStage: "E",
    maxReachedSubStage: advanceMaxReached(prev.maxReachedSubStage, "E"),
  };
}

// Infer the current SubStage from /creative/diverge/state payload. The
// backend persists a partial state for every step the user has cleared, so
// the largest "advanced" substage wins. Quick mode is read from the saved
// RawIntent and used by the parent to skip substage D when re-entering.
function inferSubStage(state: {
  raw_intent: RawIntent | null | undefined;
  idea_variants: IdeaVariant[] | undefined;
  core_contradiction: CoreContradiction | null | undefined;
  selected_path: string[] | undefined;
}): SubStage {
  if (!state.raw_intent) return "A";
  if ((state.idea_variants ?? []).length === 0) return "B";
  if (!state.core_contradiction) return "C";
  if ((state.selected_path ?? []).length < 2) return "D";
  return "E";
}

// Returns the set of subStages the user has reached and may revisit
// from StepIndicator. Inclusive of `maxReached` itself.
//
// Was: pure function on subStage only. Now: takes the persisted maxReached
// value (independent of current subStage), so navigating back to C
// doesn't drop D and E from the clickable set.
//
// Example: prev maxReached="E", user clicks indicator-3 (C). subStage="C",
// maxReachedSubStage remains "E". completedFor(E) returns
// ["A","B","C","D","E"] — D and E stay clickable.
export function completedFor(maxReached: SubStage): SubStage[] {
  // Inclusive of the maxReached stage itself. Each entry represents
  // "a stage the user has reached and can revisit"; excluding E meant
  // that once the user navigated away from sub-stage E (the commit
  // screen), E itself became un-clickable in StepIndicator until they
  // re-completed the entire flow. Without E in the list, the indicator
  // chip stayed visually identical to "unvisited" even though the user
  // had just submitted.
  //
  // Interaction with `isClickable = isCompleted && !isCurrent`:
  // - subStage=E, completed=[..,"E"] → E is current → not clickable (already there)
  // - subStage=D, completed=[..,"E"] → E is !current && in list → clickable
  // - subStage=A, completed=["A"] → only A; user can revisit B/C/D/E etc.
  if (maxReached === "A") return ["A"];
  if (maxReached === "B") return ["A", "B"];
  if (maxReached === "C") return ["A", "B", "C"];
  if (maxReached === "D") return ["A", "B", "C", "D"];
  return ["A", "B", "C", "D", "E"];
}

// Wraps a WhatIfNode-compatible "root" for S0D from the chosen
// CoreContradiction. The root node carries the contradiction's statement
// into the WhatIf tree; children are expanded lazily by S0DWhatIfStep.
function buildRootNode(core: CoreContradiction | null): WhatIfNode {
  return {
    id: core?.template_type ?? "root",
    parent_id: null,
    content: core?.statement ?? "",
    novelty_score: null,
    children_ids: [],
  };
}

export default function CreativeDivergenceStep({ projectId }: Props) {
  const [state, setState] = useState<DivergenceState>(INITIAL);
  // `canvasVersion` is a tick that we bump after a child triggers a regen
  // (A/B/C/D regen endpoints mutate canvas downstream). The mount effect
  // depends on it so re-running `loadCanvas` from the regen callback picks
  // up the new canvas state — the parent's DivergenceState.variants /
  // .coreContradiction / .selectedPath stay in sync with what the child
  // stages will see on next mount/navigation.
  const [canvasVersion, setCanvasVersion] = useState(0);

  const loadCanvas = useCallback(async () => {
    try {
      const response = await api.getDivergeState(projectId);
      const rawIntent = response?.raw_intent ?? null;
      const variants = response?.idea_variants ?? [];
      const core = response?.core_contradiction ?? null;
      const path = response?.selected_path ?? [];
      // /state returns the full canvas object — contradiction_candidates is
      // the same shape we POST to /contradict (variant_id + variant_content
      // + generated_at + candidates). Older projects may lack the field
      // entirely (added 2026-09-01); treat missing as null.
      const persisted =
        (response as { contradiction_candidates?: PersistedCandidates | null })
          ?.contradiction_candidates ?? null;
      const inferred = inferSubStage({
        raw_intent: rawIntent,
        idea_variants: variants,
        core_contradiction: core,
        selected_path: path,
      });
      setState((prev) => ({
        ...prev,
        subStage: inferred,
        maxReachedSubStage: inferred,
        rawIntent,
        variants,
        // Same as the mount path: hard reload resets selection. Live
        // back-nav reads the current `selectedVariantIds` from `prev`
        // (only refreshed by `nextAfterB`, never by loadCanvas).
        selectedVariantIds:
          prev.rawIntent === rawIntent ? prev.selectedVariantIds : [],
        contradictionCandidates: persisted,
        coreContradiction: core,
        selectedPath: path,
        // /state doesn't persist fusionVariant / fusionBanner (they live in
        // local component memory only — they're session-scoped, not
        // canvas-scoped, since /fuse is cheap and re-runnable via 重新融合).
        // Hard reload starts the user fresh in this respect.
        fusionVariant: null,
        fusionBanner: null,
        quickMode: rawIntent?.quick_mode ?? false,
        loading: false,
      }));
    } catch {
      setState((prev) => ({ ...prev, loading: false }));
    }
  }, [projectId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await loadCanvas();
      if (cancelled) return;
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, canvasVersion, loadCanvas]);

  // After a child calls a /regenerate/* endpoint (which mutates canvas
  // downstream), bump the version so loadCanvas re-runs and the parent's
  // DivergenceState catches up. The child stages own their own local state
  // for the immediate UI update; this callback just keeps the parent's
  // "what's saved on canvas" view consistent.
  const onCanvasMutated = useCallback(() => {
    setCanvasVersion((v) => v + 1);
  }, []);

  if (state.loading) {
    return <div className="p-6 text-on-surface-variant">加载中...</div>;
  }

  const completed = completedFor(state.maxReachedSubStage);

  // Quick mode → skip D, jump C → E directly. The check is repeated here so
  // jumping back from E still respects the saved flag.
  const onCComplete = (coreContradiction: CoreContradiction) =>
    setState((prev) => nextAfterC(prev, coreContradiction));

  const onEBack = () =>
    setState((prev) => ({
      ...prev,
      subStage: prev.quickMode ? "C" : "D",
    }));

  return (
    <div data-testid="creative-divergence-step" className="flex flex-col h-full">
      <div className="sticky top-0 z-10 bg-surface">
        <StepIndicator
          current={state.subStage}
          completed={completed}
          onJump={(s) => setState((prev) => ({ ...prev, subStage: s }))}
        />
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto">
        {state.subStage === "A" && (
          <S0AInputStep
            projectId={projectId}
            initial={state.rawIntent}
            onComplete={(rawIntent, fusionVariant, fusionBanner) =>
              setState((prev) =>
                nextAfterA(prev, rawIntent, fusionVariant, fusionBanner),
              )
            }
            onCanvasMutated={onCanvasMutated}
          />
        )}
        {state.subStage === "B" && (
          <>
            {/* /fuse failed in S0-A — banner signals "fusion was skipped due
                to error" (distinguishable from "fusion was disabled", which
                would render no card and no banner). */}
            {state.fusionBanner && (
              <div
                data-testid="fusion-banner"
                role="status"
                className="mx-6 mt-4 p-3 rounded bg-warning/10 border border-warning text-sm text-on-surface"
              >
                {state.fusionBanner}
              </div>
            )}
            <S0BMutationStep
              projectId={projectId}
              rawIntent={
                state.rawIntent ?? { prompt: "", genre_primary: "" }
              }
              initial={state.variants}
              selectedIds={state.selectedVariantIds}
              fusionVariant={state.fusionVariant}
              onComplete={(variants, selectedIds) =>
                setState((prev) => nextAfterB(prev, variants, selectedIds))
              }
              onBack={() =>
                setState((prev) => ({ ...prev, subStage: "A" }))
              }
              onCanvasMutated={onCanvasMutated}
            />
          </>
        )}
        {state.subStage === "C" && (
          <S0CContradictionStep
            projectId={projectId}
            variants={state.variants}
            initial={state.coreContradiction}
            initialCandidates={state.contradictionCandidates}
            onComplete={onCComplete}
            onBack={() =>
              setState((prev) => ({ ...prev, subStage: "B" }))
            }
            onCanvasMutated={onCanvasMutated}
          />
        )}
        {state.subStage === "D" && !state.quickMode && (
          <S0DWhatIfStep
            projectId={projectId}
            rootNode={buildRootNode(state.coreContradiction)}
            onComplete={(path) =>
              setState((prev) => nextAfterD(prev, path))
            }
            onBack={() =>
              setState((prev) => ({ ...prev, subStage: "C" }))
            }
            onCanvasMutated={onCanvasMutated}
          />
        )}
        {state.subStage === "E" && (
          <S0ECommitStep
            projectId={projectId}
            selectedPath={state.selectedPath}
            // S0E owns /commit; wizard-step advance is handled by the parent
            // wizard once the user clicks the modal footer's "下一步".
            onComplete={() => undefined}
            onBack={onEBack}
            onCanvasMutated={onCanvasMutated}
          />
        )}
      </div>
    </div>
  );
}