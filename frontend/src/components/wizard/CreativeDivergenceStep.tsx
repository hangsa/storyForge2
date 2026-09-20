import { useCallback, useRef, useState, useEffect } from "react";
import S1InputStep from "./divergence_v2/S1InputStep";
import S2DecomposeStep from "./divergence_v2/S2DecomposeStep";
import S3DivergeStep from "./divergence_v2/S3DivergeStep";
import S4CommitStep from "./divergence_v2/S4CommitStep";
import { StepIndicator } from "./divergence_v2/StepIndicator";
import { ConfirmNextDialog } from "./divergence_v2/ConfirmNextDialog";
import { RegenerateModal } from "@/components/shared/RegenerateModal";
import { useOptionalWizard } from "./WizardContext";
import { hasDownstreamData, useB3Divergence } from "./divergence_v2/useB3Divergence";
import type { RawIntent, SubStage } from "./divergence_v2/types";

interface Props {
  projectId: string;
  onAdvanceSuccess?: () => void;
}

export default function CreativeDivergenceStep({
  projectId, onAdvanceSuccess,
}: Props) {
  const {
    state, projectGenre, runS1ToS2, savePrompt,
    decompose, diverge, regenerateUnit, selectCandidate,
    commit, editConcept, advance, jumpToStage,
    followUp,
    pause, resume,
  } = useB3Divergence(projectId);

  const wizard = useOptionalWizard();

  const [confirmNext, setConfirmNext] = useState<{ target: SubStage; affected: SubStage[] } | null>(null);

  // S2 footer 「重新生成」 opens a modal for modification suggestions before
  // re-running /decompose (Round 2 — item 3 of the v2 wizard 6-item
  // optimization). Previously the handler fired decompose() directly and
  // bypassed user_modifications, so the user couldn't attach feedback.
  const [regenModalOpen, setRegenModalOpen] = useState(false);

  // S1 (灵感) submits via the page-level wizard footer, not an in-stage
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
  const setNextLoadingClickHandlerRef = useRef(wizard?.setNextLoadingClickHandler);
  setNextLoadingClickHandlerRef.current = wizard?.setNextLoadingClickHandler;

  // Pause/resume toggle wired onto the footer loading label. Reads the
  // freshest state.paused via the effect's dep array — every time the
  // reducer flips paused, the effect re-registers a fresh togglePause
  // closure with the up-to-date value.
  const togglePause = useCallback(() => {
    if (state.paused) resume();
    else pause();
  }, [state.paused, pause, resume]);

  useEffect(() => {
    const setNext = setNextHandlerRef.current;
    const setPrev = setPrevHandlerRef.current;
    const setRegen = setRegenerateHandlerRef.current;
    const setNextLoadingClick = setNextLoadingClickHandlerRef.current;
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
    // S2 opens a RegenerateModal for modification suggestions; the actual
    // decompose call (with user_modifications) is dispatched from the
    // modal's onConfirm below. S3 re-runs /diverge directly (the bulk
    // "全部重新生成" button moved to the footer on 2026-09-08 as a sibling
    // of "下一步:提交 →"). S4 keeps its in-stage 「重新生成」 + 「全部重新
    // 生成」 buttons, so the footer slot stays clear there to avoid two
    // "重新生成" buttons on one screen.
    if (setRegen) {
      if (sub === "2" && state.rawIntent) {
        setRegen(() => { setRegenModalOpen(true); }, state.loading);
      } else if (sub === "3") {
        setRegen(() => { diverge(); }, state.loading);
      } else {
        setRegen(null, false);
      }
    }

    // ── Next handler + label/loading label ──────────────────────────
    // The loading label reflects the *actual* inflight operation, not the
    // currently-visible sub-stage. This is the fix for the user-reported
    // "S3 → S2 back-nav during in-flight /diverge shows '拆解中…'" bug —
    // the API call in flight is /diverge (S3) even though the user landed
    // back at S2, so the footer should say "发散中…" instead of "拆解中…".
    // metaLoading is checked first because it overlays the meta-prompt
    // generation phase which is conceptually part of /decompose but
    // warrants a distinct label. When nothing is in flight
    // (inflightStage === null AND metaLoading === false) the label is
    // null — previously we fell back to the current sub-stage's static
    // label, but with the new cancel-on-navigate-away behavior the user
    // explicitly expects "no loading text" once they've aborted (Round 2
    // fix, 2026-09-18).
    //
    // state.paused takes precedence over metaLoading/inflightStage because
    // the PAUSE reducer has already cleared those fields; checking them
    // first would yield null instead of "已暂停" — leaving the button label
    // stuck on "下一步:发散 →" while the user is paused mid-operation.
    const loadingLabel = state.paused
      ? "已暂停"
      : state.metaLoading
        ? "生成专用提示词中…"
        : state.inflightStage === "2"
          ? "拆解中…"
          : state.inflightStage === "3"
            ? "发散中…"
            : state.inflightStage === "4"
              ? "提交中…"
              : null;

    // Wire the loading label itself as a pause/resume toggle. While
    // loadingLabel is showing, the footer next button stays clickable and
    // routes clicks here instead of advancing — WorkspaceWizardPanel/Init
    // WizardModal use `nextLoadingClickHandler ?? nextHandler` in onClick
    // and `nextDisabled && !nextLoadingClickHandler` for the disabled
    // attr, so the user gets one button that doubles as "下一步" (when
    // idle) and "暂停 / 继续" (while running / paused).
    if (setNextLoadingClick && loadingLabel !== null) {
      setNextLoadingClick(() => togglePause());
    } else {
      setNextLoadingClick?.(null);
    }

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
      // Include state.paused so the visible label flips to "已暂停"
      // (footer button renders nextLoadingLabel only when nextDisabled=true).
      // Otherwise paused mid-decompose would still display "下一步:发散 →"
      // because state.loading is cleared by the PAUSE reducer.
      const disabled = state.loading || state.paused;
      setNext(
        () => requestNext("3"),
        disabled,
        "下一步:发散 →",
        loadingLabel,
      );
    } else if (sub === "3") {
      const disabled = state.loading || state.paused;
      setNext(
        () => requestNext("4"),
        disabled,
        "下一步:提交 →",
        loadingLabel,
      );
    } else if (sub === "4") {
      // S4: empty-state (committedConcept === null) and committed-state both
      // call onAdvance. The footer button is the user's only path forward.
      const disabled = state.loading || state.paused;
      setNext(
        () => { void advance(); },
        disabled,
        "下一步:进入概念DNA →",
        loadingLabel,
      );
    }

    return () => {
      setNext(null, false);
      setPrev(null);
      setRegen?.(null, false);
      setNextLoadingClick?.(null);
      setRegenModalOpen(false);
    };
    // requestNext / jumpToStage / advance are stable from useB3Divergence
    // (useCallback), so we don't need to list them. The shape of the
    // registration changes per sub-stage; we re-run the effect whenever the
    // relevant inputs change. togglePause is intentionally NOT in deps —
    // it's rebuilt whenever state.paused changes (via the useCallback's own
    // dep on state.paused), and listing it here would cause an extra
    // re-run on every paused-flip without changing behavior.
  }, [state.currentSubStage, state.loading, state.metaLoading, state.committedConcept, state.rawIntent, state.paused, s1Ready.handler, s1Ready.valid]);

  // 进入 S2 时若 dimensions 为空自动跑 decompose
  // Round 7 (2026-09-12): also guard on !state.metaLoading so the auto-
  // decompose doesn't race with the S1→S2 two-stage runS1ToS2 (meta →
  // decompose) flow. Without this, the auto-decompose could fire while
  // meta is still in flight, leading to a duplicate /decompose call.
  //
  // 2026-09-18: track the last rawIntent we've auto-decomposed with via a
  // ref. Without this, the effect would re-fire whenever state.dimensions
  // becomes empty after the fact — e.g. /diverge returns a malformed payload
  // (all units fail) and the reducer coerces dimensions to [], then the user
  // clicks 上一步 from S3 → S2. The guard `dimensions.length === 0` alone
  // can't distinguish "never decomposed" from "decomposed and then cleared",
  // so we use the ref to remember which rawIntent we've already auto-fired
  // for. Manual regenerate via the footer regen modal still works because
  // it calls decompose() directly without going through this effect.
  const lastAutoDecomposedRawIntentRef = useRef<RawIntent | null>(null);
  useEffect(() => {
    if (
      state.currentSubStage === "2" &&
      state.dimensions.length === 0 &&
      state.rawIntent &&
      !state.loading &&
      !state.metaLoading &&
      lastAutoDecomposedRawIntentRef.current !== state.rawIntent
    ) {
      lastAutoDecomposedRawIntentRef.current = state.rawIntent;
      decompose(state.rawIntent);
    }
  }, [state.currentSubStage, state.dimensions.length, state.rawIntent, state.loading, state.metaLoading, decompose]);

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
    runS1ToS2(intent);
  }, [jumpToStage, runS1ToS2]);

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
            decomposePrompt={state.decomposePrompt}
            promptBusy={state.promptBusy}
            onSavePrompt={savePrompt}
            followUpLoadingUnitId={state.followUpLoadingUnitId}
            onFollowUp={followUp}
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

      <RegenerateModal
        open={regenModalOpen && state.currentSubStage === "2"}
        target="拆解"
        busy={state.loading}
        onConfirm={(text) => {
          if (!state.rawIntent) return;
          decompose(state.rawIntent, text);
          setRegenModalOpen(false);
        }}
        onCancel={() => setRegenModalOpen(false)}
      />
    </div>
  );
}
