import { useEffect, useMemo, useRef, useState } from "react";
import api, { type NovelOutline, type Outline } from "../../../api/client";
import {
  computePlannedTotal,
  groupChaptersByVolume,
  type WorkspaceChapterNode,
} from "../../../utils/outline";
import { useAutoHeight } from "../../../hooks/useAutoHeight";
import { useToast } from "../../../hooks/useToast";
import ChapterRangeRegenerateModal from "./ChapterRangeRegenerateModal";

interface BaseEditorProps {
  projectId: string;
  data: unknown;
  /** Novel-level outline (with volumes[]). When provided, chapter rows are
   *  grouped under their owning volume header. When null/undefined, all
   *  chapters fall under a single "未分组" section. */
  novelOutline?: NovelOutline | null;
  onSaved: () => void;
  readOnly?: boolean;
}

const EMPTY: Outline = { chapters: [] };

function readOutline(data: unknown): Outline | null {
  if (data === undefined) return null; // loading
  if (!data || typeof data !== "object") return EMPTY;
  const raw = data as Partial<Outline>;
  return { chapters: Array.isArray(raw.chapters) ? raw.chapters : [] };
}

function toNode(ch: Outline["chapters"][number]): WorkspaceChapterNode {
  // groupChaptersByVolume only reads chapter_number, but the WorkspaceChapterNode
  // shape requires scenes — supply an empty array since this editor doesn't
  // surface scenes (scene editing lives in the left tree panel, v2.1).
  return {
    chapter_number: ch.chapter_number,
    title: ch.title,
    theme: ch.theme,
    scenes: [],
  };
}

