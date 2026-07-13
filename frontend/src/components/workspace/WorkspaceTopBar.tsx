import { useEffect, useState } from "react";
import WorkspaceModeSwitcher from "./WorkspaceModeSwitcher";
import type { WorkspaceMode } from "../../hooks/useWorkspaceMode";
import api from "../../api/client";
import { useAutopilotSession } from "../../hooks/useAutopilotSession";

interface ProgressSummary {
  done: number;
  total: number;
}

type ProgressColor = "green" | "primary" | "amber" | "gray";

function colorFor(done: number, total: number): ProgressColor {
  if (total === 0 || done === 0) return "gray";
  const pct = done / total;
  if (pct >= 1) return "green";
  if (pct >= 0.5) return "primary";
  if (pct > 0) return "amber";
  return "gray";
}

interface Props {
  projectId: string;
  projectName: string;
  mode: WorkspaceMode;
  onModeChange: (m: WorkspaceMode) => void;
}

export default function WorkspaceTopBar({
  projectId,
  projectName,
  mode,
  onModeChange,
}: Props) {
  const [progress, setProgress] = useState<ProgressSummary | null>(null);
  const { session } = useAutopilotSession(projectId);

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    api
      .getStage4Progress(projectId)
      .then((p) => {
        if (cancelled) return;
        const done = (p.chapters ?? []).filter(
          (c) => c.status === "completed",
        ).length;
        setProgress({ done, total: p.total_chapters ?? 0 });
      })
      .catch(() => {
        if (!cancelled) setProgress({ done: 0, total: 0 });
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const sessionState = session?.state ?? null;
  const showTask =
    sessionState === "running" &&
    !!session?.current_task?.description;

  const badge = (() => {
    if (mode === "manual") return "✍ 手动模式";
    if (sessionState === "paused") return "⏸ 已暂停";
    return "🤖 托管中";
  })();

  const progressText = (() => {
    if (showTask) return `AI 正在 ${session?.current_task?.description ?? ""}`;
    if (!progress) return "—";
    return `${progress.done} / ${progress.total}`;
  })();

  const progressColor: ProgressColor = progress
    ? colorFor(progress.done, progress.total)
    : "gray";

  return (
    <header
      data-testid="workspace-topbar"
      className="flex items-center justify-between gap-4 px-6 py-3 border-b border-outline-variant bg-surface-container-low"
    >
      <div className="flex items-center gap-3 min-w-0">
        {/* v1.8.1: workspace is top-level — give users a way back to the
            project list. Full-page assign (not SPA navigate) so the home
            page re-fetches project stats. */}
        <button
          type="button"
          data-testid="topbar-back-home"
          onClick={() => window.location.assign("/")}
          className="flex items-center gap-1 text-system-log hover:text-primary
                     transition-colors shrink-0"
        >
          <span className="material-symbols-outlined text-lg">arrow_back</span>
          <span className="text-sm font-body-ui">项目中心</span>
        </button>
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
          data-color={progressColor}
          className="font-label-mono text-xs text-system-log shrink-0"
        >
          {progressText}
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
