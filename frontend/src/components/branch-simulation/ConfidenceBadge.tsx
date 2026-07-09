interface ConfidenceBadgeProps {
  confidence: "high" | "medium" | "low";
}

const CONFIDENCE_CONFIG: Record<string, { icon: string; label: string; className: string }> = {
  high: {
    icon: "🟢",
    label: "高置信度",
    className: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30",
  },
  medium: {
    icon: "🟡",
    label: "中置信度",
    className: "bg-amber-500/10 text-amber-400 border-amber-500/30",
  },
  low: {
    icon: "🟠",
    label: "低置信度",
    className: "bg-orange-500/10 text-orange-400 border-orange-500/30",
  },
};

export default function ConfidenceBadge({ confidence }: ConfidenceBadgeProps) {
  const config = CONFIDENCE_CONFIG[confidence] || CONFIDENCE_CONFIG.low;

  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-xs font-label-mono ${config.className}`}
    >
      {config.icon} {config.label}
    </span>
  );
}
