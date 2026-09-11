import { useState, useEffect } from "react";
import type { DimensionEntry, DimensionEntryPayload } from "@/api/types";
import { PrimaryButton, GhostButton } from "@/components/ds";

interface Props {
  entry: DimensionEntry | null;   // null = 新增
  onSave: (payload: DimensionEntryPayload) => Promise<void>;
  onDelete?: () => Promise<void>;
  onClose: () => void;
}

export default function EntryEditPanel({ entry, onSave, onDelete, onClose }: Props) {
  const [name, setName] = useState(entry?.name ?? "");
  const [description, setDescription] = useState(entry?.description ?? "");
  const [status, setStatus] = useState<"active" | "inactive">(entry?.status ?? "active");
  const [order, setOrder] = useState(entry?.order ?? 0);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setName(entry?.name ?? "");
    setDescription(entry?.description ?? "");
    setStatus(entry?.status ?? "active");
    setOrder(entry?.order ?? 0);
    setErr(null);
  }, [entry]);

  const handleSave = async () => {
    setSaving(true);
    setErr(null);
    try {
      await onSave({
        name: name.trim(),
        description: description,
        status,
        order: Number(order) || 0,
      });
    } catch (e) {
      setErr(e instanceof Error ? e.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="absolute inset-0 z-10 bg-black/30 flex items-center justify-center p-4"
      data-testid="entry-edit-panel-overlay"
    >
      <div className="w-full max-w-2xl max-h-[80vh] flex flex-col overflow-hidden bg-surface-container-low border border-outline-variant rounded-lg">
        <div className="px-6 py-3 border-b border-outline-variant flex items-center justify-between">
          <h3 className="font-display text-base text-primary">
            {entry ? `编辑：${entry.name}` : "新增"}
          </h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭"
            className="text-on-surface-variant hover:text-primary"
            data-testid="edit-panel-close"
          >
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4 flex flex-col gap-4">
          {err && (
            <div className="p-2 bg-error/10 border border-error/30 rounded text-error text-xs">
              {err}
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-primary mb-1">名称</label>
            <input
              type="text"
              value={name}
              maxLength={64}
              onChange={(e) => setName(e.target.value)}
              className="w-full bg-surface-container border border-outline-variant rounded-lg px-3 py-2 text-sm text-primary focus:outline-none focus:border-primary-container"
              data-testid="edit-name"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-primary mb-1">状态</label>
            <div className="flex gap-2" data-testid="edit-status">
              <button
                type="button"
                onClick={() => setStatus("active")}
                className={`px-3 py-1.5 rounded-lg text-sm ${
                  status === "active" ? "bg-primary-container text-on-primary-container" : "text-primary hover:bg-surface-container-high"
                }`}
                data-testid="status-active"
              >
                生效
              </button>
              <button
                type="button"
                onClick={() => setStatus("inactive")}
                className={`px-3 py-1.5 rounded-lg text-sm ${
                  status === "inactive" ? "bg-primary-container text-on-primary-container" : "text-primary hover:bg-surface-container-high"
                }`}
                data-testid="status-inactive"
              >
                失效
              </button>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-primary mb-1">
              特征 <span className="text-on-surface-variant text-xs">({description.length}/2000)</span>
            </label>
            <textarea
              value={description}
              maxLength={2000}
              onChange={(e) => setDescription(e.target.value)}
              rows={6}
              className="w-full bg-surface-container border border-outline-variant rounded-lg px-3 py-2 text-sm text-primary focus:outline-none focus:border-primary-container resize-y"
              data-testid="edit-description"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-primary mb-1">排序</label>
            <input
              type="number"
              value={order}
              min={0}
              max={9999}
              onChange={(e) => setOrder(Number(e.target.value))}
              className="w-32 bg-surface-container border border-outline-variant rounded-lg px-3 py-2 text-sm text-primary"
              data-testid="edit-order"
            />
          </div>
        </div>

        <div className="px-6 py-3 border-t border-outline-variant flex items-center justify-between">
          <div>
            {entry && onDelete && (
              <button
                type="button"
                onClick={() => {
                  if (window.confirm(`确定删除「${entry.name}」?`)) {
                    onDelete();
                  }
                }}
                className="px-3 py-1.5 text-error hover:bg-error/10 rounded-lg text-sm"
                data-testid="edit-delete"
              >
                删除
              </button>
            )}
          </div>
          <div className="flex gap-2">
            <GhostButton label="取消" onClick={onClose} />
            <span data-testid="edit-save">
              <PrimaryButton
                label={saving ? "保存中…" : "保存"}
                onClick={handleSave}
                disabled={saving || !name.trim()}
              />
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
