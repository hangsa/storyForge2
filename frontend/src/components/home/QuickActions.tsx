interface QuickActionsProps {
  onRefresh: () => void;
  refreshing: boolean;
}

interface Action {
  label: string;
  icon: string;
  onClick?: () => void;
  disabled?: boolean;
  tooltip?: string;
  testId: string;
}

export default function QuickActions({ onRefresh, refreshing }: QuickActionsProps) {
  const actions: Action[] = [
    {
      label: "AI 控制台",
      icon: "smart_toy",
      disabled: true,
      tooltip: "即将推出",
      testId: "qa-ai-console",
    },
    {
      label: "提示词广场",
      icon: "forum",
      disabled: true,
      tooltip: "即将推出",
      testId: "qa-prompt-square",
    },
    {
      label: refreshing ? "刷新中…" : "刷新列表",
      icon: refreshing ? "progress_activity" : "refresh",
      onClick: onRefresh,
      testId: "qa-refresh",
    },
    {
      label: "更多",
      icon: "more_horiz",
      disabled: true,
      tooltip: "即将推出",
      testId: "qa-more",
    },
  ];

  return (
    <div data-testid="quick-actions" className="grid grid-cols-2 gap-2">
      {actions.map((a) => {
        const className = [
          "flex flex-col items-center gap-1 px-2 py-3 rounded-lg border text-xs",
          a.disabled
            ? "border-outline-variant bg-surface-container text-system-log/40 cursor-not-allowed"
            : "border-outline-variant bg-surface-container-low text-primary hover:border-primary-container/40 cursor-pointer",
        ].join(" ");
        return (
          <button
            key={a.testId}
            data-testid={a.testId}
            onClick={a.onClick}
            disabled={a.disabled}
            title={a.tooltip}
            className={className}
          >
            <span
              className={`material-symbols-outlined text-xl ${refreshing && a.testId === "qa-refresh" ? "animate-spin" : ""}`}
            >
              {a.icon}
            </span>
            <span className="font-label-mono">{a.label}</span>
          </button>
        );
      })}
    </div>
  );
}
