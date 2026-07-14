import { useEffect, useRef, useState } from "react";
import api, { Outline } from "../../../api/client";

interface BaseEditorProps {
  projectId: string;
  data: unknown;
  onSaved: () => void;
}

const EMPTY: Outline = { chapters: [] };

function readOutline(data: unknown): Outline {
  if (!data || typeof data !== "object") return EMPTY;
  const raw = data as Partial<Outline>;
  return { chapters: Array.isArray(raw.chapters) ? raw.chapters : [] };
}

/**
 * In-place editor for Stage3 chapter outlines — title only. v1.8 Bug 3 fix.
 * scene_plan editing happens on Stage3 itself (Growth Workshop), not the
 * workspace, so we keep this minimal. Saving rewrites the whole outline
 * with patched titles; scenes are passed through unchanged.
 */
export default function OutlineEditor({ projectId, data, onSaved }: BaseEditorProps) {
  const [outline, setOutline] = useState<Outline>(() => readOutline(data));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const outlineRef = useRef(outline);
  outlineRef.current = outline;

  useEffect(() => {
    setOutline(readOutline(data));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const updateTitle = (idx: number, title: string) => {
    const list = outline.chapters.slice();
    list[idx] = { ...list[idx], title };
    setOutline({ ...outline, chapters: list });
  };

  const handleSave = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.updateOutline(projectId, outlineRef.current);
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存失败");
    } finally {
      setBusy(false);
    }
  };

  const handleCancel = () => {
    setOutline(readOutline(data));
    setError(null);
  };

  if (outline.chapters.length === 0) {
    return (
      <div data-testid="outline-editor" className="space-y-3">
        <div className="font-label-mono text-system-log text-[10px] uppercase tracking-wider">大纲</div>
        <p className="font-body-ui text-system-log/60 text-xs">
          尚未生成大纲 — 请到 Stage3 生成或新建。
        </p>
      </div>
    );
  }

  return (
    <div data-testid="outline-editor" className="space-y-3">
      <div className="font-label-mono text-system-log text-[10px] uppercase tracking-wider">
        大纲 ({outline.chapters.length} 章 — 场景级编辑请到 Stage3)
      </div>
      {outline.chapters.map((ch, idx) => (
        <div key={idx} className="space-y-1">
          <label className="block font-label-mono text-system-log text-xs">
            第 {ch.chapter_number} 章
          </label>
          <input
            data-testid={`outline-editor-chapter-${ch.chapter_number}-title`}
            value={ch.title}
            onChange={(e) => updateTitle(idx, e.target.value)}
            className="w-full bg-surface-container border border-outline-variant rounded-lg px-3 py-2 text-sm text-primary focus:outline-none focus:border-primary-container"
          />
          {ch.theme && (
            <p className="font-body-ui text-system-log/70 text-xs italic">主题：{ch.theme}</p>
          )}
          <p className="font-body-ui text-system-log/60 text-xs">
            {ch.scene_plan.length} 个场景
          </p>
        </div>
      ))}

      {error && (
        <div data-testid="outline-editor-error" className="p-2 bg-error-container/20 border border-error rounded text-error font-body-ui text-xs">
          {error}
        </div>
      )}

      <footer className="flex items-center justify-end gap-2 pt-2">
        <button
          type="button"
          data-testid="outline-editor-cancel"
          onClick={handleCancel}
          disabled={busy}
          className="px-3 py-1 text-xs bg-surface-container text-system-log rounded-lg hover:bg-surface-container-low disabled:opacity-40"
        >取消</button>
        <button
          type="button"
          data-testid="outline-editor-save"
          onClick={handleSave}
          disabled={busy}
          className="px-4 py-1 text-xs bg-tertiary-container text-surface-container-low rounded-lg hover:opacity-90 disabled:opacity-40"
        >{busy ? "保存中…" : "保存"}</button>
      </footer>
    </div>
  );
}