export default function ChapterOutlineEditor({ projectId, data, novelOutline, onSaved, readOnly }: BaseEditorProps) {
  const initial = readOutline(data);
  const [outline, setOutline] = useState<Outline>(() => initial ?? EMPTY);
  const [lastSavedOutline, setLastSavedOutline] = useState<Outline>(() => initial ?? EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showRangeModal, setShowRangeModal] = useState(false);
  const [rangeBusy, setRangeBusy] = useState(false);
  const { show } = useToast();
  const outlineRef = useRef(outline);
  outlineRef.current = outline;

  useEffect(() => {
    const next = readOutline(data);
    if (next !== null) {
      setOutline(next);
      setLastSavedOutline(next);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const handleSave = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.updateOutline(projectId, outlineRef.current);
      setLastSavedOutline(outlineRef.current);
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存失败");
    } finally {
      setBusy(false);
    }
  };

  const handleCancel = () => {
    setOutline(lastSavedOutline);
    setError(null);
  };

  // Cap for the range modal: the highest chapter number covered by any volume
  // in the novel outline. 0 when the outline is missing/unparseable, in which
  // case we fall back to the chapter count we actually have loaded.
  const plannedTotal = useMemo(() => {
    const fromVolumes = computePlannedTotal(novelOutline ?? null);
    return fromVolumes > 0 ? fromVolumes : outline.chapters.length;
  }, [novelOutline, outline.chapters.length]);

  const handleRangeConfirm = async (start: number, end: number, mods: string) => {
    setRangeBusy(true);
    try {
      const result = await api.regenerateChapterOutlineRange(projectId, start, end, mods);
      // Regeneration rewrites the on-disk outline; adopt the server's copy as
      // the new saved baseline so the dirty indicator doesn't fire spuriously.
      const next = readOutline(result);
      if (next) {
        setOutline(next);
        setLastSavedOutline(next);
      }
      setShowRangeModal(false);
      show(`第 ${start}-${end} 章已重新生成`);
    } catch (e) {
      show(`重新生成章节大纲失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setRangeBusy(false);
    }
  };

  const dirty = JSON.stringify(outline) !== JSON.stringify(lastSavedOutline);

  // Group chapters by their owning volume for display. When novelOutline is
  // missing or malformed, all chapters fall into a single "未分组" group so
  // the editor remains usable on early-stage projects. Computed before the
  // early-return branches below so hook order stays stable across renders.
  const groups = useMemo(
    () => groupChaptersByVolume(
      outline.chapters.map(toNode),
      novelOutline ?? null,
    ),
    [outline.chapters, novelOutline],
  );
  const chapterByNumber = useMemo(() => {
    const m = new Map<number, Outline["chapters"][number]>();
    for (const ch of outline.chapters) m.set(ch.chapter_number, ch);
    return m;
  }, [outline.chapters]);

  if (initial === null) {
    return (
      <div data-testid="chapter-outline-loading" className="font-body-ui text-system-log text-sm">
        加载中…
      </div>
    );
  }

  if (outline.chapters.length === 0) {
    return (
      <div data-testid="chapter-outline-editor" className="space-y-3">
        <p data-testid="chapter-outline-empty" className="font-body-ui text-system-log text-sm">
          尚未生成章节大纲 — 请到 Stage3 生成。
        </p>
      </div>
    );
  }

  const updateChapter = (n: number, patch: Partial<Outline["chapters"][number]>) => {
    setOutline((prev) => ({
      ...prev,
      chapters: prev.chapters.map((c) => (c.chapter_number === n ? { ...c, ...patch } : c)),
    }));
  };

  return (
    <div data-testid="chapter-outline-editor" className="space-y-4">
      {!readOnly && (
        <div className="flex items-center justify-end">
          <button
            type="button"
            data-testid="chapter-outline-range-regenerate"
            onClick={() => setShowRangeModal(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs bg-surface-container text-system-log rounded-lg hover:bg-surface-container-low"
          >
            <span className="material-symbols-outlined text-[14px]">refresh</span>
            重新生成章节大纲
          </button>
        </div>
      )}
      {groups.map((g, gIdx) => (
        <section
          key={`${g.name}-${gIdx}`}
          data-testid={`volume-group-${gIdx}`}
          className="space-y-2"
        >
          <header className="flex items-baseline gap-2 pb-1 border-b border-outline-variant">
            <h3
              data-testid={`volume-name-${gIdx}`}
              className="font-body-ui text-sm text-primary"
            >
              {g.name}
            </h3>
            {g.chapter_range && (
              <span
                data-testid={`volume-range-${gIdx}`}
                className="font-label-mono text-[10px] uppercase tracking-wider text-system-log"
              >
                第 {g.chapter_range} 章
              </span>
            )}
          </header>
          <div className="space-y-2">
            {g.chapters.map((node) => {
              const ch = chapterByNumber.get(node.chapter_number);
              if (!ch) return null;
              return (
                <ChapterRow
                  key={ch.chapter_number}
                  chapter={ch}
                  onUpdate={(patch) => updateChapter(ch.chapter_number, patch)}
                  readOnly={readOnly}
                />
              );
            })}
          </div>
        </section>
      ))}
      {error && (
        <div data-testid="chapter-outline-editor-error" className="p-2 bg-error-container/20 border border-error rounded text-error font-body-ui text-xs">
          {error}
        </div>
      )}
      <footer className="flex items-center justify-end gap-2 pt-2">
        {dirty && (
          <span data-testid="chapter-outline-editor-dirty" className="text-xs text-system-log mr-auto">未保存修改</span>
        )}
        <button
          type="button"
          data-testid="chapter-outline-editor-cancel"
          onClick={handleCancel}
          disabled={busy || !dirty}
          className="px-3 py-1 text-xs bg-surface-container text-system-log rounded-lg hover:bg-surface-container-low disabled:opacity-40"
        >取消</button>
        <button
          type="button"
          data-testid="chapter-outline-editor-save"
          onClick={handleSave}
          disabled={busy || readOnly || !dirty}
          title={readOnly ? "托管运行中,元数据已锁定" : undefined}
          className="px-4 py-1 text-xs bg-tertiary-container text-surface-container-low rounded-lg hover:opacity-90 disabled:opacity-40"
        >{busy ? "保存中…" : "保存"}</button>
      </footer>
      <ChapterRangeRegenerateModal
        open={showRangeModal}
        chapterCount={plannedTotal}
        onConfirm={handleRangeConfirm}
        onCancel={() => setShowRangeModal(false)}
        busy={rangeBusy}
      />
    </div>
  );
}

function ChapterRow({
  chapter, onUpdate, readOnly,
}: {
  chapter: Outline["chapters"][number];
  onUpdate: (patch: Partial<Outline["chapters"][number]>) => void;
  readOnly?: boolean;
}) {
  const themeRef = useRef<HTMLTextAreaElement>(null);
  useAutoHeight(themeRef, [chapter.theme ?? ""]);
  return (
    <div data-testid={`chapter-row-${chapter.chapter_number}`} className="border border-outline-variant rounded-lg p-2 space-y-2">
      <span className="font-label-mono text-system-log text-[10px] uppercase tracking-wider">
        第 {chapter.chapter_number} 章
      </span>
      <div>
        <label className="block font-label-mono text-system-log mb-1 text-xs">章节标题</label>
        <input
          data-testid={`chapter-${chapter.chapter_number}-title`}
          value={chapter.title}
          onChange={(e) => onUpdate({ title: e.target.value })}
          disabled={readOnly}
          className="w-full bg-surface-container border border-outline-variant rounded px-2 py-1 text-sm text-primary focus:outline-none focus:border-primary-container"
        />
      </div>
      <div>
        <label className="block font-label-mono text-system-log mb-1 text-xs">本章主题</label>
        <textarea
          ref={themeRef}
          data-testid={`chapter-${chapter.chapter_number}-theme`}
          value={chapter.theme ?? ""}
          onChange={(e) => onUpdate({ theme: e.target.value })}
          disabled={readOnly}
          className="w-full bg-surface-container border border-outline-variant rounded px-2 py-1 text-xs text-primary focus:outline-none focus:border-primary-container"
        />
      </div>
    </div>
  );
}