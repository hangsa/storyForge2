import { useState, useEffect } from "react";
import S1InputStep from "./divergence_v2/S1InputStep";
import S2DecomposeStep from "./divergence_v2/S2DecomposeStep";
import S3DivergeStep from "./divergence_v2/S3DivergeStep";
import S4CommitStep from "./divergence_v2/S4CommitStep";
import { StepIndicator } from "./divergence_v2/StepIndicator";
import { ConfirmNextDialog } from "./divergence_v2/ConfirmNextDialog";
import { GhostButton } from "@/components/ds";
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
    state, decompose, followUp, diverge, regenerateUnit, selectCandidate,
    commit, editConcept, advance, jumpToStage, reset,
  } = useThreeBDivergence(projectId);

  const [confirmNext, setConfirmNext] = useState<{ target: SubStage; affected: SubStage[] } | null>(null);
  const [showUpgradeToast, setShowUpgradeToast] = useState(false);

  // v1 升级后空态 toast(组件级,首次进入时检查)
  useEffect(() => {
    if (state.rawIntent === null && state.dimensions.length === 0 && state.completedSubStages.length === 0) {
      setShowUpgradeToast(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  function handleS1Submit(intent: RawIntent) {
    jumpToStage("2");
    decompose(intent);
  }

  return (
    <div data-testid="creative-divergence-step" className="flex flex-col flex-1 min-h-0">
      <StepIndicator current={state.currentSubStage} completed={state.completedSubStages} onStageClick={jumpToStage} />

      {showUpgradeToast && (
        <div className="bg-warning-container/20 border border-warning rounded-lg px-3 py-2 text-sm text-warning" data-testid="upgrade-toast">
          创意发散已升级到 4 阶段流程,旧版本已清除
        </div>
      )}

      <div className="flex-1 flex flex-col px-6 py-4 gap-4 min-h-0">
        {state.error && (
          <div className="p-3 bg-error-container/20 border border-error rounded-lg text-error text-sm">
            {state.error}
            <button type="button" className="ml-2 underline" onClick={() => location.reload()}>重试</button>
          </div>
        )}

        {state.currentSubStage === "1" && (
          <S1InputStep projectId={projectId} initial={state.rawIntent} onSubmitted={handleS1Submit} />
        )}

        {state.currentSubStage === "2" && (
          <S2DecomposeStep
            dimensions={state.dimensions}
            causalMap={state.causalMap}
            topLevelSummary={state.topLevelSummary}
            loading={state.loading}
            followUpLoadingUnitId={state.followUpLoadingUnitId}
            onFollowUp={followUp}
            onPrev={() => jumpToStage("1")}
            onNext={() => requestNext("3")}
          />
        )}

        {state.currentSubStage === "3" && (
          <S3DivergeStep
            dimensions={state.dimensions}
            loading={state.loading}
            onRegenerateUnit={regenerateUnit}
            onSelectCandidate={selectCandidate}
            onRegenerateAll={diverge}
            onPrev={() => jumpToStage("2")}
            onNext={() => requestNext("4")}
          />
        )}

        {state.currentSubStage === "4" && (
          <S4CommitStep
            committedConcept={state.committedConcept}
            noveltyScores={state.noveltyScores}
            loading={state.loading}
            onEditConcept={editConcept}
            onRegenerateCommit={commit}
            onRegenerateAllDivergence={() => { jumpToStage("3"); diverge(); }}
            onAdvance={async () => {
              await advance();
              onAdvanceSuccess?.();
            }}
          />
        )}

        {(state.currentSubStage === "2" || state.currentSubStage === "3") && (
          <div className="flex justify-start">
            <GhostButton label="重新输入" size="sm" onClick={async () => { await reset(); jumpToStage("1"); }} />
          </div>
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
