import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { PrimaryButton, PanelCard } from "@/components/ds";
// TODO(canvas-recon Task 14): rewrite CreativeCanvasPage to use TreeCanvas.
// Temporary stub keeps tsc happy while HorizontalPathCanvas migration completes.
const HorizontalPathCanvas: React.FC<{ rootIdea: string; path: unknown[] }> = () => null;
// TODO(canvas-recon Task 14): rewrite ActiveStepPanel integration to use OptionCard.
// Temporary stub keeps tsc happy while the migration completes.
const ActiveStepPanel: React.FC<{
  step: number;
  operation: { type: string; name: string; reason: string };
  options: unknown[];
  disabled: boolean;
  onSelect: (optionId: string) => void | Promise<void>;
}> = () => null;
import { QualityBar } from "@/components/creative-canvas/QualityBar";
import { CanvasToolbar } from "@/components/creative-canvas/CanvasToolbar";
import { useCreativeCanvasV2 } from "@/hooks/useCreativeCanvasV2";
import type { RawIntent, NextStepResponse } from "@/api/client";

export default function CreativeCanvasPage() {
  const { id: projectId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const {
    status, canvas, error, loadingStep, committedAt, canCommit,
    loadCanvas, initSession, nextStep, selectOption, commitCanvas,
  } = useCreativeCanvasV2(projectId || "");
  const [initForm, setInitForm] = useState({ prompt: "", genre_primary: "" });
  const [pendingNextStep, setPendingNextStep] = useState<NextStepResponse | null>(null);

  useEffect(() => {
    loadCanvas();
  }, [projectId, loadCanvas]);

  // Derive the active step's NextStepResponse from canvas or pending fetch
  const activeStep = canvas?.creative_path.find((p) => p.state === "active");
  const stepResponse: NextStepResponse | null =
    pendingNextStep ||
    (activeStep && activeStep.options.length > 0
      ? {
          step: activeStep.step,
          operation: {
            type: activeStep.operation || "twist",
            name: activeStep.operation || "twist",
            reason: activeStep.operation_reason || "",
          },
          options: activeStep.options,
          quality_warning: null,
        }
      : null);

  if (status === "empty") {
    return (
      <div className="p-8 max-w-2xl mx-auto">
        <PanelCard>
          <h2 className="text-xl mb-4">开始你的创意</h2>
          <textarea
            placeholder="用一句话描述你的故事想法"
            className="w-full h-32 p-3 border border-outline-variant rounded-lg mb-3"
            value={initForm.prompt}
            onChange={(e) => setInitForm({ ...initForm, prompt: e.target.value })}
          />
          <input
            type="text"
            placeholder="主类型"
            className="w-full p-2 border border-outline-variant rounded-lg mb-3"
            value={initForm.genre_primary}
            onChange={(e) => setInitForm({ ...initForm, genre_primary: e.target.value })}
          />
          <PrimaryButton
            label="初始化"
            disabled={initForm.prompt.length < 10 || !initForm.genre_primary}
            onClick={() => initSession(initForm as RawIntent)}
          />
        </PanelCard>
      </div>
    );
  }

  return (
    <div data-testid="creative-canvas-v2-page" className="flex flex-col h-full">
      <CanvasToolbar
        currentStep={canvas?.creative_session?.current_step || 1}
        totalSteps={5}
        onViewPath={() => {}}
        onReset={() => {
          // TODO(canvas-v2): wire to resetCanvas action once deleteCanvasV2State
          // is added to api/client.ts. Until then this is a no-op.
          console.warn("resetCanvas: not yet implemented");
        }}
      />

      {canvas && (
        <div data-testid="canvas-route-todo">
          TODO(canvas-recon Task 14): TreeCanvas rewrite pending
        </div>
      )}

      <div className="flex-1 overflow-auto p-4">
        {loadingStep && <div>生成选项中...</div>}

        {stepResponse && (
          <div data-testid="active-step-todo">
            TODO(canvas-recon Task 14): OptionCard rewrite
          </div>
        )}

        {canvas?.scores && (
          <QualityBar
            novelty={canvas.scores.novelty || 0}
            conflict={canvas.scores.conflict || 0}
          />
        )}

        {canCommit && (
          <div className="mt-4">
            <PrimaryButton label="提交到 Stage 0" onClick={() => commitCanvas()} />
          </div>
        )}

        {error && (
          <div className="mt-4 p-3 bg-error/10 border border-error rounded text-error">
            {error}
          </div>
        )}

        {committedAt && (
          <div className="mt-4 p-3 bg-success/10 border border-success rounded">
            已提交于 {committedAt}
            <PrimaryButton
              label="跳转到 Stage 0"
              onClick={() => navigate(`/project/${projectId}/stage0`)}
              size="sm"
            />
          </div>
        )}
      </div>
    </div>
  );
}