import { GhostButton, PrimaryButton } from "@/components/ds";

interface Stats {
  depth: number;
  novelty: number;
  conflict: number;
}

interface Props {
  open: boolean;
  stats: Stats;
  onCommit: () => void;
  onCancel: () => void;
  disabled?: boolean;
}

/** PRD §18.3 — pre-commit summary modal; glass-panel design. */
export function PreCommitSummary({ open, stats, onCommit, onCancel, disabled = false }: Props) {
  if (!open) return null;
  return (
    <div data-testid="pre-commit-summary"
         className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50"
         role="dialog" aria-modal="true">
      <div className="glass-panel rounded-xl p-xl max-w-md w-full space-y-md">
        <h2 className="font-headline-lg-mobile text-headline-lg-mobile text-on-surface">
          你的创意已经形成
        </h2>
        <div className="font-stats-number text-stats-number text-primary space-y-xs">
          <div>创意深度：{stats.depth} / 5</div>
          <div className="text-sm text-on-surface-variant">
            新颖度：{stats.novelty} · 核心冲突：{stats.conflict}
          </div>
        </div>
        <p className="text-on-surface-variant text-sm">
          你将进入下一阶段：<span className="text-primary">概念 DNA</span>
        </p>
        <div className="flex justify-end gap-sm pt-md">
          <GhostButton label="返回继续探索" onClick={onCancel} disabled={disabled} />
          <PrimaryButton
            label={disabled ? "提交中..." : "形成概念 →"}
            onClick={onCommit} disabled={disabled}
          />
        </div>
      </div>
    </div>
  );
}