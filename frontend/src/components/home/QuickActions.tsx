import { SecondaryButton } from "../ds";

interface QuickActionsProps {
  onRefresh: () => void;
  refreshing: boolean;
  onOpenPlaza?: () => void;
  plazaDisabled?: boolean;
  plazaTooltip?: string;
  onOpenConsole?: () => void;
  consoleDisabled?: boolean;
  consoleTooltip?: string;
  onOpenMore?: () => void;
  /** When true, renders compact icon-only buttons (collapsed sidebar). */
  collapsed?: boolean;
}

export default function QuickActions({
  onRefresh,
  refreshing,
  onOpenPlaza,
  plazaDisabled,
  plazaTooltip,
  onOpenConsole,
  consoleDisabled,
  consoleTooltip,
  onOpenMore,
  collapsed = false,
}: QuickActionsProps) {
  if (collapsed) {
    return (
      <div data-testid="quick-actions" className="flex flex-col gap-2">
        <IconButton icon="smart_toy" disabled={consoleDisabled} tooltip={consoleTooltip} onClick={onOpenConsole} testId="qa-ai-console" />
        <IconButton icon="forum" disabled={plazaDisabled} tooltip={plazaTooltip} onClick={onOpenPlaza} testId="qa-prompt-square" />
        <IconButton icon={refreshing ? "progress_activity" : "refresh"} onClick={onRefresh} testId="qa-refresh" spinning={refreshing} />
        <IconButton icon="more_horiz" onClick={onOpenMore} testId="qa-more" />
      </div>
    );
  }

  return (
    <div data-testid="quick-actions" className="grid grid-cols-2 gap-2">
      <SecondaryButton label="AI 控制台" size="sm" icon="smart_toy" disabled={consoleDisabled} onClick={() => onOpenConsole?.()} testId="qa-ai-console" />
      <SecondaryButton label="提示词广场" size="sm" icon="forum" disabled={plazaDisabled} onClick={() => onOpenPlaza?.()} testId="qa-prompt-square" />
      <SecondaryButton label={refreshing ? "刷新中…" : "刷新"} size="sm" icon={refreshing ? "progress_activity" : "refresh"} onClick={onRefresh} testId="qa-refresh" />
      <SecondaryButton label="更多" size="sm" icon="more_horiz" onClick={() => onOpenMore?.()} testId="qa-more" />
    </div>
  );
}

function IconButton({
  icon, onClick, disabled, tooltip, testId, spinning,
}: {
  icon: string;
  onClick?: () => void;
  disabled?: boolean;
  tooltip?: string;
  testId: string;
  spinning?: boolean;
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      onClick={onClick}
      disabled={disabled}
      title={tooltip}
      className="p-2 rounded bg-surface-container text-primary hover:bg-surface-container-high disabled:opacity-40 disabled:cursor-not-allowed"
    >
      <span className={`material-symbols-outlined text-xl ${spinning ? "animate-spin" : ""}`} aria-hidden="true">
        {icon}
      </span>
    </button>
  );
}