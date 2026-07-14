import { useEffect, useState } from "react";

export interface AddChaptersProgress {
  done: number;
  total: number;
}

interface AddChaptersModalProps {
  open: boolean;
  /**
   * Current max chapter number across outline.json. 0 if no chapters exist.
   * New chapters get numbered [currentMax+1 .. currentMax+count].
   */
  currentMax: number;
  /**
   * Planned total chapters parsed from novel_outline.json's volume
   * chapter_range. 0 means "no novel_outline yet" → modal falls back to
   * a default cap of 10 (so the user is never permanently blocked).
   */
  plannedTotal: number;
  /**
   * While the parent's onConfirm promise is pending, the parent can
   * push progress via this prop. The modal shows "正在生成第 X / N 章"
   * and disables inputs.
   */
  progress: AddChaptersProgress | null;
  onCancel: () => void;
  onConfirm: (count: number) => Promise<void> | void;
}

const DEFAULT_CAP_WHEN_UNPLANNED = 10;

/** Mirror ModSwitchConfirmModal / ManagedStartModal patterns: hand-rolled
 *  overlay, no UI library. Tailwind classes match sibling modals so the
 *  workspace footer-button group feels coherent. */
export default function AddChaptersModal({
  open,
  currentMax,
  plannedTotal,
  progress,
  onCancel,
  onConfirm,
}: AddChaptersModalProps) {
  const cap = plannedTotal > 0
    ? Math.max(0, plannedTotal - currentMax)
    : DEFAULT_CAP_WHEN_UNPLANNED;

  const [count, setCount] = useState(1);

  // Reset input whenever the modal (re)opens so a stale value from a
  // previous attempt doesn't leak in.
  useEffect(() => {
    if (open) setCount(1);
  }, [open]);

  if (!open) return null;

  const busy = progress !== null;
  const atCap = cap <= 0 && plannedTotal > 0;

  const handleConfirm = async () => {
    if (atCap || busy) return;
    await onConfirm(Math.min(count, cap));
  };

  return (
    <div
      data-testid="add-chapters-modal"
      className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
    >
      <div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-6 max-w-md w-full space-y-4">
        <header>
          <h2 className="font-display text-primary text-lg">+ 新章节</h2>
          <p className="font-body-ui text-system-log text-sm mt-1">
            接第 {currentMax} 章后开始，按 AI 生成大纲。
          </p>
        </header>

        {atCap ? (
          <div
            data-testid="add-chapters-cap-reached"
            className="p-3 bg-error-container/20 border border-error rounded text-error font-body-ui text-sm"
          >
            已达到全书大纲的上限（第 {plannedTotal} 章）。
          </div>
        ) : (
          <div className="space-y-2">
            <label className="block font-label-mono text-system-log text-xs">
              本次要增加的章节数
            </label>
            <input
              type="number"
              data-testid="add-chapters-count"
              min={1}
              max={cap}
              value={count}
              disabled={busy}
              onChange={(e) => {
                const v = Number(e.target.value);
                if (Number.isFinite(v) && v >= 1) {
                  setCount(Math.min(Math.floor(v), cap));
                }
              }}
              className="w-full bg-surface-container border border-outline-variant rounded-lg px-3 py-2 text-sm text-primary focus:outline-none focus:border-primary-container disabled:opacity-40"
            />
            <p data-testid="add-chapters-cap-hint" className="font-body-ui text-system-log/70 text-xs">
              可加 {cap} 章{plannedTotal > 0 ? `（全书大纲上限 ${plannedTotal} 章）` : "（未设定全书大纲，默认上限 10 章）"}
            </p>
          </div>
        )}

        {busy && (
          <div className="flex items-center gap-2 text-system-log text-sm font-body-ui">
            <span className="material-symbols-outlined text-primary-container animate-spin">progress_activity</span>
            <span data-testid="add-chapters-progress">
              正在生成第 {progress!.done} / {progress!.total} 章…
            </span>
          </div>
        )}

        <footer className="flex items-center justify-end gap-2 pt-2">
          <button
            type="button"
            data-testid="add-chapters-cancel"
            onClick={onCancel}
            disabled={busy}
            className="px-4 py-2 text-sm bg-surface-container text-system-log rounded-lg hover:bg-surface-container-low disabled:opacity-40"
          >
            取消
          </button>
          <button
            type="button"
            data-testid="add-chapters-confirm"
            onClick={handleConfirm}
            disabled={atCap || busy}
            className="px-5 py-2 text-sm bg-tertiary-container text-surface-container-low rounded-lg hover:opacity-90 disabled:opacity-40"
          >
            {busy ? "生成中…" : "确认添加"}
          </button>
        </footer>
      </div>
    </div>
  );
}
