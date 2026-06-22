interface MutationSuggestionProps {
  loading: boolean;
  recommendation: string;
}

export default function MutationSuggestion({ loading, recommendation }: MutationSuggestionProps) {
  if (!loading && !recommendation) return null;

  return (
    <div className="p-3 bg-tertiary-container/10 border border-tertiary-container/30 rounded-lg">
      <div className="flex items-center gap-1.5 mb-1">
        <span className="material-symbols-outlined text-tertiary-container text-sm">
          transform
        </span>
        <span className="font-label-mono text-xs text-tertiary-container">
          变异建议
        </span>
      </div>
      {loading ? (
        <div className="flex items-center gap-2 text-system-log/60 text-xs">
          <span className="material-symbols-outlined text-sm animate-spin">progress_activity</span>
          正在分析最适合的变异方向...
        </div>
      ) : (
        <p className="font-body-narrative text-primary text-sm leading-relaxed">
          {recommendation}
        </p>
      )}
    </div>
  );
}