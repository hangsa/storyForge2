import { useState } from "react";
import { RegenerateModal } from "./RegenerateModal";
import { useWizard } from "../wizard/WizardContext";

interface SectionRegenerateButtonProps {
  /** Modal title suffix, e.g. "力量体系". */
  target: string;
  /**
   * Called with the user's modification text on confirm. Should resolve on
   * success and reject on failure (so the footer status can surface the
   * result). On failure, the parent should ALSO call wizard.setStatus("error", ...)
   * to render the durable in-form error banner.
   */
  onRegenerate: (userModifications: string) => Promise<void>;
  /** Disables the icon while the parent is busy for an unrelated reason. */
  disabled?: boolean;
  /** Test id; default `section-regenerate-${target}`. */
  testId?: string;
  /**
   * 工作区使用：传入自定义 reporter（通常用 useToast 包装）。
   * 不传则 fallback useWizard()，保持现有 wizard 行为不变。
   */
  statusReporter?: {
    onBusy?: (target: string) => void;
    onSuccess?: (target: string) => void;
    onError?: (target: string, message: string) => void;
  };
}

export function SectionRegenerateButton({
  target,
  onRegenerate,
  disabled = false,
  testId,
  statusReporter,
}: SectionRegenerateButtonProps) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  // Reporting success/failure through wizard.regenerateState renders an
  // inline status badge in the wizard footer (positioned before "重新生成"),
  // instead of the previous global toast at viewport bottom-right which
  // overlapped the footer buttons when the modal was short.
  // 当 statusReporter 存在时跳过 wizard（向后兼容：wizard 路径不传 prop）。
  const wizard = statusReporter ? null : useWizard();

  const reportBusy = (t: string) => {
    if (statusReporter?.onBusy) statusReporter.onBusy(t);
    else wizard?.setRegenerateBusy(t);
  };
  const reportSuccess = (t: string) => {
    if (statusReporter?.onSuccess) statusReporter.onSuccess(t);
    else wizard?.setRegenerateSuccess(t);
  };
  const reportError = (t: string, m: string) => {
    if (statusReporter?.onError) statusReporter.onError(t, m);
    else wizard?.setRegenerateFailure(t, m);
  };

  const handleConfirm = async (text: string) => {
    setBusy(true);
    reportBusy(target);
    try {
      await onRegenerate(text);
      reportSuccess(target);
      setOpen(false);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      reportError(target, msg);
      setOpen(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        type="button"
        data-testid={testId ?? `section-regenerate-${target}`}
        onClick={() => setOpen(true)}
        disabled={disabled || busy}
        aria-label={`重新生成 — ${target}`}
        title={`重新生成 — ${target}`}
        className="inline-flex items-center justify-center h-6 w-6 rounded text-system-log/50 hover:text-primary-container hover:bg-surface-container transition-colors disabled:cursor-not-allowed disabled:opacity-40"
      >
        <span
          className={`material-symbols-outlined text-[14px]${busy ? " animate-spin text-primary-container" : ""}`}
          data-testid={busy ? `${testId ?? `section-regenerate-${target}`}-spinner` : undefined}
        >
          {busy ? "progress_activity" : "refresh"}
        </span>
      </button>
      <RegenerateModal
        open={open}
        target={target}
        onConfirm={handleConfirm}
        onCancel={() => setOpen(false)}
        busy={busy}
      />
    </>
  );
}
