import { useCallback, useRef, useState, useEffect } from "react";
import S1InputStep from "./divergence_v2/S1InputStep";
import S2DecomposeStep from "./divergence_v2/S2DecomposeStep";
import { StepIndicator } from "./divergence_v2/StepIndicator";
import { RegenerateModal } from "@/components/shared/RegenerateModal";
import { useOptionalWizard } from "./WizardContext";
import { useB3Divergence } from "./divergence_v2/useB3Divergence";
import type { RawIntent, SubStage } from "./divergence_v2/types";

interface Props {
  projectId: string;
  // 2026-09-19:commit 落盘后由 parent 收到 committedAt 变化触发,跳到 wizard
  // step 2 世界观。这里保留 onAdvanceSuccess 钩子用于兼容调用方的语义 —
  // commit 成功后等价于「下一步 → 世界观」。
  onAdvanceSuccess?: () => void;
}

export default function CreativeDivergenceStep({
  projectId, onAdvanceSuccess,
}: Props) {
  const {
    state, projectGenre, runS1ToS2, savePrompt,
    decompose, commit, jumpToStage,
    followUp,
    pause, resume,
  } = useB3Divergence(projectId);

  const wizard = useOptionalWizard();

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

  const setNextHandlerRef = useRef(wizard?.setNextHandler);
  setNextHandlerRef.current = wizard?.setNextHandler;
  const setPrevHandlerRef = useRef(wizard?.setPrevHandler);
  setPrevHandlerRef.current = wizard?.setPrevHandler;
  const setRegenerateHandlerRef = useRef(wizard?.setRegenerateHandler);
  setRegenerateHandlerRef.current = wizard?.setRegenerateHandler;
  const setNextLoadingClickHandlerRef = useRef(wizard?.setNextLoadingClickHandler);
  setNextLoadingClickHandlerRef.current = wizard?.setNextLoadingClickHandler;

  const togglePause = useCallback(() => {
    if (state.paused) resume();
    else pause();
  }, [state.paused, pause, resume]);

  // 2026-09-19:commit 成功后,parent 收到 committedAt 跳到 wizard step 2。
  // 这里把 wizard.markStepGenerated(1, {}) + wizard.jumpToStep(2) 集成到
  // 一个监听 effect — commit SUCCESS → state.committedAt 更新 → 触发跳转。
  //
  // 2026-09-22 修 proj_47738f64 案例:用户已在 step 3,左侧点「创意发散」
  // 回跳 step 1 时,CreativeDivergenceStep 会重新 mount,useB3Divergence
  // HYDRATE 把磁盘里已存的 committed_at(2026-09-20T03:44:23...)加载进
  // state.committedAt,旧实现把这次磁盘加载误判为"刚 commit"立即跳回 step 2。
  // 修复:用 nextClickedRef 区分两种来源 ——
  //   • HYDRATE:disk 加载,用户没点 Next → nextClickedRef=false → 不动
  //   • 用户点 Next → commit() → COMMIT_SUCCESS → 跳 step 2
  // 早先用 state.inflightStage 区分但不可靠:COMMIT_START 与 COMMIT_SUCCESS
  // 在 commit() 同一个 microtask 里 dispatch,React 18 会批处理,effect 只能
  // 看到最终态。
  const lastCommittedAtRef = useRef<string | null>(null);
  const nextClickedRef = useRef(false);
  useEffect(() => {
    if (
      state.committedAt &&
      state.committedAt !== lastCommittedAtRef.current
    ) {
      lastCommittedAtRef.current = state.committedAt;
      if (nextClickedRef.current && wizard) {
        nextClickedRef.current = false;
        wizard.markStepGenerated(1, {});
        wizard.jumpToStep(2);
        onAdvanceSuccess?.();
      }
    }
  }, [state.committedAt, wizard, onAdvanceSuccess]);

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
    // S2 step back to S1 via jumpToStage.
    if (sub === "1") {
      setPrev(null);
    } else if (sub === "2") {
      setPrev(() => jumpToStage("1"));
    }

    // ── Regenerate handler ──────────────────────────────────────────
    // S2 opens a RegenerateModal for modification suggestions; the actual
    // decompose call (with user_modifications) is dispatched from the
    // modal's onConfirm below. S3/S4 砍了 — S2 regen 之外没有其它 regenerate
    // 入口(拆解的 regenerate 复用 S2 自带的 re-run /decompose 流程)。
    if (setRegen) {
      if (sub === "2" && state.rawIntent) {
        setRegen(() => { setRegenModalOpen(true); }, state.loading);
      } else {
        setRegen(null, false);
      }
    }

    // ── Next handler + label/loading label ──────────────────────────
    // 2026-09-19 砍掉 S3/S4:Next handler 改为直接调 commit(零 LLM 合成),
    // 完成后由上面的 committedAt effect 跳到 wizard step 2 世界观。
    // loading label 仍然反映实际 inflight 操作("拆解中…" / "提交中…")—
    // 暂停时显示"已暂停"。
    const loadingLabel = state.paused
      ? "已暂停"
      : state.metaLoading
        ? "生成专用提示词中…"
        : state.inflightStage === "2"
          ? "拆解中…"
          : null;

    if (setNextLoadingClick && loadingLabel !== null) {
      setNextLoadingClick(() => togglePause());
    } else {
      setNextLoadingClick?.(null);
    }

    if (sub === "1") {
      const disabled = !s1Ready.valid || state.loading;
      setNext(
        s1Ready.handler ?? (() => {}),
        disabled,
        "下一步:拆解 →",
        null,
      );
    } else if (sub === "2") {
      const disabled = state.loading || state.paused;
      setNext(
        () => {
          // 2026-09-22 proj_47738f64:在 commit() 之前同步置位 nextClickedRef,
          // 上面的 committedAt effect 看到 true 才会跳 step 2。否则 HYDRATE
          // 把磁盘里已有的 committed_at 加载进来时也会触发同样的 effect。
          nextClickedRef.current = true;
          void commit();
        },
        disabled,
        "下一步:进入世界观 →",
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
  }, [
    state.currentSubStage, state.loading, state.metaLoading,
    state.rawIntent, state.paused, s1Ready.handler, s1Ready.valid,
    commit, jumpToStage, togglePause,
  ]);

  // 进入 S2 时若 dimensions 为空自动跑 decompose
  // Round 7 (2026-09-12): also guard on !state.metaLoading so the auto-
  // decompose doesn't race with the S1→S2 two-stage runS1ToS2 (meta →
  // decompose) flow. Without this, the auto-decompose could fire while
  // meta is still in flight, leading to a duplicate /decompose call.
  //
  // 2026-09-18: track the last rawIntent we've auto-decomposed with via a
  // ref. Without this, the effect would re-fire whenever state.dimensions
  // becomes empty after the fact. Manual regenerate via the footer regen
  // modal still works because it calls decompose() directly without going
  // through this effect.
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

  const handleS1Submit = useCallback((intent: RawIntent) => {
    jumpToStage("2");
    runS1ToS2(intent);
  }, [jumpToStage, runS1ToS2]);

  return (
    <div data-testid="creative-divergence-step" className="flex flex-col flex-1 min-h-0">
      <StepIndicator current={state.currentSubStage} completed={state.completedSubStages} onStageClick={jumpToStage} />

      <div className="flex-1 flex flex-col px-6 py-4 gap-4 min-h-0">
        {state.error && (
          <div className="p-3 bg-error-container/20 border border-error rounded-lg text-sm">
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
      </div>

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