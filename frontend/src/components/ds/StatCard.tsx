import type { ReactNode } from "react";

export interface StatCardProps {
  label: string;
  value: number | string | null;
  sparkline?: ReactNode;
  size?: "sm" | "md";
  unit?: string;
}

export default function StatCard({
  label,
  value,
  sparkline,
  size = "md",
  unit,
}: StatCardProps) {
  const display = value === null ? "—" : `${value}${unit ?? ""}`;
  const valueClass =
    size === "sm"
      ? "font-mono text-base text-primary"
      : "font-mono text-stats-number text-primary";

  return (
    <div className="bg-surface-container-low border border-outline-variant rounded-lg p-3">
      <div className="font-mono text-label-sm uppercase tracking-wider text-on-surface-variant">
        {label}
      </div>
      <div className={`mt-1 ${valueClass}`}>{display}</div>
      {sparkline && <div className="mt-2">{sparkline}</div>}
    </div>
  );
}
