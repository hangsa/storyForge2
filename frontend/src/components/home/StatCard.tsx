interface StatCardProps {
  label: string;
  value: number | null;
  suffix?: string;
  accent?: "primary" | "log" | "container";
}

const ACCENT_CLASS: Record<NonNullable<StatCardProps["accent"]>, string> = {
  primary: "text-primary",
  log: "text-system-log",
  container: "text-primary-container",
};

export default function StatCard({ label, value, suffix, accent = "primary" }: StatCardProps) {
  const display = value === null ? "—" : value.toLocaleString();
  return (
    <div
      data-testid="stat-card"
      data-label={label}
      className="bg-surface-container-low border border-outline-variant rounded-lg px-3 py-2"
    >
      <div className="font-label-mono text-[10px] text-system-log uppercase tracking-wider">
        {label}
      </div>
      <div className={`font-display text-xl mt-0.5 ${ACCENT_CLASS[accent]}`}>
        {display}
        {value !== null && suffix ? (
          <span className="font-label-mono text-xs text-system-log ml-1">{suffix}</span>
        ) : null}
      </div>
    </div>
  );
}