import { useParams } from "react-router-dom";
import { useCreativeCanvasV2 } from "@/hooks/useCreativeCanvasV2";
import { TreeCanvas } from "@/components/creative-canvas/TreeCanvas";
import { StepIndicator } from "@/components/creative-canvas/StepIndicator";
import { OptionCard } from "@/components/creative-canvas/OptionCard";
import { EmptyState } from "@/components/creative-canvas/EmptyState";
import { ResetConfirmDialog } from "@/components/creative-canvas/ResetConfirmDialog";
import { PreCommitSummary } from "@/components/creative-canvas/PreCommitSummary";
import { ScoresBar } from "@/components/creative-canvas/ScoresBar";
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

interface CreativeCanvasPageProps {
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

export default function CreativeCanvasPage({
  projectId: projectIdProp,
  embedded = false,
  onCommitSuccess,
}: CreativeCanvasPageProps = {}) {
  // Route is /project/:projectId/stage1/canvas (App.tsx:114). Explicit
  // prop wins over URL param so embedded mode works without a router.
  const { projectId: projectIdParam = "" } = useParams<{ projectId: string }>();
  const projectId = projectIdProp ?? projectIdParam;
  const {
    canvas, loadingStep, canCommit,
    showResetDialog, onReset, closeResetDialog, confirmReset,
    showPreCommit, onCommitClick, closePreCommit, confirmCommit,
    initSession, selectOption, nextStep,
  } = useCreativeCanvasV2(projectId);

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
          initSession({ prompt, genre_primary: genre }).catch(() => {});
        }}
      />
    ) : (
      <div data-testid="creative-canvas-page" className="bg-surface-container-lowest min-h-screen p-6">
        <EmptyState
          loading={loadingStep}
          embedded={embedded}
          onInit={(prompt, genre) => {
            initSession({ prompt, genre_primary: genre }).catch(() => {
              // Hook already surfaces errors via its own error state; the
              // catch here only prevents an unhandled-rejection warning in
              // the console when the user retries after a malformed prompt.
            });
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
      />

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
      data-testid="creative-canvas-page"
      className="bg-surface-container-lowest min-h-screen p-6"
    >
      {main}
    </div>
  );
}