interface Props {
  /**
   * 1-indexed step number. Surfaces in the body copy as "第 N 步" so
   * the user knows which step is about to be generated. Defaults to 1
   * (the only step where this hint is rendered per spec §3.3).
   */
  step?: number;
}

/**
 * Active-step area placeholder shown when the canvas is in the
 * "Step N is available, AI has not generated the 3 options yet" state.
 *
 * The hint serves two purposes:
 *   1. Tell the user that the canvas is waiting on them (not stuck).
 *   2. Direct them to the "继续" affordance on the IdeaRootNode card.
 *
 * Per spec §3.3, this is rendered only for Step 1 — Step 2-5 cascade
 * from /select and never enter the "available" state in actual flow.
 */
export function CanvasPreStepHint({ step = 1 }: Props) {
  return (
    <div
      data-testid="canvas-pre-step-hint"
      className="flex flex-col items-center gap-3 max-w-xl mx-auto p-6 border border-dashed border-primary/30 rounded-lg bg-primary-container/5"
    >
      <span className="material-symbols-outlined text-primary text-3xl" aria-hidden="true">
        auto_awesome
      </span>
      <p className="text-sm text-on-surface text-center leading-relaxed">
        等待 AI 生成第 <span className="font-bold text-primary">{step}</span> 步的推演方向。
      </p>
      <p className="text-xs text-on-surface-variant text-center">
        点击上方「继续」，让 AI 决定这一步用什么创意操作。
      </p>
    </div>
  );
}