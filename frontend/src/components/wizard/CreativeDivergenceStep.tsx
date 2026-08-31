import { useEffect, useState } from "react";
import api, {
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

interface DivergenceState {
  subStage: SubStage;
  rawIntent: RawIntent | null;
  variants: IdeaVariant[];
  coreContradiction: CoreContradiction | null;
  selectedPath: string[];
  quickMode: boolean;
  loading: boolean;
}

const INITIAL: DivergenceState = {
  subStage: "A",
  rawIntent: null,
  variants: [],
  coreContradiction: null,
  selectedPath: [],
  quickMode: false,
  loading: true,
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
//   A → rawIntent         clears {variants, coreContradiction, selectedPath}
//   B → variants          clears {coreContradiction, selectedPath}
//   C → coreContradiction clears {selectedPath}
//   D → selectedPath      no-op (last producing stage)
//   E → terminal          not applicable
//
// SubStage ordering for compare: A < B < C < D < E.
const SUB_STAGE_ORDER: SubStage[] = ["A", "B", "C", "D", "E"];

export function clearedDownstream(
  prev: DivergenceState,
  current: SubStage,
): Partial<DivergenceState> {
  const idx = SUB_STAGE_ORDER.indexOf(current);
  if (idx < 0) return {};
  const cleared: Partial<DivergenceState> = {};
  // We clear all fields owned by a later sub-stage, except `quickMode`
  // (a sticky preference that survives edits) and `loading` / `subStage`
  // (managed by the calling onComplete callbacks).
  for (let later = idx + 1; later < SUB_STAGE_ORDER.length; later++) {
    const laterStage = SUB_STAGE_ORDER[later];
    if (laterStage === "B") cleared.variants = [];
    else if (laterStage === "C") cleared.coreContradiction = null;
    else if (laterStage === "D") cleared.selectedPath = [];
    // E is terminal and owns no DivergenceState field.
  }
  return cleared;
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

// SubStage A is always "fresh"; everything before the user's current stage
// has been completed and is therefore clickable from StepIndicator.
function completedFor(subStage: SubStage): SubStage[] {
  if (subStage === "A") return [];
  if (subStage === "B") return ["A"];
  if (subStage === "C") return ["A", "B"];
  if (subStage === "D") return ["A", "B", "C"];
  return ["A", "B", "C", "D"];
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

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await api.getDivergeState(projectId);
        if (cancelled) return;
        const rawIntent = response?.raw_intent ?? null;
        const variants = response?.idea_variants ?? [];
        const core = response?.core_contradiction ?? null;
        const path = response?.selected_path ?? [];
        setState({
          subStage: inferSubStage({
            raw_intent: rawIntent,
            idea_variants: variants,
            core_contradiction: core,
            selected_path: path,
          }),
          rawIntent,
          variants,
          coreContradiction: core,
          selectedPath: path,
          quickMode: rawIntent?.quick_mode ?? false,
          loading: false,
        });
      } catch {
        if (!cancelled) setState({ ...INITIAL, loading: false });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  if (state.loading) {
    return <div className="p-6 text-on-surface-variant">加载中...</div>;
  }

  const completed = completedFor(state.subStage);
  const showContinueBanner = !!state.rawIntent && state.subStage !== "A";

  // Quick mode → skip D, jump C → E directly. The check is repeated here so
  // jumping back from E still respects the saved flag.
  const onCComplete = (coreContradiction: CoreContradiction) =>
    setState((prev) => ({
      ...prev,
      ...clearedDownstream(prev, "C"),
      coreContradiction,
      subStage: prev.quickMode ? "E" : "D",
    }));

  const onEBack = () =>
    setState((prev) => ({
      ...prev,
      subStage: prev.quickMode ? "C" : "D",
    }));

  return (
    <div data-testid="creative-divergence-step" className="flex flex-col h-full">
      <StepIndicator
        current={state.subStage}
        completed={completed}
        onJump={(s) => setState((prev) => ({ ...prev, subStage: s }))}
      />
      {showContinueBanner && (
        <div
          data-testid="continue-banner"
          className="bg-tertiary-container text-on-tertiary-container px-4 py-2 text-sm"
        >
          检测到草稿,继续从 {state.subStage} 开始。
        </div>
      )}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {state.subStage === "A" && (
          <S0AInputStep
            projectId={projectId}
            initial={state.rawIntent}
            onComplete={(rawIntent) =>
              setState((prev) => ({
                ...prev,
                ...clearedDownstream(prev, "A"),
                rawIntent,
                subStage: "B",
              }))
            }
          />
        )}
        {state.subStage === "B" && (
          <S0BMutationStep
            projectId={projectId}
            rawIntent={
              state.rawIntent ?? { prompt: "", genre_primary: "" }
            }
            initial={state.variants}
            onComplete={(variants) =>
              setState((prev) => ({
                ...prev,
                ...clearedDownstream(prev, "B"),
                variants,
                subStage: "C",
              }))
            }
            onBack={() =>
              setState((prev) => ({ ...prev, subStage: "A" }))
            }
          />
        )}
        {state.subStage === "C" && (
          <S0CContradictionStep
            projectId={projectId}
            variants={state.variants}
            initial={state.coreContradiction}
            onComplete={onCComplete}
            onBack={() =>
              setState((prev) => ({ ...prev, subStage: "B" }))
            }
          />
        )}
        {state.subStage === "D" && !state.quickMode && (
          <S0DWhatIfStep
            projectId={projectId}
            rootNode={buildRootNode(state.coreContradiction)}
            onComplete={(path) =>
              setState((prev) => ({
                ...prev,
                ...clearedDownstream(prev, "D"),
                selectedPath: path,
                subStage: "E",
              }))
            }
            onBack={() =>
              setState((prev) => ({ ...prev, subStage: "C" }))
            }
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
          />
        )}
      </div>
    </div>
  );
}