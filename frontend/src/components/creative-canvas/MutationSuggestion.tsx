interface MutationOp {
  value: "inversion" | "escalation" | "subversion";
  label: string;
  description: string;
  emoji: string;
}

const MUTATION_OPS: MutationOp[] = [
  {
    value: "inversion",
    label: "反转",
    description: "反转套路的核心前提",
    emoji: "swap_horiz",
  },
  {
    value: "escalation",
    label: "加码",
    description: "将某维度推到极致",
    emoji: "trending_up",
  },
  {
    value: "subversion",
    label: "颠覆",
    description: "颠覆读者预期",
    emoji: "shuffle",
  },
];

interface MutationSuggestionProps {
  loading: boolean;
  recommendation: string;
  applying?: boolean;
  onApply?: (operation: string) => void;
}

export default function MutationSuggestion({
  loading,
  recommendation,
  applying = false,
  onApply,
}: MutationSuggestionProps) {
  if (!loading && !recommendation) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy={loading || applying}
      className="px-2.5 py-2 bg-tertiary-container/10 border border-tertiary-container/30 rounded-lg"
    >
      <div className="flex items-center gap-1.5 mb-1">
        <span className="material-symbols-outlined text-tertiary-container text-xs">
          transform
        </span>
        <span className="font-label-mono text-xs text-tertiary-container">
          变异建议
        </span>
      </div>
      {loading ? (
        <div className="flex items-center gap-1.5 text-system-log/60 text-xs">
          <span className="material-symbols-outlined text-xs animate-spin">progress_activity</span>
          正在分析最适合的变异方向...
        </div>
      ) : (
        <>
          <p className="font-body-narrative text-primary text-xs leading-snug mb-2">
            {recommendation}
          </p>
          {onApply && (
            <div className="space-y-1">
              <div className="font-label-mono text-[10px] text-system-log/70 uppercase tracking-wider">
                选择变异操作
              </div>
              <div className="grid grid-cols-3 gap-1.5">
                {MUTATION_OPS.map((op) => (
                  <button
                    key={op.value}
                    onClick={() => onApply(op.value)}
                    disabled={applying}
                    className="flex flex-col items-center gap-0.5 px-2 py-1.5
                               bg-tertiary-container/20 text-tertiary-container
                               rounded hover:bg-tertiary-container/30
                               disabled:opacity-40 disabled:cursor-not-allowed
                               transition-colors"
                    title={op.description}
                  >
                    <span className="material-symbols-outlined text-base">{op.emoji}</span>
                    <span className="font-label-mono text-xs">{op.label}</span>
                  </button>
                ))}
              </div>
              {applying && (
                <div className="flex items-center gap-1.5 text-system-log/60 text-[10px] mt-1">
                  <span className="material-symbols-outlined text-xs animate-spin">progress_activity</span>
                  正在生成变异节点...
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}