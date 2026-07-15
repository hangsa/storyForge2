import { useEffect, useState } from "react";

export type ChapterStatus = "completed" | "writing" | "planned" | "pending";

export interface WorkspaceSceneNode {
  scene_id: string;
  title: string;
  goal?: string;
  conflict?: string;
  emotional_arc?: string;
  narrative_role?: string;
  beat_type?: string;
}
export interface WorkspaceChapterNode {
  chapter_number: number;
  title: string;
  theme?: string;
  scenes: WorkspaceSceneNode[];
}

/** A pre-computed volume group, derived from novel_outline.json in the
 *  parent. Pass a single "ungrouped" volume when there's no novel_outline
 *  (so the panel can still render a single header instead of a flat list). */
export interface WorkspaceVolumeGroup {
  /** Volume name, e.g. "第一卷" or "未分组" when no novel_outline. */
  name: string;
  /** Volume chapter range, e.g. "1-30". Empty string for ungrouped. */
  chapter_range: string;
  /** Volume summary (optional). */
  summary?: string;
  /** Chapters in this volume. */
  chapters: WorkspaceChapterNode[];
}

type ViewMode = "flat" | "tree" | "act";

interface Props {
  volumes: WorkspaceVolumeGroup[];
  currentChapter: number;
  currentScene: string | null;
  /** Optional per-chapter completion status (from progress.json). When
   *  present, a small badge is rendered next to the chapter title. */
  chapterStatus?: Record<number, ChapterStatus>;
  /** When true (default), chapters are grouped under their volume headers
   *  with per-volume summary + collapse state. When false, the panel renders
   *  a flat chapter list — the workspace's left column uses this since
   *  the user is editing one chapter at a time, not browsing the volume
   *  outline. */
  showVolumes?: boolean;
  onSelectChapter: (chapter_number: number) => void;
  onSelectScene: (chapter_number: number, scene_id: string) => void;
  onAddChapter: () => void;
  onRefresh: () => void;
}

const STATUS_LABEL: Record<ChapterStatus, string> = {
  completed: "✓",
  writing: "✎",
  planned: "📋",
  pending: "⏳",
};

const STATUS_CLASS: Record<ChapterStatus, string> = {
  completed: "bg-emerald-100 text-emerald-700",
  writing: "bg-blue-100 text-blue-700",
  planned: "bg-amber-100 text-amber-700",
  pending: "bg-surface-container text-system-log/60",
};

const STATUS_TOOLTIP: Record<ChapterStatus, string> = {
  completed: "已完成",
  writing: "撰写中",
  planned: "已规划",
  pending: "待规划",
};

const VIEW_MODES: { value: ViewMode; label: string }[] = [
  { value: "flat", label: "扁平" },
  { value: "tree", label: "树形" },
  { value: "act", label: "按幕" },
];

export default function ChapterTreePanel({
  volumes, currentChapter, currentScene, chapterStatus, showVolumes = true,
  onSelectChapter, onSelectScene, onAddChapter, onRefresh,
}: Props) {
  const [viewMode, setViewMode] = useState<ViewMode>("flat");

  // Track which volumes are open. The useState initializer runs only on
  // first mount — when the workspace's async load later populates `volumes`,
  // we still need the user to see the chapters, so an effect below opens any
  // newly-arrived volume.
  const [open, setOpen] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {};
    for (const v of volumes) init[v.name] = true;
    return init;
  });
  // Open any volume that newly appears (e.g. when the async getOutline /
  // getNovelOutline resolves after first render). The `open` map is the
  // source of truth for collapsed/expanded state, so we only ever add to it
  // here — the user can still collapse a volume manually.
  useEffect(() => {
    setOpen((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const v of volumes) {
        if (!(v.name in next)) {
          next[v.name] = true;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [volumes]);
  useEffect(() => {
    // When the current chapter changes, ensure its volume is open.
    const containing = volumes.find((v) => v.chapters.some((c) => c.chapter_number === currentChapter));
    if (containing && !open[containing.name]) {
      setOpen((prev) => ({ ...prev, [containing.name]: true }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentChapter]);

  const renderChapterRow = (ch: WorkspaceChapterNode) => {
    const isCurrent = ch.chapter_number === currentChapter;
    const status = chapterStatus?.[ch.chapter_number];
    return (
      <li key={ch.chapter_number}>
        <button
          type="button"
          data-testid={`chapter-${ch.chapter_number}`}
          onClick={() => onSelectChapter(ch.chapter_number)}
          className={`w-full text-left px-2 py-1.5 rounded transition-colors flex items-center justify-between gap-2 ${
            isCurrent ? "bg-primary-container/10 text-primary-container font-medium" : "text-primary hover:bg-surface-container"
          }`}
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
          {isCurrent && <span className="text-[10px] text-system-log/70 shrink-0">{ch.scenes.length} 场景</span>}
        </button>
        {isCurrent && (
          <ul className="ml-3 mt-1 space-y-0.5 border-l border-outline-variant pl-2">
            {ch.scenes.map((s) => (
              <li key={s.scene_id}>
                <button
                  type="button"
                  data-testid={`scene-${s.scene_id}`}
                  onClick={() => onSelectScene(ch.chapter_number, s.scene_id)}
                  className={`w-full text-left px-2 py-1 rounded text-xs ${
                    s.scene_id === currentScene
                      ? "bg-tertiary-container/20 text-primary"
                      : "text-system-log hover:bg-surface-container hover:text-primary"
                  }`}
                >{s.title}</button>
              </li>
            ))}
          </ul>
        )}
      </li>
    );
  };

  return (
    <div data-testid="chapter-tree" className="p-3 space-y-3 text-sm font-body-ui">
      <div className="flex items-center justify-between">
        <span className="font-label-mono text-system-log text-[10px] uppercase tracking-wider">章节</span>
        <div className="flex gap-1">
          <button
            type="button"
            data-testid="refresh"
            onClick={onRefresh}
            className="px-2 py-0.5 rounded text-xs bg-surface-container text-system-log hover:text-primary"
          >刷新</button>
          <button
            type="button"
            data-testid="add-chapter"
            onClick={onAddChapter}
            className="px-2 py-0.5 rounded text-xs bg-primary-container text-surface-container-low hover:opacity-90"
          >+ 新章节</button>
        </div>
      </div>

      <div className="flex rounded border border-outline-variant overflow-hidden text-xs">
        {VIEW_MODES.map((m) => (
          <button
            key={m.value}
            type="button"
            data-testid={`view-mode-${m.value}`}
            onClick={() => setViewMode(m.value)}
            className={`flex-1 py-1 font-body-ui transition-colors ${
              viewMode === m.value
                ? "bg-primary-container text-surface-container-low"
                : "text-system-log hover:bg-surface-container"
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>

      <div className="space-y-3">
        {showVolumes ? (
          volumes.map((vol) => {
            const isOpen = open[vol.name] ?? false;
            return (
              <div key={vol.name} data-testid={`volume-${vol.name}`} className="space-y-1">
                <button
                  type="button"
                  data-testid={`volume-${vol.name}-header`}
                  onClick={() => setOpen((prev) => ({ ...prev, [vol.name]: !isOpen }))}
                  className="w-full text-left px-2 py-1 rounded bg-surface-container text-primary flex items-center justify-between"
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
                    {vol.chapters.map((ch) => renderChapterRow(ch))}
                  </ul>
                )}
              </div>
            );
          })
        ) : (
          <ul className="space-y-1" data-testid="chapter-flat-list">
            {volumes.flatMap((v) => v.chapters).map((ch) => renderChapterRow(ch))}
          </ul>
        )}
      </div>
    </div>
  );
}
