import { useState } from "react";
import { useAutopilotSession } from "../../hooks/useAutopilotSession";

interface Props {
  open: boolean;
  /**
   * "mode-switch" — top-bar managed→manual toggle (default).
   * "take-over"   — clicking a "writing" chapter cell in the dashboard
   *                 (spec § Drill-Down). Adds a chapterNumber and changes
   *                 copy so the modal reads as "wait vs. take over".
   */
  kind?: "mode-switch" | "take-over";
  /** Required when kind="take-over". */
  chapterNumber?: number;
  projectId: string;
  plannedChapters?: number;
  onCancel: () => void;
  onConfirm: (opts: { waitForCurrent: boolean; chapterNumber?: number }) => void;
}

export default function ModeSwitchConfirmModal({
  open,
  kind = "mode-switch",
  chapterNumber,
  projectId,
  plannedChapters = 0,
  onCancel,
  onConfirm,
}: Props) {
  const { session } = useAutopilotSession(projectId);
  const currentTask = session?.current_task?.description ?? "生成当前章节";
  const queueLength = session?.queue?.length ?? 0;

  const [waitForCurrent, setWaitForCurrent] = useState(kind === "take-over");
  if (!open) return null;

  const title = kind === "take-over"
    ? `第 ${chapterNumber ?? "?"} 章正在写作中`
    : "切换到手动模式？";
  const confirmLabel = kind === "take-over" ? "立即接管" : "切换到手动模式";
  const checkboxLabel = kind === "take-over"
    ? "等待当前章节生成完成（推荐）"
    : "切换前先把当前场景生成完成（推荐）";

  return (
    <div
      data-testid="mode-switch-confirm"
      data-kind={kind}
      className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
    >
      <div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-6 max-w-md w-full space-y-4">
        <h2 className="font-display text-primary text-lg">{title}</h2>

        <div className="space-y-1 text-sm font-body-ui text-system-log">
          <div>
            当前 AI 状态:{" "}
            <span data-testid="confirm-current-task" className="text-primary">
              {currentTask}
            </span>
          </div>
          <div>
            队列:{" "}
            <span data-testid="confirm-queue" className="text-primary">
              {queueLength} 任务
            </span>
          </div>
          <div>
            已规划{" "}
            <span data-testid="confirm-planned" className="text-primary">
              {plannedChapters}
            </span>{" "}
            章
          </div>
        </div>

        <label className="flex items-center gap-2 text-sm font-body-ui text-system-log">
          <input
            type="checkbox"
            data-testid="confirm-wait-finish"
            checked={waitForCurrent}
            onChange={(e) => setWaitForCurrent(e.target.checked)}
            className="accent-primary-container"
          />
          {checkboxLabel}
        </label>

        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            data-testid="confirm-cancel"
            onClick={onCancel}
            className="px-4 py-2 text-sm rounded-lg bg-surface-container text-system-log hover:bg-surface-container-low"
          >
            取消
          </button>
          <button
            type="button"
            data-testid="confirm-confirm"
            onClick={() => onConfirm({ waitForCurrent, chapterNumber })}
            className="px-4 py-2 text-sm rounded-lg bg-tertiary-container text-surface-container-low hover:opacity-90"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}