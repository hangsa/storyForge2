import { useEffect } from "react";

interface ResetConfirmDialogProps {
  open: boolean;
  nodeCount: number;
  loading: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ResetConfirmDialog({
  open,
  nodeCount,
  loading,
  onConfirm,
  onCancel,
}: ResetConfirmDialogProps) {
  if (!open) return null;

  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !loading) onCancel();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [open, loading, onCancel]);

  return (
    <div
      className="fixed inset-0 bg-black/70 flex items-center justify-center z-50"
      onClick={(e) => {
        if (e.target === e.currentTarget && !loading) onCancel();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="reset-confirm-title"
        className="bg-surface-container-low border border-error/30 rounded-lg max-w-md w-full mx-4 overflow-hidden"
      >
        <div className="px-4 py-3 flex items-center justify-between border-b border-outline-variant">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-error">restart_alt</span>
            <span id="reset-confirm-title" className="font-label-mono text-error">重置画布</span>
          </div>
          <button
            onClick={onCancel}
            disabled={loading}
            aria-label="关闭"
            className="text-system-log hover:text-primary disabled:opacity-30"
          >
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>
        <div className="p-6 space-y-4">
          <p className="font-body-narrative text-primary text-sm leading-relaxed">
            确定要重置画布吗？当前共有 <span className="font-display text-error">{nodeCount}</span> 个节点将被清除。
          </p>
          <p className="font-body-ui text-system-log text-xs">
            画布状态将从服务器永久删除，此操作不可撤销。
          </p>
          <div className="flex justify-end gap-3 pt-2">
            <button
              onClick={onCancel}
              disabled={loading}
              className="px-4 py-2 bg-surface-container text-system-log text-sm
                         rounded-lg hover:bg-surface-container-low transition-colors disabled:opacity-40"
            >
              取消
            </button>
            <button
              onClick={onConfirm}
              disabled={loading}
              className="px-4 py-2 bg-error text-surface-container-low text-sm
                         rounded-lg hover:opacity-90 transition-opacity disabled:opacity-40"
            >
              {loading ? "重置中..." : "确认重置"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
