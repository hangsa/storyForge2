import { GhostButton, PrimaryButton } from "@/components/ds";

interface Props {
  open: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  disabled?: boolean;
}

/** PRD §18.2 — reset dialog preserves root_idea; uses glass-panel design. */
export function ResetConfirmDialog({ open, onConfirm, onCancel, disabled = false }: Props) {
  if (!open) return null;
  return (
    <div data-testid="reset-confirm-dialog"
         className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50"
         role="dialog" aria-modal="true">
      <div className="glass-panel rounded-xl p-xl max-w-sm w-full space-y-md">
        <h2 className="font-headline-lg-mobile text-headline-lg-mobile text-on-surface">
          重新开始创意
        </h2>
        <p className="text-on-surface-variant text-sm">
          这会保留你的原始 Idea，但删除当前创意路径。
        </p>
        <div className="flex justify-end gap-sm pt-md">
          <GhostButton label="取消" onClick={onCancel} disabled={disabled} />
          <PrimaryButton
            label={disabled ? "重置中..." : "重新开始"}
            onClick={onConfirm} disabled={disabled}
          />
        </div>
      </div>
    </div>
  );
}
