import { useCallback, useRef, useState, useEffect } from "react";
import S1InputStep from "./divergence_v2/S1InputStep";
import S2DecomposeStep from "./divergence_v2/S2DecomposeStep";
import S3DivergeStep from "./divergence_v2/S3DivergeStep";
import S4CommitStep from "./divergence_v2/S4CommitStep";
import { StepIndicator } from "./divergence_v2/StepIndicator";
import { ConfirmNextDialog } from "./divergence_v2/ConfirmNextDialog";
import { useOptionalWizard } from "./WizardContext";
import { hasDownstreamData, useThreeBDivergence } from "./divergence_v2/useThreeBDivergence";
import type { RawIntent, SubStage } from "./divergence_v2/types";

interface Props {
  projectId: string;
  onAdvanceSuccess?: () => void;
}

export default function CreativeDivergenceStep({
  projectId, onAdvanceSuccess,
}: Props) {
  const {
    state, projectGenre, decompose, diverge, regenerateUnit, selectCandidate,
    commit, editConcept, advance, jumpToStage,
  } = useThreeBDivergence(projectId);

  const wizard = useOptionalWizard();

  const [confirmNext, setConfirmNext] = useState<{ target: SubStage; affected: SubStage[] } | null>(null);

  // S1 (灵感输入) submits via the page-level wizard footer, not an in-stage
  // button — see S1InputStep's onSubmitReady. We track the latest handler
  // + validity here so we can re-register with the wizard context as form
  // state changes.
  const [s1Ready, setS1Ready] = useState<{ handler: (() => void) | null; valid: boolean }>({
    handler: null,
    valid: false,
  });
  const handleS1Ready = useCallback((handler: (() => void) | null, valid: boolean) => {
    setS1Ready({ handler, valid });
  }, []);

  // Register the current sub-stage's "next" / "prev" handlers with the wizard
  // footer. All four sub-stages now drive navigation through the page-level
  // footer (no internal footers in S2/S3/S4). The wizard is optional — when
  // no provider is present (tests, isolated renders) we silently no-op.
  //
  // NOTE: WizardContext's `value` object is reconstructed on every render
  // (no useMemo), so we cannot put `wizard` itself in the dep array — that
  // would fire the effect every render and re-dispatch setNextHandler,
  // causing an infinite loop. Instead we hold refs to the latest setters
  // and depend on the *values* we actually care about (currentSubStage,
  // valid, loading, committedConcept).
  const setNextHandlerRef = useRef(wizard?.setNextHandler);
  setNextHandlerRef.current = wizard?.setNextHandler;
  const setPrevHandlerRef = useRef(wizard?.setPrevHandler);
  setPrevHandlerRef.current = wizard?.setPrevHandler;
  const setRegenerateHandlerRef = useRef(wizard?.setRegenerateHandler);
  setRegenerateHandlerRef.current = wizard?.setRegenerateHandler;

  useEffect(() => {
    const setNext = setNextHandlerRef.current;
    const setPrev = setPrevHandlerRef.current;
    const setRegen = setRegenerateHandlerRef.current;
    if (!setNext || !setPrev) return;

    const sub = state.currentSubStage;

    // ── Prev handler ────────────────────────────────────────────────
    // S1 has no previous sub-stage; the wizard footer's 上一步 button
    // disables (currentStep === 1 && prevHandler === null).
    // S2/S3/S4 step back to the previous sub-stage via jumpToStage.
    if (sub === "1") {
      setPrev(null);
    } else if (sub === "2") {
      setPrev(() => jumpToStage("1"));
    } else if (sub === "3") {
      setPrev(() => jumpToStage("2"));
    } else if (sub === "4") {
      setPrev(() => jumpToStage("3"));
    }

    // ── Regenerate handler ──────────────────────────────────────────
    // S2 re-runs /decompose with the current raw intent. S3 re-runs
    // /diverge (the bulk "全部重新生成" button moved to the footer on
    // 2026-09-08 as a sibling of "下一步:提交 →"). S4 keeps its in-stage
    // 「重新生成」 + 「全部重新生成」 buttons, so the footer slot stays
    // clear there to avoid two "重新生成" buttons on one screen.
    if (setRegen) {
      if (sub === "2" && state.rawIntent) {
        setRegen(() => { decompose(state.rawIntent!); }, state.loading);
      } else if (sub === "3") {
        setRegen(() => { diverge(); }, state.loading);
      } else {
        setRegen(null, false);
      }
    }

    // ── Next handler + label/loading label ──────────────────────────
    if (sub === "1") {
      const disabled = !s1Ready.valid || state.loading;
      // Always register a function (no-op fallback when form is invalid)
      // so the wizard footer button stays visible — just disabled. S1 has
      // no internal save button, so this footer button is the user's only
      // forward path; passing null here would hide it entirely on an empty
      // form and strand the user.
      setNext(
        s1Ready.handler ?? (() => {}),
        disabled,
        "下一步:拆解 →",
        null,
      );
    } else if (sub === "2") {
      const disabled = state.loading;
      setNext(
        () => requestNext("3"),
        disabled,
        "下一步:发散 →",
        "拆解中…",
      );
    } else if (sub === "3") {
      const disabled = state.loading;
      setNext(
        () => requestNext("4"),
        disabled,
        "下一步:提交 →",
        "发散中…",
      );
    } else if (sub === "4") {
      // S4: empty-state (committedConcept === null) and committed-state both
      // call onAdvance. The footer button is the user's only path forward.
      const disabled = state.loading;
      setNext(
        () => { void advance(); },
        disabled,
        "下一步:进入概念DNA →",
        "提交中…",
      );
    }

    return () => {
      setNext(null, false);
      setPrev(null);
      setRegen?.(null, false);
    };
    // requestNext / jumpToStage / advance are stable from useThreeBDivergence
    // (useCallback), so we don't need to list them. The shape of the
    // registration changes per sub-stage; we re-run the effect whenever the
    // relevant inputs change.
  }, [state.currentSubStage, state.loading, state.committedConcept, state.rawIntent, s1Ready.handler, s1Ready.valid]);

  // 进入 S2 时若 dimensions 为空自动跑 decompose
  useEffect(() => {
    if (state.currentSubStage === "2" && state.dimensions.length === 0 && state.rawIntent && !state.loading) {
      decompose(state.rawIntent);
    }
  }, [state.currentSubStage, state.dimensions.length, state.rawIntent, state.loading, decompose]);

  // 「下一步」按钮触发 REQUEST_NEXT:检查下游,有则 dialog
  function requestNext(target: SubStage) {
    if (hasDownstreamData(state, target)) {
      const affected: SubStage[] = [];
      if (target === "2") affected.push("2", "3", "4");
      else if (target === "3") affected.push("3", "4");
      else if (target === "4") affected.push("4");
      setConfirmNext({ target, affected });
    } else {
      jumpToStage(target);
      if (target === "3") diverge();
      if (target === "4" && state.committedConcept === null) commit();
    }
  }

  function confirmAndExecute() {
    if (!confirmNext) return;
    const target = confirmNext.target;
    setConfirmNext(null);
    jumpToStage(target);
    if (target === "2") {
      if (state.rawIntent) decompose(state.rawIntent);
    } else if (target === "3") {
      diverge();
    } else if (target === "4") {
      commit();
    }
  }

  const handleS1Submit = useCallback((intent: RawIntent) => {
    jumpToStage("2");
    decompose(intent);
  }, [jumpToStage, decompose]);

  return (
    <div data-testid="creative-divergence-step" className="flex flex-col flex-1 min-h-0">
      <StepIndicator current={state.currentSubStage} completed={state.completedSubStages} onStageClick={jumpToStage} />

      <div className="flex-1 flex flex-col px-6 py-4 gap-4 min-h-0">
        {state.error && (
          <div className="p-3 bg-error-container/20 border border-error rounded-lg text-error text-sm">
            {state.error}
            <button type="button" className="ml-2 underline" onClick={() => location.reload()}>重试</button>
          </div>
        )}

        {state.currentSubStage === "1" && (
          <S1InputStep
            projectId={projectId}
            initial={state.rawIntent}
            defaultGenre={projectGenre || undefined}
            onSubmitted={handleS1Submit}
            onSubmitReady={handleS1Ready}
          />
        )}

        {state.currentSubStage === "2" && (
          <S2DecomposeStep
            dimensions={state.dimensions}
            topLevelSummary={state.topLevelSummary}
          />
        )}

        {state.currentSubStage === "3" && (
          <S3DivergeStep
            dimensions={state.dimensions}
            loading={state.loading}
            onRegenerateUnit={regenerateUnit}
            onSelectCandidate={selectCandidate}
          />
        )}

        {state.currentSubStage === "4" && (
          <S4CommitStep
            committedConcept={state.committedConcept}
            noveltyScores={state.noveltyScores}
            onEditConcept={editConcept}
            onRegenerateCommit={commit}
            onRegenerateAllDivergence={() => { jumpToStage("3"); diverge(); }}
            onAdvance={async () => {
              await advance();
              onAdvanceSuccess?.();
            }}
          />
        )}

      </div>

      <ConfirmNextDialog
        open={confirmNext !== null}
        targetStage={confirmNext?.target ?? null}
        affectedStages={confirmNext?.affected ?? []}
        onConfirm={confirmAndExecute}
        onCancel={() => setConfirmNext(null)}
      />
    </div>
  );
}
