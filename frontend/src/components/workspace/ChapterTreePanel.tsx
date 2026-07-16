import { useEffect, useState } from "react";
import type { ChapterStatus } from "../../types/chapter";

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

/** Status info for the current chapter's scenes. Keyed by scene_id (e.g. "1-2"). */
export type SceneStatusMap = Record<string, boolean>;

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

interface Props {
  volumes: WorkspaceVolumeGroup[];
  currentChapter: number;
  currentScene: string | null;
  /** Optional per-chapter status map keyed by chapter_number. Omit to hide badges. */
  chapterStatus?: Record<number, ChapterStatus>;
  /** Optional scene-draft availability map keyed by scene_id. Omit to hide dots. */
  sceneStatus?: SceneStatusMap;
  onSelectChapter: (chapter_number: number) => void;
  onSelectScene: (chapter_number: number, scene_id: string) => void;
  /** Pass undefined to hide the "+ 新章节" button (managed mode has no manual chapter-adding workflow). */
  onAddChapter?: () => void;
  onRefresh: () => void;
}

export default function ChapterTreePanel({
  volumes, currentChapter, currentScene, chapterStatus, sceneStatus,
  onSelectChapter, onSelectScene, onAddChapter, onRefresh,
}: Props) {
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

  const renderChapterStatus = (n: number) => {
    const status = chapterStatus?.[n];
    if (status == null) return null;
    if (status === "completed") {
      return <span data-testid={`chapter-status-${n}`} title="已完成"
        className="ml-2 inline-flex items-center justify-center w-4 h-4 rounded-full bg-emerald-100 text-emerald-700 text-[10px]">✓</span>;
    }
    if (status === "writing") {
      return <span data-testid={`chapter-status-${n}`} title="撰写中"
        className="ml-2 inline-flex items-center justify-center w-4 h-4 rounded-full bg-blue-100 text-blue-700 text-[10px]">✎</span>;
    }
    return <span data-testid={`chapter-status-${n}`} title="未写"
      className="ml-2 inline-flex items-center justify-center w-4 h-4 rounded-full bg-gray-100 text-gray-500 text-[10px]">○</span>;
  };

  const renderSceneStatus = (scene_id: string) => {
    const has = sceneStatus?.[scene_id];
    if (has == null) return null;
    return has
      ? <span data-testid={`scene-status-${scene_id}`} title="已写"
          className="mr-1 inline-block w-2 h-2 rounded-full bg-emerald-500 align-middle">●</span>
      : <span data-testid={`scene-status-${scene_id}`} title="未写"
          className="mr-1 inline-block w-2 h-2 rounded-full bg-gray-300 align-middle">○</span>;
  };

  return (
    <div data-testid="chapter-tree" className="p-3 space-y-3 text-sm font-body-ui">
      <div className="sticky top-0 z-10 bg-canvas-bg border-b border-outline-variant -mx-3 px-3 pt-3 pb-2 flex items-center justify-between">
        <span className="font-label-mono text-system-log text-[10px] uppercase tracking-wider">章节</span>
        <div className="flex gap-1">
          <button
            type="button"
            data-testid="refresh"
            onClick={onRefresh}
            className="px-2 py-0.5 rounded text-xs bg-surface-container text-system-log hover:text-primary"
          >刷新</button>
          {onAddChapter && (
            <button
              type="button"
              data-testid="add-chapter"
              onClick={onAddChapter}
              className="px-2 py-0.5 rounded text-xs bg-primary-container text-surface-container-low hover:opacity-90"
            >+ 新章节</button>
          )}
        </div>
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
                          <span className="truncate flex items-center">
                            第 {ch.chapter_number} 章 · {ch.title}
                            {renderChapterStatus(ch.chapter_number)}
                          </span>
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
                                  className={`w-full text-left px-2 py-1 rounded text-xs flex items-center ${
                                    s.scene_id === currentScene
                                      ? "bg-tertiary-container/20 text-primary"
                                      : "text-system-log hover:bg-surface-container hover:text-primary"
                                  }`}
                                >
                                  {renderSceneStatus(s.scene_id)}
                                  <span className="truncate">{s.title}</span>
                                </button>
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
