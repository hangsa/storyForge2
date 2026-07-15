interface Props {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onCancel: () => void;
  onConfirm: () => void;
}

export default function ConfirmDialog({
  open, title, message, confirmLabel = "确认", cancelLabel = "取消", onCancel, onConfirm,
}: Props) {
  if (!open) return null;
  return (
    <div
      data-testid="confirm-dialog"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={onCancel}
    >
      <div
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        className="bg-surface-container-lowest rounded-lg shadow-xl p-6 max-w-sm w-full mx-4 space-y-4"
      >
        <h2 className="font-display text-primary text-lg">{title}</h2>
        <p className="font-body-ui text-system-log text-sm">{message}</p>
        <div className="flex gap-2 justify-end">
          <button
            type="button"
            data-testid="confirm-dialog-cancel"
            onClick={onCancel}
            className="px-4 py-2 rounded bg-surface-container text-system-log hover:bg-surface-container-high text-sm"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            data-testid="confirm-dialog-confirm"
            onClick={onConfirm}
            className="px-4 py-2 rounded bg-primary-container text-surface-container-low hover:opacity-90 text-sm"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}