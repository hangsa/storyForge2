interface ProgressBarProps {
  value: number;
  max?: number;
  label?: string;
  color?: "primary" | "tertiary" | "warning";
}

const barColors = {
  primary: "bg-primary-container",
  tertiary: "bg-tertiary-container",
  warning: "bg-warning-p1",
};

export default function ProgressBar({
  value,
  max = 100,
  label,
  color = "primary",
}: ProgressBarProps) {
  const pct = Math.min(100, Math.max(0, (value / max) * 100));

  return (
    <div className="w-full">
      {label && (
        <div className="flex justify-between mb-1">
          <span className="font-label-mono text-system-log">{label}</span>
          <span className="font-label-mono text-system-log">{Math.round(pct)}%</span>
        </div>
      )}
      <div className="w-full h-1.5 bg-surface-container rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${barColors[color]}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
