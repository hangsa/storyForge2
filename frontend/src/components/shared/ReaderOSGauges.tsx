import GlassPanel from "./GlassPanel";
import ProgressBar from "./ProgressBar";

const READER_OS_METRICS: Array<{ key: string; label: string; good: boolean }> = [
  { key: "addiction", label: "上瘾度", good: true },
  { key: "curiosity", label: "好奇心", good: true },
  { key: "tension", label: "紧张感", good: true },
  { key: "satisfaction", label: "满足感", good: true },
  { key: "discussion", label: "讨论潜力", good: true },
  { key: "fatigue", label: "疲劳度", good: false },
  { key: "frustration", label: "挫败感", good: false },
];

interface ReaderOSGaugesProps {
  readerOS: Record<string, number>;
  warnings?: Array<{ level: string; metric: string; value?: number; hint: string }>;
  className?: string;
}

export default function ReaderOSGauges({ readerOS, warnings, className }: ReaderOSGaugesProps) {
  return (
    <GlassPanel className={className}>
      <h3 className="text-sm font-medium text-white mb-3">读者状态指标</h3>
      <div className="grid grid-cols-2 gap-x-6 gap-y-3">
        {READER_OS_METRICS.map(({ key, label, good }) => (
          <ProgressBar
            key={key}
            label={label}
            value={readerOS[key] ?? 0}
            color={good ? "primary" : "warning"}
          />
        ))}
      </div>
      {warnings && warnings.length > 0 && (
        <div className="mt-4 space-y-1.5">
          {warnings.map((w, i) => (
            <div key={i} className="flex items-center gap-2 text-xs p-2 bg-amber-500/10 border border-amber-500/20 rounded">
              <span className="material-symbols-outlined text-sm text-amber-400">warning</span>
              <span className="text-amber-300 font-label-mono">{w.metric}</span>
              <span className="text-system-log/60">{w.hint}</span>
            </div>
          ))}
        </div>
      )}
    </GlassPanel>
  );
}
