import WorkspaceModeSwitcher from "./WorkspaceModeSwitcher";
import type { WorkspaceMode } from "../../hooks/useWorkspaceMode";

interface Props {
  projectName: string;
  mode: WorkspaceMode;
  onModeChange: (m: WorkspaceMode) => void;
  /** Mock autopilot state — future integration. */
  autopilotState?: "running" | "paused" | null;
}

export default function WorkspaceTopBar({
  projectName,
  mode,
  onModeChange,
  autopilotState = null,
}: Props) {
  const badge = (() => {
    if (mode === "manual") return "✍ 手动模式";
    if (autopilotState === "paused") return "⏸ 已暂停";
    return "🤖 托管中";
  })();

  return (
    <header
      data-testid="workspace-topbar"
      className="flex items-center justify-between gap-4 px-6 py-3 border-b border-outline-variant bg-surface-container-low"
    >
      <div className="flex items-center gap-3 min-w-0">
        <h1 data-testid="topbar-project-name" className="font-display text-primary truncate">
          {projectName}
        </h1>
        <span
          data-testid="topbar-mode-badge"
          className="text-xs px-2 py-0.5 rounded-full bg-surface-container text-system-log font-body-ui shrink-0"
        >
          {badge}
        </span>
        <span
          data-testid="topbar-progress"
          className="font-label-mono text-xs text-system-log shrink-0"
        >
          {/* Future: progress ring + word count + elapsed time */}
          —
        </span>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        <button
          type="button"
          data-testid="topbar-ai-tools"
          disabled
          className="px-3 py-1 text-sm rounded-lg bg-surface-container text-system-log/50 cursor-not-allowed"
        >
          AI 工具
        </button>
        <WorkspaceModeSwitcher mode={mode} onChange={onModeChange} />
      </div>
    </header>
  );
}