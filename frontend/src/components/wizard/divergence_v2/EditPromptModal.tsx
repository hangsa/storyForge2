import { useEffect, useLayoutEffect, useRef, useState } from "react";

interface EditPromptModalProps {
  open: boolean;
  initialText: string;
  busy?: boolean;
  onSave: (newText: string) => void | Promise<void>;
  onCancel: () => void;
}

/**
 * Modal that lets the user view and edit the specialized firstness_decompose
 * prompt. Save calls onSave (which writes to prompt_overrides.json via
 * putPlazaPrompt); does NOT auto-trigger /decompose — the user must
 * click footer 「重新生成」 after saving.
 *
 * Behavior parity with RegenerateModal: Esc cancels, Cmd/Ctrl+Enter
 * confirms. Heuristic difference: textarea is taller (280px vs 140px)
 * since prompts are longer than modification hints.
 */
export function EditPromptModal({
  open, initialText, busy = false, onSave, onCancel,
}: EditPromptModalProps) {
  const [text, setText] = useState(initialText);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Re-sync textarea when reopened with a different initial value
  // (e.g. after meta regenerated the prompt).
  useLayoutEffect(() => {
    if (open) {
      setText(initialText);
      textareaRef.current?.focus();
    }
  }, [open, initialText]);

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

  const handleConfirm = () => {
    onSave(text);
  };

  const handleTextareaKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      onSave(text);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="edit-prompt-modal-title"
      className="fixed inset-0 z-50 flex items-start justify-center pt-20 bg-black/40"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        data-testid="edit-prompt-modal"
        onClick={(e) => e.stopPropagation()}
        className="bg-surface-container-lowest rounded-lg shadow-xl w-[640px] max-w-[92vw] overflow-hidden"
      >
        <div className="px-6 pt-5 pb-3 border-b border-system-divider">
          <h2
            id="edit-prompt-modal-title"
            className="font-display text-primary text-base font-semibold"
          >
            编辑专用提示词
          </h2>
          <p className="font-body-ui text-system-log/60 text-xs mt-1">
            修改后保存,然后点 footer「重新生成」使用新提示词拆解。
          </p>
        </div>

        <div className="px-6 py-4">
          <label
            htmlFor="edit-prompt-modal-textarea"
            className="block font-body-ui text-system-log/70 text-xs font-medium mb-1.5"
          >
            专用提示词
          </label>
          <textarea
            id="edit-prompt-modal-textarea"
            ref={textareaRef}
            aria-label="专用提示词"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleTextareaKey}
            className="w-full h-[280px] border border-system-divider rounded-md px-3 py-2 text-sm resize-y focus:outline-none focus:ring-2 focus:ring-primary-container/40 bg-surface-container text-system-log font-body-ui"
          />
        </div>

        <div className="px-6 py-3 bg-surface-container border-t border-system-divider flex items-center justify-between">
          <span className="font-body-ui text-system-log/50 text-[11px]">
            Esc 取消 · Cmd+Enter 保存
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              data-testid="edit-prompt-modal-cancel"
              onClick={onCancel}
              disabled={busy}
              className="px-4 py-1.5 text-sm border border-system-divider rounded-md hover:bg-surface-container-high text-system-log disabled:opacity-40"
            >
              取消
            </button>
            <button
              type="button"
              data-testid="edit-prompt-modal-confirm"
              onClick={handleConfirm}
              disabled={busy}
              className="inline-flex items-center justify-center gap-1.5 px-4 py-1.5 text-sm bg-primary-container text-surface-container-low rounded-md hover:opacity-90 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {busy && (
                <span
                  data-testid="edit-prompt-modal-confirm-spinner"
                  aria-hidden="true"
                  className="material-symbols-outlined text-[14px] animate-spin inline-block"
                >
                  progress_activity
                </span>
              )}
              {busy ? "保存中…" : "保存"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}