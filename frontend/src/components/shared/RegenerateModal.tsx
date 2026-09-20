import { useEffect, useLayoutEffect, useRef, useState } from "react";

interface RegenerateModalProps {
  open: boolean;
  target: string;
  placeholder?: string;
  onConfirm: (userModifications: string) => void;
  onCancel: () => void;
  /**
   * True while the parent is awaiting the regenerate call. The confirm
   * button shows a spinner and "<confirmLabel>中…" to give the user feedback
   * that the request is in flight (otherwise the modal sits silently for
   * several seconds while the LLM responds).
   */
  busy?: boolean;
  /**
   * Prefix used in the modal title (`${titlePrefix} — ${target}`).
   * Default: "重新生成". Set to "追问" for per-unit follow-up flows so the
   * title reads "追问 — 灵窍" instead of "重新生成 — 追问 - 灵窍".
   */
  titlePrefix?: string;
  /**
   * Label of the confirm button. Default: "重新生成". Set to "追问" for
   * per-unit follow-up flows so the button matches the action the user just
   * initiated (the outer button they clicked was also labeled "追问").
   * Busy text is derived: "${confirmLabel}中…".
   */
  confirmLabel?: string;
  /**
   * Optional operator selector shown in place of the default "留空 = 仅重新生成"
   * hint row. Pass an array of `{value, label}` to enable — when undefined,
   * the original hint row is rendered (so callers like S2 regenerate keep their
   * existing UX). Used by S2 follow-up to let users pick "无算子" / "自适应"
   * before confirming.
   *
   * State is owned by the parent (controlled component): pass `operator` for
   * the current value and `onOperatorChange` to update it. The modal does
   * NOT internally hold operator state — this keeps it composable with
   * other forms that may share the same dropdown elsewhere.
   */
  operator?: string;
  operators?: ReadonlyArray<{ value: string; label: string }>;
  onOperatorChange?: (op: string) => void;
}

const MAX_LEN = 1700;

export function RegenerateModal({
  open,
  target,
  placeholder = "例如:让节奏更紧凑 / 主角动机更清晰 / 减少说教感……",
  onConfirm,
  onCancel,
  busy = false,
  titlePrefix = "重新生成",
  confirmLabel = "重新生成",
  operator,
  operators,
  onOperatorChange,
}: RegenerateModalProps) {
  const [text, setText] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useLayoutEffect(() => {
    if (open) {
      setText("");
      textareaRef.current?.focus();
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onCancel]);

  if (!open) return null;

  const handleSubmit = () => {
    onConfirm(text);
  };

  const handleTextareaKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      onConfirm(text);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="regenerate-modal-title"
      className="fixed inset-0 z-50 flex items-start justify-center pt-20 bg-black/40"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        data-testid="regenerate-modal"
        onClick={(e) => e.stopPropagation()}
        className="bg-surface-container-lowest rounded-lg shadow-xl w-[560px] max-w-[92vw] overflow-hidden"
      >
        <div className="px-6 pt-5 pb-3 border-b border-system-divider">
          <h2
            id="regenerate-modal-title"
            className="font-display text-primary text-base font-semibold"
          >
            {titlePrefix} — {target}
          </h2>
          <p className="font-body-ui text-system-log/60 text-xs mt-1">
            原内容将被覆盖,AI 会结合你的意见重新生成
          </p>
        </div>

        <div className="px-6 py-4">
          <label
            htmlFor="regenerate-modal-textarea"
            className="block font-body-ui text-system-log/70 text-xs font-medium mb-1.5"
          >
            修改意见 (可选)
          </label>
          <textarea
            id="regenerate-modal-textarea"
            ref={textareaRef}
            aria-label="修改意见"
            value={text}
            onChange={(e) => setText(e.target.value.slice(0, MAX_LEN))}
            onKeyDown={handleTextareaKey}
            maxLength={MAX_LEN}
            placeholder={placeholder}
            className="w-full h-[140px] border border-system-divider rounded-md px-3 py-2 text-sm resize-y focus:outline-none focus:ring-2 focus:ring-primary-container/40 bg-surface-container text-system-log font-body-ui"
          />
          <div className="mt-2 flex justify-between font-body-ui text-system-log/50 text-[11px]">
            {operators && operators.length > 0 ? (
              // Operator selector mode (e.g. S2 follow-up with 无算子/自适应).
              // Replace the "留空 = 仅重新生成" hint row with a dropdown +
              // character counter. The hint disappears entirely — the user's
              // question textarea is still optional (adaptive mode works
              // empty), but the new dropdown is the primary signal.
              <label className="flex items-center gap-2 text-system-log/70">
                <span className="font-medium">算子</span>
                <select
                  data-testid="regenerate-modal-operator"
                  value={operator ?? operators[0].value}
                  onChange={(e) => onOperatorChange?.(e.target.value)}
                  disabled={busy}
                  className="border border-system-divider rounded px-2 py-1 text-xs bg-surface-container text-system-log focus:outline-none focus:ring-2 focus:ring-primary-container/40"
                >
                  {operators.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              // Default hint for non-operator callers (e.g. S2 regenerate).
              <span>留空 = 仅重新生成 · 最多 {MAX_LEN} 字</span>
            )}
            <span>
              {text.length} / {MAX_LEN}
            </span>
          </div>
        </div>

        <div className="px-6 py-3 bg-surface-container border-t border-system-divider flex items-center justify-between">
          <span className="font-body-ui text-system-log/50 text-[11px]">
            Esc 取消 · Cmd+Enter 提交
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              data-testid="regenerate-modal-cancel"
              onClick={onCancel}
              disabled={busy}
              className="px-4 py-1.5 text-sm border border-system-divider rounded-md hover:bg-surface-container-high text-system-log disabled:opacity-40"
            >
              取消
            </button>
            <button
              type="button"
              data-testid="regenerate-modal-confirm"
              onClick={handleSubmit}
              disabled={busy}
              className="inline-flex items-center justify-center gap-1.5 px-4 py-1.5 text-sm bg-primary-container text-surface-container-low rounded-md hover:opacity-90 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {busy && (
                <span
                  data-testid="regenerate-modal-confirm-spinner"
                  aria-hidden="true"
                  className="material-symbols-outlined text-[14px] animate-spin inline-block"
                >
                  progress_activity
                </span>
              )}
              {busy ? `${confirmLabel}中…` : confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
