import { useEffect, useState } from "react";
import { useAutopilotSession } from "../../hooks/useAutopilotSession";
import ManagedStatusStrip from "./ManagedStatusStrip";
import type { ChapterStatus, WorkspaceVolumeGroup } from "./ChapterTreePanel";

export type { ChapterStatus };

export interface DashboardChapter {
  chapter_number: number;
  status: ChapterStatus;
}

interface Props {
  projectId: string;
  chapters: DashboardChapter[];
  /** Volume groups (with title + scene counts) — same shape ChapterTreePanel
   *  consumes. When omitted (e.g. outline not yet loaded), we fall back to
   *  a single "未分组" group from `chapters` so the panel is still useful. */
  volumes?: WorkspaceVolumeGroup[];
  /** When true (default), chapters are grouped under their volume headers
   *  with per-volume summary + collapse state. When false, the panel renders
   *  a flat chapter list — the workspace's left column uses this since
   *  the user is editing one chapter at a time, not browsing the volume
   *  outline. */
  showVolumes?: boolean;
  onChapterClick: (chapter_number: number, status: ChapterStatus) => void;
  onAddChapter: () => void;
  onRefresh: () => void;
}

const STATUS_CLASS: Record<ChapterStatus, string> = {
  completed: "bg-emerald-100 text-emerald-700",
  writing: "bg-blue-100 text-blue-700",
  planned: "bg-amber-100 text-amber-700",
  pending: "bg-surface-container text-system-log/60",
};

const STATUS_LABEL: Record<ChapterStatus, string> = {
  completed: "✓",
  writing: "✎",
  planned: "📋",
  pending: "⏳",
};

const STATUS_TOOLTIP: Record<ChapterStatus, string> = {
  completed: "已完成",
  writing: "撰写中",
  planned: "已规划",
  pending: "待规划",
};

function fallbackVolumes(chapters: DashboardChapter[]): WorkspaceVolumeGroup[] {
  if (chapters.length === 0) return [];
  return [
    {
      name: "未分组",
      chapter_range: "",
      summary: undefined,
      chapters: chapters.map((c) => ({
        chapter_number: c.chapter_number,
        title: `第 ${c.chapter_number} 章`,
        scenes: [],
      })),
    },
  ];
}

export default function ManagedDashboard({
  projectId, chapters, volumes, showVolumes = true,
  onChapterClick, onAddChapter, onRefresh,
}: Props) {
  const { session } = useAutopilotSession(projectId);
  const active = session?.state === "running";
  // Treat empty-string description as absent so a transient state transition
  // doesn't briefly hide the strip.
  const currentTaskDesc = session?.current_task?.description;
  const currentTask = currentTaskDesc !== undefined && currentTaskDesc !== ""
    ? currentTaskDesc
    : null;

  // Map chapter_number → status (so we can look up from the volume row).
  const statusByChapter: Record<number, ChapterStatus> = {};
  for (const c of chapters) statusByChapter[c.chapter_number] = c.status;

  const effectiveVolumes = (volumes && volumes.length > 0)
    ? volumes
    : fallbackVolumes(chapters);

  // Track which volumes are open. Auto-open on first mount + whenever a
  // new volume arrives (mirrors ChapterTreePanel's UX).
  const [open, setOpen] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {};
    for (const v of effectiveVolumes) init[v.name] = true;
    return init;
  });
  useEffect(() => {
    setOpen((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const v of effectiveVolumes) {
        if (!(v.name in next)) {
          next[v.name] = true;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [effectiveVolumes]);

  const renderChapterRow = (ch: WorkspaceVolumeGroup["chapters"][number], status: ChapterStatus | undefined) => (
    <li key={ch.chapter_number}>
      <button
        type="button"
        data-testid={`chapter-${ch.chapter_number}`}
        onClick={() => onChapterClick(ch.chapter_number, status ?? "planned")}
        className="w-full text-left px-2 py-1.5 rounded transition-colors flex items-center justify-between gap-2 text-primary hover:bg-surface-container"
      >
        <span className="truncate flex items-center gap-2 min-w-0">
          <span className="truncate">第 {ch.chapter_number} 章 · {ch.title}</span>
          {status && (
            <span
              data-testid={`chapter-status-${ch.chapter_number}`}
              title={STATUS_TOOLTIP[status]}
              className={`shrink-0 text-[10px] px-1.5 py-0.5 rounded-full font-label-mono leading-none ${STATUS_CLASS[status]}`}
            >
              {STATUS_LABEL[status]}
            </span>
          )}
        </span>
        {ch.scenes.length > 0 && (
          <span className="text-[10px] text-system-log/70 shrink-0">{ch.scenes.length} 场景</span>
        )}
      </button>
    </li>
  );

  return (
    <div data-testid="managed-dashboard" className="space-y-4 p-6">
      {active && currentTask && <ManagedStatusStrip currentTask={currentTask} />}

      <div className="flex items-center justify-between">
        <h2 className="font-display text-primary text-lg">章节目录</h2>
        <div className="flex gap-2">
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

      {effectiveVolumes.length === 0 ? (
        <p className="text-sm font-body-ui text-system-log/60 italic">
          — 暂无章节 —
        </p>
      ) : showVolumes ? (
        <div className="space-y-3">
          {effectiveVolumes.map((vol) => {
            const isOpen = open[vol.name] ?? false;
            return (
              <div key={vol.name} data-testid={`volume-${vol.name}`} className="space-y-1">
                <button
                  type="button"
                  data-testid={`volume-${vol.name}-header`}
                  onClick={() => setOpen((prev) => ({ ...prev, [vol.name]: !isOpen }))}
                  className="w-full text-left px-3 py-2 rounded bg-surface-container text-primary flex items-center justify-between"
                >
                  <span className="font-label-mono text-xs">
                    <span className="text-system-log/70 mr-1">{isOpen ? "▾" : "▸"}</span>
                    {vol.name}{vol.chapter_range ? ` · 第 ${vol.chapter_range} 章` : ""}
                  </span>
                  <span className="text-[10px] text-system-log/70">{vol.chapters.length} 章</span>
                </button>
                {vol.summary && isOpen && (
                  <p
                    data-testid={`volume-${vol.name}-summary`}
                    className="font-body-ui text-system-log/70 text-xs italic pl-2"
                  >
                    {vol.summary}
                  </p>
                )}
                {isOpen && (
                  <ul className="space-y-1 pl-2">
                    {vol.chapters.map((ch) => renderChapterRow(ch, statusByChapter[ch.chapter_number]))}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <ul className="space-y-1" data-testid="chapter-flat-list">
          {effectiveVolumes.flatMap((v) => v.chapters).map((ch) => renderChapterRow(ch, statusByChapter[ch.chapter_number]))}
        </ul>
      )}
    </div>
  );
}
