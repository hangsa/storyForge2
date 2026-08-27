import { GhostButton, SecondaryButton } from "../ds";

export interface BulkDeleteModalProps {
  selectedIds: string[];
  selectedTitles: string[];
  isOpen: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

const VISIBLE_LIMIT = 10;

export default function BulkDeleteModal({
  selectedIds,
  selectedTitles,
  isOpen,
  onConfirm,
  onCancel,
}: BulkDeleteModalProps) {
  if (!isOpen) return null;

  const visible = selectedTitles.slice(0, VISIBLE_LIMIT);
  const overflow = selectedTitles.length - visible.length;

  return (
    <div
      data-testid="bulk-delete-modal"
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-8"
    >
      <div className="bg-surface-container-lowest border border-outline-variant rounded-lg w-full max-w-md flex flex-col">
        <header className="px-6 py-4 border-b border-outline-variant">
          <h2 className="font-display text-title-md text-primary">确认删除</h2>
        </header>
        <div className="px-6 py-4 space-y-3">
          <p className="font-body text-body-md text-on-surface">
            确定要删除以下 {selectedIds.length} 个项目吗？此操作不可撤销。
          </p>
          <ul className="max-h-60 overflow-y-auto bg-surface-container border border-outline-variant rounded p-3 space-y-1">
            {visible.map((t, i) => (
              <li key={i} className="font-body text-body-md text-on-surface truncate">
                {t}
              </li>
            ))}
            {overflow > 0 && (
              <li className="font-mono text-label-sm text-on-surface-variant">
                … 还有 {overflow} 个
              </li>
            )}
          </ul>
        </div>
        <footer className="px-6 py-4 border-t border-outline-variant flex justify-end gap-3">
          <GhostButton label="取消" onClick={onCancel} />
          <SecondaryButton label="删除" variant="destructive" icon="delete" onClick={onConfirm} />
        </footer>
      </div>
    </div>
  );
}
