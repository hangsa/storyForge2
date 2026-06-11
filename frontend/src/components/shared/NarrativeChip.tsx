interface NarrativeChipProps {
  label: string;
  value: string;
  color?: "primary" | "secondary" | "tertiary" | "error" | "warning";
}

const colorMap = {
  primary: "bg-primary-container/10 text-primary-container border-primary-container/30",
  secondary: "bg-secondary-container/10 text-secondary border-secondary-container/30",
  tertiary: "bg-tertiary-container/10 text-tertiary-container border-tertiary-container/30",
  error: "bg-error-p0/10 text-error-p0 border-error-p0/30",
  warning: "bg-warning-p1/10 text-warning-p1 border-warning-p1/30",
};

export default function NarrativeChip({ label, value, color = "primary" }: NarrativeChipProps) {
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-mono border ${colorMap[color]}`}>
      <span className="opacity-60">{label}</span>
      <span className="font-medium">{value}</span>
    </span>
  );
}
