import { useEffect, useLayoutEffect, useRef, useState } from "react";

interface RegenerateModalProps {
  open: boolean;
  target: string;
  placeholder?: string;
  onConfirm: (userModifications: string) => void;
  onCancel: () => void;
}

const MAX_LEN = 1700;

export function RegenerateModal({
  open,
  target,
  placeholder = "例如:让节奏更紧凑 / 主角动机更清晰 / 减少说教感……",
  onConfirm,
  onCancel,
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
            重新生成 — {target}
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
            <span>留空 = 仅重新生成 · 最多 {MAX_LEN} 字</span>
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
              className="px-4 py-1.5 text-sm border border-system-divider rounded-md hover:bg-surface-container-high text-system-log"
            >
              取消
            </button>
            <button
              type="button"
              data-testid="regenerate-modal-confirm"
              onClick={handleSubmit}
              className="px-4 py-1.5 text-sm bg-primary-container text-surface-container-low rounded-md hover:opacity-90"
            >
              重新生成
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
