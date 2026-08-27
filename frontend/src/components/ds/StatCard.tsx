import type { ReactNode } from "react";

export interface StatCardProps {
  label: string;
  value: number | string | null;
  sparkline?: ReactNode;
  size?: "sm" | "md";
  unit?: string;
  /** Optional small text rendered to the right of the label, e.g. "Total". */
  sublabel?: string;
}

export default function StatCard({
  label,
  value,
  sparkline,
  size = "md",
  unit,
  sublabel,
}: StatCardProps) {
  const display = value === null ? "—" : `${value}${unit ?? ""}`;
  const valueClass =
    size === "sm"
      ? "font-mono text-base text-primary"
      : "font-mono text-stats-number text-primary";

  return (
    <div className="bg-surface-container-low border border-outline-variant rounded-lg p-3">
      <div className="flex items-baseline justify-between gap-2">
        <div className="font-mono text-label-sm uppercase tracking-wider text-on-surface-variant">
          {label}
        </div>
        {sublabel && (
          <div className="font-body text-[10px] text-on-surface-variant/70">
            {sublabel}
          </div>
        )}
      </div>
      <div className={`mt-1 ${valueClass}`}>{display}</div>
      {sparkline && <div className="mt-2">{sparkline}</div>}
    </div>
  );
}