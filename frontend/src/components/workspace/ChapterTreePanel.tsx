import { useEffect, useState } from "react";

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
  onSelectChapter: (chapter_number: number) => void;
  onSelectScene: (chapter_number: number, scene_id: string) => void;
  onAddChapter: () => void;
  onRefresh: () => void;
}

const VIEW_MODES: { value: ViewMode; label: string }[] = [
  { value: "flat", label: "扁平" },
  { value: "tree", label: "树形" },
  { value: "act", label: "按幕" },
];

export default function ChapterTreePanel({
  volumes, currentChapter, currentScene, onSelectChapter, onSelectScene, onAddChapter, onRefresh,
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
        {volumes.map((vol) => {
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
              {isOpen && (
                <ul className="space-y-1 pl-2">
                  {vol.chapters.map((ch) => {
                    const isCurrent = ch.chapter_number === currentChapter;
                    return (
                      <li key={ch.chapter_number}>
                        <button
                          type="button"
                          data-testid={`chapter-${ch.chapter_number}`}
                          onClick={() => onSelectChapter(ch.chapter_number)}
                          className={`w-full text-left px-2 py-1.5 rounded transition-colors flex items-center justify-between ${
                            isCurrent ? "bg-primary-container/10 text-primary-container font-medium" : "text-primary hover:bg-surface-container"
                          }`}
                        >
                          <span className="truncate">第 {ch.chapter_number} 章 · {ch.title}</span>
                          {isCurrent && <span className="text-[10px] text-system-log/70">{ch.scenes.length} 场景</span>}
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
                  })}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
