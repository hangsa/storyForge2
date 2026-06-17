interface StatusBadgeProps {
  status: string;
  className?: string;
}

const STATUS_STYLES: Record<string, string> = {
  active: "bg-blue-500/20 text-blue-300 border-blue-500/30",
  pending: "bg-blue-500/20 text-blue-300 border-blue-500/30",
  accumulating: "bg-blue-500/20 text-blue-300 border-blue-500/30",
  resolved: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
  fulfilled: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
  revealed: "bg-purple-500/20 text-purple-300 border-purple-500/30",
  completed: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
  escalating: "bg-amber-500/20 text-amber-300 border-amber-500/30",
  developing: "bg-amber-500/20 text-amber-300 border-amber-500/30",
  dormant: "bg-slate-500/20 text-slate-400 border-slate-500/30",
  dead: "bg-slate-500/20 text-slate-400 border-slate-500/30",
  blocked: "bg-red-500/20 text-red-300 border-red-500/30",
  hidden: "bg-purple-500/20 text-purple-300 border-purple-500/30",
  planted: "bg-purple-500/20 text-purple-300 border-purple-500/30",
  critical: "bg-red-500/20 text-red-300 border-red-500/30",
  moderate: "bg-amber-500/20 text-amber-300 border-amber-500/30",
  minor: "bg-blue-500/20 text-blue-300 border-blue-500/30",
};

export default function StatusBadge({ status, className }: StatusBadgeProps) {
  const style = STATUS_STYLES[status] || "bg-surface-container text-system-log border-outline-variant";

  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-label-mono border ${style} ${className || ""}`}
    >
      {status}
    </span>
  );
}
