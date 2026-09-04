import { useEffect } from "react";
import { useParams } from "react-router-dom";
import { usePlotCanvasV2 } from "@/hooks/usePlotCanvasV2";
import { useToast } from "@/hooks/useToast";
import { TreeCanvas } from "@/components/plot-canvas/TreeCanvas";
import { CanvasPreStepHint } from "@/components/plot-canvas/CanvasPreStepHint";
import { StepIndicator } from "@/components/plot-canvas/StepIndicator";
import { OptionCard } from "@/components/plot-canvas/OptionCard";
import { EmptyState } from "@/components/plot-canvas/EmptyState";
import { ResetConfirmDialog } from "@/components/plot-canvas/ResetConfirmDialog";
import { PreCommitSummary } from "@/components/plot-canvas/PreCommitSummary";
import { ScoresBar } from "@/components/plot-canvas/ScoresBar";
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

interface PlotCanvasPageProps {
  /**
   * Project identifier. In standalone mode this falls back to the
   * `:projectId` URL param (route: /project/:projectId/stage1/canvas,
   * App.tsx:114); in embedded mode the parent passes it explicitly so
   * the page can render outside a router (e.g., inside the wizard).
   * Explicit prop wins over URL param.
   */
  projectId?: string;
  /**
   * When true, render without the page-shell wrapper + title header —
   * the wizard provides its own chrome. Used by
   * CreativeCanvasMountPoint to drop the page into the wizard's main
   * area as-is.
   */
  embedded?: boolean;
  /**
   * Invoked once `confirmCommit` resolves successfully. The page
   * itself does not import WizardContext — the mount point
   * (CreativeCanvasMountPoint) wires this to
   * `markStep1SurfaceCompleted("canvas")`. Standalone mode ignores
   * this prop.
   */
  onCommitSuccess?: () => void;
}

