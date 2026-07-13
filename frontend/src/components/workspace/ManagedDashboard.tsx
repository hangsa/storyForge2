import { useAutopilotSession } from "../../hooks/useAutopilotSession";
import type { ManagedStartConfig } from "./ManagedStartModal";
import ManagedStatusStrip from "./ManagedStatusStrip";

export type ChapterStatus = "completed" | "writing" | "planned" | "pending";

export interface DashboardChapter {
  chapter_number: number;
  status: ChapterStatus;
}

interface Props {
  projectId: string;
  chapters: DashboardChapter[];
  onChapterClick: (chapter_number: number, status: ChapterStatus) => void;
  onAddChapter: () => void;
  onRefresh: () => void;
}

const STATUS_CLASS: Record<ChapterStatus, string> = {
  completed: "bg-emerald-100 border-emerald-400 text-emerald-700",
  writing: "bg-blue-100 border-blue-400 text-blue-700",
  planned: "bg-amber-100 border-amber-400 text-amber-700",
  pending: "bg-surface-container-low border-dashed border-outline-variant text-system-log/50",
};

const STATUS_LABEL: Record<ChapterStatus, string> = {
  completed: "✓",
  writing: "✎",
  planned: "📋",
  pending: "⏳",
};

// v1.9 default startup config — applied when the user clicks ▶ 启动托管
// without first opening the ManagedStartModal. Mirrors the modal's balanced
// defaults so the toggle button is a valid one-click shortcut.
const DEFAULT_START_CONFIG: ManagedStartConfig = {
  scope: "all_planned",
  cadence: "balanced",
  policy: "auto",
  notify: "milestones",
};

export default function ManagedDashboard({
  projectId, chapters, onChapterClick, onAddChapter, onRefresh,
}: Props) {
  const { session, start, stop } = useAutopilotSession(projectId);
  const active = session?.state === "running";
  const currentTask = session?.current_task?.description;

  const onToggle = () => {
    if (active) {
      void stop();
    } else {
      void start(DEFAULT_START_CONFIG);
    }
  };

  return (
    <div data-testid="managed-dashboard" className="space-y-4 p-6">
      {active && currentTask && <ManagedStatusStrip currentTask={currentTask} />}

      <div className="flex items-center justify-between">
        <h2 className="font-display text-primary text-lg">章节目录</h2>
        <div className="flex gap-2">
          <button
            type="button"
            data-testid="autopilot-toggle"
            onClick={onToggle}
            className={
              active
                ? "px-3 py-1.5 text-sm rounded-lg bg-error/90 text-surface-container-low hover:opacity-90"
                : "px-3 py-1.5 text-sm rounded-lg bg-primary-container text-surface-container-low hover:opacity-90"
            }
          >
            {active ? "⏸ 停止托管" : "▶ 启动托管"}
          </button>
          <button
            type="button"
            data-testid="refresh"
            onClick={onRefresh}
            className="px-3 py-1.5 text-sm rounded-lg bg-surface-container text-system-log hover:bg-surface-container-low"
          >
            刷新
          </button>
          <button
            type="button"
            data-testid="add-chapter"
            onClick={onAddChapter}
            className="px-3 py-1.5 text-sm rounded-lg bg-surface-container text-system-log hover:bg-surface-container-low"
          >
            + 新章节
          </button>
        </div>
      </div>

      <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))" }}>
        {chapters.map((c) => (
          <button
            key={c.chapter_number}
            type="button"
            data-testid={`chapter-cell-${c.chapter_number}`}
            onClick={() => onChapterClick(c.chapter_number, c.status)}
            className={`min-h-[80px] rounded-lg border-2 p-3 text-left transition-transform hover:scale-[1.02] ${STATUS_CLASS[c.status]}`}
          >
            <div className="text-2xl">{STATUS_LABEL[c.status]}</div>
            <div className="font-display mt-1">第 {c.chapter_number} 章</div>
          </button>
        ))}
      </div>
    </div>
  );
}
