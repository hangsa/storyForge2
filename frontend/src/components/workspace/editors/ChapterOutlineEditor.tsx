import { useEffect, useRef, useState } from "react";
import api, { type Outline } from "../../../api/client";
import { useAutoHeight } from "../../../hooks/useAutoHeight";

interface BaseEditorProps {
  projectId: string;
  data: unknown;
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

export default function ChapterOutlineEditor({ projectId, data, onSaved, readOnly }: BaseEditorProps) {
  const initial = readOutline(data);
  const [outline, setOutline] = useState<Outline>(() => initial ?? EMPTY);
  const [lastSavedOutline, setLastSavedOutline] = useState<Outline>(() => initial ?? EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
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

  const dirty = JSON.stringify(outline) !== JSON.stringify(lastSavedOutline);

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
    <div data-testid="chapter-outline-editor" className="space-y-3">
      {outline.chapters.map((ch) => (
        <ChapterRow
          key={ch.chapter_number}
          chapter={ch}
          onUpdate={(patch) => updateChapter(ch.chapter_number, patch)}
          readOnly={readOnly}
        />
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