export default function PlotCanvasPage({
  projectId: projectIdProp,
  embedded = false,
  onCommitSuccess,
}: PlotCanvasPageProps = {}) {
  // Route is /project/:projectId/stage1/canvas (App.tsx:114). Explicit
  // prop wins over URL param so embedded mode works without a router.
  const { projectId: projectIdParam = "" } = useParams<{ projectId: string }>();
  const projectId = projectIdProp ?? projectIdParam;
  const {
    canvas, loadingStep, canCommit, error,
    showResetDialog, onReset, closeResetDialog, confirmReset,
    showPreCommit, onCommitClick, closePreCommit, confirmCommit,
    initSession, selectOption, nextStep,
  } = usePlotCanvasV2(projectId);
  const { show: showToast } = useToast();

  // Surface hook errors (init/select/nextStep failures) as a toast. Before
  // this was added, the page's `.catch(() => {})` silently swallowed the
  // init failure when the v2 router wasn't mounted — user clicked 开始创意
  // 推演, saw nothing happen, and the canvas never transitioned out of
  // EmptyState. Now they at least get a red toast telling them why.
  useEffect(() => {
    if (error) {
      showToast(`画布操作失败：${error}`);
    }
  }, [error, showToast]);

  // Empty state — no canvas yet. The EmptyState owns its own form controls
  // and gates initSession on prompt length (>=10 chars). EmptyState's
  // `onInit` callback signature is `(prompt, genre)`; map to RawIntent's
  // `genre_primary` field (the backend enum, e.g. "xianxia").
  if (!canvas) {
    return embedded ? (
      <EmptyState
        loading={loadingStep}
        embedded={embedded}
        onInit={(prompt, genre) => {
          // The hook already surfaces failures via the `error` state, which
          // the useEffect above turns into a toast. The .catch here just
          // prevents an unhandled-rejection warning if the user retries
          // before the previous promise settled.
          initSession({ prompt, genre_primary: genre }).catch(() => {});
        }}
      />
    ) : (
      <div data-testid="plot-canvas-page" className="bg-surface-container-lowest min-h-screen p-6">
        <EmptyState
          loading={loadingStep}
          embedded={embedded}
          onInit={(prompt, genre) => {
            // Same rationale as the embedded branch above — silent catch,
            // surface via toast (see useEffect on `error`).
            initSession({ prompt, genre_primary: genre }).catch(() => {});
          }}
        />
      </div>
    );
  }

  // Guard against a backend response where creative_path is missing or
  // not yet an array (e.g., mid-migration, manual disk edit, schema
  // drift) — the TypeScript type lies about runtime safety. Treating it
  // as [] lets the user keep the canvas on disk and re-trigger init via
  // the wizard's reset flow, instead of crashing the render tree.
  const cpath = Array.isArray(canvas.creative_path) ? canvas.creative_path : [];
  const activeStep = cpath.find((s) => s?.state === "active");
  const completedCount = cpath.filter((s) => s?.state === "completed").length;

  // Spec §3.2/§3.3 (2026-09-04-canvas-init-next-step-design.md):
  // After /init, Step 1 lands in state="available" with empty options
  // (v2_canvas.py:271). The user needs two affordances to advance:
  //   1. A 继续 button on the IdeaRootNode card itself (right side).
  //   2. The central column 继续 button already rendered by TreeCanvas.
  // Both call /next-step(1). Affordance (1) is Step-1-only — Step 2-5
  // cascade from /select and never hit "available" in actual flow.
  // Gating is strict (step === 1 AND state === "available") so a
  // mid-reset state where Step 2 lands in "available" does NOT
  // misroute nextStep(1) and clobber already-completed Step 1.
  const step1 = cpath[0];
  const isStep1Available =
    step1?.state === "available" && step1?.step === 1;

  // Header defaults to "twist" when no active step exists yet (committed or
  // pre-init states) so the pill stays populated.
  const headerOperation = activeStep?.operation ?? "twist";
  const opLabel =
    OPERATION_LABEL_ZH[headerOperation] ?? headerOperation;

  // When embedded=true, drop the page-shell wrapper + title header so the
  // wizard's chrome is the only chrome. The page still owns the bottom
  // action bar, dialogs, and the canvas tree itself.
  const main = (
    <>
      {/* Header: title left, StepIndicator right. Only shown when the page
          owns its own chrome (standalone mode). */}
      {!embedded && (
        <div className="flex justify-between items-end mb-6">
          <div>
            <h2 className="text-headline-lg font-bold text-on-surface">
              剧情画布
            </h2>
            <p className="text-on-surface-variant text-sm">
              通过 WhatIf 树形结构可视化探索故事的不同发展方向。
            </p>
          </div>
          <StepIndicator
            currentStep={canvas.creative_session.current_step}
            maxSteps={canvas.creative_session.max_steps}
            operation={headerOperation}
          />
        </div>
      )}

      {/* Tree visualization */}
      <TreeCanvas
        canvas={canvas}
        onAdvance={(step) => {
          // PRD §5.2: user-driven AVAILABLE → ACTIVE transition. The
          // button only renders when onAdvance is provided, so passing
          // a no-op would still render dead buttons — only attach it
          // when loadingStep is false to avoid double-firing.
          if (!loadingStep) {
            nextStep(step).catch(() => {});
          }
        }}
        ideaOnContinue={
          isStep1Available
            ? () => {
                // Mirror the onAdvance guard — only fire when not
                // already in flight. The click feedback (spinner on
                // the button) is wired via `ideaContinueLoading`
                // below, so the user gets the same loading affordance
                // as the central column button.
                if (!loadingStep) {
                  nextStep(1).catch(() => {});
                }
              }
            : undefined
        }
        ideaContinueLoading={loadingStep}
      />

      {/* Pre-step guidance placeholder — spec §3.3. When no active step
          exists yet but Step 1 is available, the active-step area was
          previously blank — users saw 3 empty circles + a central 继续
          button with no explanation. Now we render CanvasPreStepHint
          INSIDE the `active-step-panel` wrapper (testid preserved) so
          the hint replaces the empty area and explicitly points at the
          IdeaRootNode 继续 affordance. Only Step 1 triggers this; Step
          2-5 cascade from /select and never enter the available state
          in real flow. */}
      {!activeStep && isStep1Available && (
        <div className="mt-6" data-testid="active-step-panel">
          <CanvasPreStepHint step={1} />
        </div>
      )}

      {/* Creative quality scores — PRD §16. Reads canvas.scores which
          is refreshed by /select's _refresh_top_level_scores helper.
          Rendered between the tree and the active-step panel so users
          see the concept's overall quality at a glance regardless of
          which step they're on. */}
      {canvas.scores && (
        <div className="mt-md">
          <ScoresBar
            scores={{
              novelty: canvas.scores.novelty ?? 0,
              conflict: canvas.scores.conflict ?? 0,
              story_potential: canvas.scores.story_potential ?? 0,
              uniqueness: canvas.scores.uniqueness ?? 0,
            }}
            embedded={embedded}
          />
        </div>
      )}

      {/* Active step options — PRD §8: B is AI default (recommended). */}
      {activeStep && (
        <div className="mt-6" data-testid="active-step-panel">
          <div className="grid grid-cols-3 gap-6">
            {(["A", "B", "C"] as const).map((slot) => {
              // Option id format: opt_{step}_{slot} (backend renumbers the
              // LLM-produced opt_a/b/c → opt_{step}_a/b/c in v2_canvas.py).
              // Guard options against undefined — same defensive pattern as
              // cpath above; otherwise a malformed active step throws on
              // ".find()" and trips the StageErrorBoundary.
              const activeOptions = Array.isArray(activeStep.options) ? activeStep.options : [];
              const option = activeOptions.find(
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
          {/* AI recommendation rationale — PRD §15.1. Upgraded from a
              single muted line to a callout-style block so users
              actually read the reasoning before picking A/B/C. The
              testid guards against regression to a plain paragraph. */}
          <div
            data-testid="operation-reason-callout"
            className="mt-4 flex gap-3 items-start rounded-lg border border-primary/30 bg-primary-container/10 px-4 py-3"
          >
            <span
              aria-hidden="true"
              className="material-symbols-outlined text-primary text-xl mt-0.5 shrink-0"
              style={{ fontVariationSettings: "'FILL' 1" }}
            >
              auto_awesome
            </span>
            <div className="flex flex-col gap-1 min-w-0">
              <span className="text-xs uppercase tracking-wider font-label-sm text-primary font-bold">
                为什么是「{activeStep.operation}」？
              </span>
              <p className="text-sm text-on-surface leading-relaxed">
                {activeStep.operation_reason}
              </p>
            </div>
          </div>
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
          // Await the hook's commit and fire onCommitSuccess once it
          // resolves. The wizard-side mount point wires this callback
          // to markStep1SurfaceCompleted("canvas") so step 2 unlocks.
          confirmCommit()
            .then(() => onCommitSuccess?.())
            .catch(() => {
              // Hook already surfaces errors via its own error state;
              // the catch here only prevents an unhandled-rejection
              // warning in the console.
            });
        }}
        onCancel={closePreCommit}
      />
    </>
  );

  return embedded ? (
    main
  ) : (
    <div
      data-testid="plot-canvas-page"
      className="bg-surface-container-lowest min-h-screen p-6"
    >
      {main}
    </div>
  );
}