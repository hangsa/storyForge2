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
}

export function SectionRegenerateButton({
  target,
  onRegenerate,
  disabled = false,
  testId,
}: SectionRegenerateButtonProps) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  // Reporting success/failure through wizard.regenerateState renders an
  // inline status badge in the wizard footer (positioned before "重新生成"),
  // instead of the previous global toast at viewport bottom-right which
  // overlapped the footer buttons when the modal was short.
  const wizard = useWizard();

  const handleConfirm = async (text: string) => {
    setBusy(true);
    wizard.setRegenerateBusy(target);
    try {
      await onRegenerate(text);
      wizard.setRegenerateSuccess(target);
      setOpen(false);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      wizard.setRegenerateFailure(target, msg);
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
