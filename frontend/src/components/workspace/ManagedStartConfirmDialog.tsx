interface Props {
  open: boolean;
  chapterNumbers: number[];
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ManagedStartConfirmDialog({
  open, chapterNumbers, onConfirm, onCancel,
}: Props) {
  if (!open) return null;

  const list = chapterNumbers.join(", ");

  return (
    <div
      data-testid="confirm-dialog"
      className="fixed inset-0 z-[60] bg-black/70 flex items-center justify-center p-4"
    >
      <div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-6 max-w-md w-full space-y-4">
        <h3 className="font-display text-primary text-base">确认重新生成</h3>
        <p className="font-body-ui text-sm text-system-log">
          您即将重新生成以下章节：
          <span className="font-medium text-on-surface">第 {list} 章</span>。
        </p>
        <p className="font-body-ui text-sm text-warning">
          这些章节的现有内容将被覆盖，无法撤销。是否继续？
        </p>
        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            data-testid="confirm-no"
            onClick={onCancel}
            className="px-4 py-2 text-sm rounded-lg bg-surface-container text-system-log hover:bg-surface-container-low"
          >
            取消
          </button>
          <button
            type="button"
            data-testid="confirm-yes"
            onClick={onConfirm}
            className="px-4 py-2 text-sm rounded-lg bg-tertiary-container text-surface-container-low hover:opacity-90"
          >
            确认重新生成
          </button>
        </div>
      </div>
    </div>
  );
}
