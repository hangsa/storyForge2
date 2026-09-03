import { useParams } from "react-router-dom";
import { useCreativeCanvasV2 } from "@/hooks/useCreativeCanvasV2";
import { TreeCanvas } from "@/components/creative-canvas/TreeCanvas";
import { StepIndicator } from "@/components/creative-canvas/StepIndicator";
import { OptionCard } from "@/components/creative-canvas/OptionCard";
import { EmptyState } from "@/components/creative-canvas/EmptyState";
import { ResetConfirmDialog } from "@/components/creative-canvas/ResetConfirmDialog";
import { PreCommitSummary } from "@/components/creative-canvas/PreCommitSummary";
import { GhostButton, PrimaryButton } from "@/components/ds";
import type { CreativeOption } from "@/api/client";

// Map of v2 operation keys → display labels (zh). Mirrors StepIndicator's
// OPERATION_LABELS so the OptionCard title prefix stays consistent with the
// header pill. The StepIndicator owns the full { zh, en } record; the page
// only needs the zh string for the title text.
const OPERATION_LABEL_ZH: Record<string, string> = {
  twist: "扭曲",
  break: "打破",
  fuse: "融合",
  fusion: "融合",
  invert: "反转",
  escalate: "升级",
  dramaturgy: "收束",
};

type Slot = "A" | "B" | "C";

export default function CreativeCanvasPage() {
  // Route is /project/:projectId/stage1/canvas (App.tsx:114)
  const { projectId = "" } = useParams<{ projectId: string }>();
  const {
    canvas, loadingStep, canCommit,
    showResetDialog, onReset, closeResetDialog, confirmReset,
    showPreCommit, onCommitClick, closePreCommit, confirmCommit,
    initSession, selectOption,
  } = useCreativeCanvasV2(projectId);

  // Empty state — no canvas yet. The EmptyState owns its own form controls
  // and gates initSession on prompt length (>=10 chars). EmptyState's
  // `onInit` callback signature is `(prompt, genre)`; map to RawIntent's
  // `genre_primary` field (the backend enum, e.g. "xianxia").
  if (!canvas) {
    return (
      <EmptyState
        loading={loadingStep}
        onInit={(prompt, genre) => {
          initSession({ prompt, genre_primary: genre }).catch(() => {
            // Hook already surfaces errors via its own error state; the
            // catch here only prevents an unhandled-rejection warning in
            // the console when the user retries after a malformed prompt.
          });
        }}
      />
    );
  }

  const activeStep = canvas.creative_path.find((s) => s.state === "active");
  const completedCount = canvas.creative_path.filter(
    (s) => s.state === "completed"
  ).length;

  // Header defaults to "twist" when no active step exists yet (committed or
  // pre-init states) so the pill stays populated.
  const headerOperation = activeStep?.operation ?? "twist";
  const opLabel =
    OPERATION_LABEL_ZH[headerOperation] ?? headerOperation;

  return (
    <div
      data-testid="creative-canvas-page"
      className="bg-surface-container-lowest min-h-screen p-6"
    >
      {/* Header: title left, StepIndicator right */}
      <div className="flex justify-between items-end mb-6">
        <div>
          <h2 className="text-headline-lg font-bold text-on-surface">
            Creative Canvas
          </h2>
          <p className="text-on-surface-variant text-sm">
            Explore and evolve your core concept.
          </p>
        </div>
        <StepIndicator
          currentStep={canvas.creative_session.current_step}
          maxSteps={canvas.creative_session.max_steps}
          operation={headerOperation}
        />
      </div>

      {/* Tree visualization */}
      <TreeCanvas canvas={canvas} />

      {/* Active step options — PRD §8: B is AI default (recommended). */}
      {activeStep && (
        <div className="mt-6" data-testid="active-step-panel">
          <div className="grid grid-cols-3 gap-6">
            {(["A", "B", "C"] as const).map((slot) => {
              // Option id format: opt_{step}_{slot} (backend renumbers the
              // LLM-produced opt_a/b/c → opt_{step}_a/b/c in v2_canvas.py).
              const option = activeStep.options.find(
                (o) => o.id === `opt_${activeStep.step}_${slot.toLowerCase()}`
              ) as CreativeOption | undefined;
              if (!option) return null;
              const isRecommended = slot === "B";
              return (
                <OptionCard
                  key={slot}
                  option={option}
                  slot={slot}
                  operationLabel={`${opLabel} ${slot}`}
                  recommended={isRecommended}
                  selected={false}
                  onSelect={(id) => {
                    selectOption(activeStep.step, id).catch(() => {});
                  }}
                  disabled={loadingStep}
                />
              );
            })}
          </div>
          <p className="text-on-surface-variant text-sm mt-4 text-center">
            为什么是「{activeStep.operation}」？{activeStep.operation_reason}
          </p>
        </div>
      )}

      {/* Bottom action bar — Reset on the left, Commit on the right (only
          when canCommit flips true after step 5 completes). */}
      <div className="mt-6 flex justify-between">
        <GhostButton
          label="重新开始"
          onClick={onReset}
          disabled={loadingStep}
        />
        <div className="flex gap-2">
          {canCommit && (
            <PrimaryButton
              label="提交"
              onClick={onCommitClick}
              disabled={loadingStep}
            />
          )}
        </div>
      </div>

      <ResetConfirmDialog
        open={showResetDialog}
        onConfirm={() => {
          confirmReset().catch(() => {});
        }}
        onCancel={closeResetDialog}
      />
      <PreCommitSummary
        open={showPreCommit}
        stats={{
          depth: completedCount,
          novelty: Math.round((canvas.scores?.novelty ?? 0) * 100),
          conflict: Math.round((canvas.scores?.conflict ?? 0) * 100),
        }}
        onCommit={() => {
          confirmCommit().catch(() => {});
        }}
        onCancel={closePreCommit}
      />
    </div>
  );
}