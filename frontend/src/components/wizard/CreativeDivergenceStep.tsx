import S1InputStep from "./divergence_v2/S1InputStep";
import S2DivergenceStep from "./divergence_v2/S2DivergenceStep";
import S3DeepenStep from "./divergence_v2/S3DeepenStep";
import StepIndicator from "./divergence_v2/StepIndicator";
import { useThreeBDivergence } from "./divergence_v2/useThreeBDivergence";
import { GhostButton } from "@/components/ds";
import type {
  Candidate,
  DivergeResponse,
  RawIntent,
} from "./divergence_v2/types";

interface Props {
  projectId: string;
  /**
   * Invoked once the 3B divergence commit resolves — i.e., S3DeepenStep's
   * commit button succeeded and the backend has stamped the canvas-side
   * 3B state. The wizard injects `markStep1SurfaceCompleted("divergence")`
   * via this prop, so this step stays wizard-decoupled (no useWizard import).
   */
  onCommitSuccess?: () => void;
}

export default function CreativeDivergenceStep({
  projectId,
  onCommitSuccess,
}: Props) {
  const {
    state,
    onDivergeSuccess,
    onDivergeError,
    regenerateOne,
    regenerateAll,
    deepenOne,
    commit: commitHook,
    jumpTo,
    reset,
    toggleSelect,
  } = useThreeBDivergence(projectId);

  const selectedCandidates: Candidate[] = state.stage3SelectedIds
    .map((id) => state.candidates.find((c) => c.id === id))
    .filter((c): c is Candidate => Boolean(c));

  // S1InputStep has already called api.postThreeBDiverge before invoking
  // this callback; we just thread the response into the reducer (which
  // moves the user to sub-stage 2 with the candidates loaded).
  function handleStage1Submit(intent: RawIntent, resp: DivergeResponse) {
    void intent;
    onDivergeSuccess(resp);
    jumpTo("2");
  }

  // Optional guard against accidental unused-var noise from onDivergeError.
  // The current S1 handles its own submit error UI, but we keep the hook
  // destructure entry referenced so future wiring doesn't trip eslint.
  void onDivergeError;

  return (
    <div data-testid="creative-divergence-step" className="flex flex-col flex-1 min-h-0">
      <StepIndicator
        current={state.currentSubStage}
        completed={state.completedSubStages}
        onJump={jumpTo}
      />

      <div className="flex-1 flex flex-col px-6 py-4 gap-4 min-h-0">
        {state.stage2Error && (
          <div className="p-4 bg-error-container/20 border border-error rounded-lg text-error font-body text-body-md text-sm">
            {state.stage2Error}
          </div>
        )}

        {state.currentSubStage === "1" && (
          <S1InputStep
            projectId={projectId}
            initial={state.rawIntent}
            onSubmitted={handleStage1Submit}
          />
        )}

        {state.currentSubStage === "2" && (
          <>
            {state.stage2Loading && (
              <div className="flex items-center gap-2 px-md py-2 rounded-lg bg-primary-container/15 text-primary-container text-body-md">
                <span className="material-symbols-outlined text-base animate-spin inline-block">
                  progress_activity
                </span>
                3 个算子并行发散中…
              </div>
            )}
            <S2DivergenceStep
              candidates={state.candidates}
              byOperator={state.byOperator}
              selectedIds={state.stage3SelectedIds}
              onToggleSelect={toggleSelect}
              onRegenerateOne={regenerateOne}
              onRegenerateAll={regenerateAll}
              onNext={() => jumpTo("3")}
            />
            <div className="flex justify-start">
              <GhostButton
                label="重新输入"
                size="sm"
                onClick={async () => {
                  await reset();
                  jumpTo("1");
                }}
              />
            </div>
          </>
        )}

        {state.currentSubStage === "3" && (
          <S3DeepenStep
            selectedCandidates={selectedCandidates}
            deepened={state.stage3Deepened}
            appliedOperators={state.stage3AppliedOperators}
            onAppliedOperatorChange={(id, op) => deepenOne(id, op)}
            projectId={projectId}
            onCommitSuccess={() => {
              void commitHook();
              onCommitSuccess?.();
            }}
          />
        )}
      </div>
    </div>
  );
}