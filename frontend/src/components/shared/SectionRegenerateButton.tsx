import { useState } from "react";
import { RegenerateModal } from "./RegenerateModal";

interface SectionRegenerateButtonProps {
  /** Modal title suffix, e.g. "力量体系". */
  target: string;
  /** Called with the user's modification text on confirm. */
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

  const handleConfirm = async (text: string) => {
    setBusy(true);
    try {
      await onRegenerate(text);
      // Parent's promise resolved → close the modal. If it rejected, the
      // modal stays open so the user can read the error banner (the parent
      // surfaces errors via wizard.setStatus or similar) and retry.
      setOpen(false);
    } catch {
      // Errors are surfaced by the parent (e.g. wizard.setStatus). Keep the
      // modal open so the user can adjust the modifications and retry.
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
        <span className="material-symbols-outlined text-[14px]">refresh</span>
      </button>
      <RegenerateModal
        open={open}
        target={target}
        onConfirm={handleConfirm}
        onCancel={() => setOpen(false)}
      />
    </>
  );
}
