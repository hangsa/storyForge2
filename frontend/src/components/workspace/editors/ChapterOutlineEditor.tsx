import { useEffect, useState } from "react";
import { type Outline, type ScenePlan } from "../../../api/client";

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

export default function ChapterOutlineEditor({ projectId: _projectId, data, onSaved: _onSaved, readOnly }: BaseEditorProps) {
  const initial = readOutline(data);
  const [outline, setOutline] = useState<Outline>(() => initial ?? EMPTY);

  useEffect(() => {
    const next = readOutline(data);
    if (next !== null) setOutline(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

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
          onSceneUpdate={(sn, patch) => {
            setOutline((prev) => ({
              ...prev,
              chapters: prev.chapters.map((c) =>
                c.chapter_number === ch.chapter_number
                  ? { ...c, scene_plan: c.scene_plan.map((s) => (s.scene_number === sn ? { ...s, ...patch } : s)) }
                  : c,
              ),
            }));
          }}
          readOnly={readOnly}
        />
      ))}
    </div>
  );
}

function ChapterRow({
  chapter, onUpdate, onSceneUpdate, readOnly,
}: {
  chapter: Outline["chapters"][number];
  onUpdate: (patch: Partial<Outline["chapters"][number]>) => void;
  onSceneUpdate: (scene_number: number, patch: Partial<ScenePlan>) => void;
  readOnly?: boolean;
}) {
  const [open, setOpen] = useState(true);
  return (
    <div data-testid={`chapter-row-${chapter.chapter_number}`} className="border border-outline-variant rounded-lg p-2 space-y-2">
      <div className="flex items-center justify-between">
        <span className="font-label-mono text-system-log text-[10px] uppercase tracking-wider">
          第 {chapter.chapter_number} 章
        </span>
        <button
          type="button"
          data-testid={`chapter-row-${chapter.chapter_number}-toggle`}
          onClick={() => setOpen((v) => !v)}
          className="text-xs text-system-log hover:text-primary"
        >{open ? "收起" : "展开"}</button>
      </div>
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
          data-testid={`chapter-${chapter.chapter_number}-theme`}
          value={chapter.theme ?? ""}
          onChange={(e) => onUpdate({ theme: e.target.value })}
          disabled={readOnly}
          className="w-full bg-surface-container border border-outline-variant rounded px-2 py-1 text-xs text-primary focus:outline-none focus:border-primary-container overflow-hidden"
        />
      </div>
      {open && (
        <div className="space-y-1">
          {chapter.scene_plan.length === 0 ? (
            <p className="text-xs text-system-log">暂无场景 — 请到 Stage3 重新生成此章节大纲。</p>
          ) : (
            chapter.scene_plan.map((scene) => (
              <SceneRow
                key={scene.scene_number}
                scene={scene}
                onUpdate={(patch) => onSceneUpdate(scene.scene_number, patch)}
                readOnly={readOnly}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}

const NARRATIVE_ROLES = ["setup", "mini_payoff", "cliffhanger", "major_reveal"] as const;

function SceneRow({
  scene, onUpdate, readOnly,
}: {
  scene: ScenePlan;
  onUpdate: (patch: Partial<ScenePlan>) => void;
  readOnly?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div data-testid={`scene-row-${scene.scene_number}`} className="border border-outline-variant rounded p-2 space-y-1">
      <button
        type="button"
        data-testid={`scene-row-${scene.scene_number}-toggle`}
        onClick={() => setOpen((v) => !v)}
        className="text-xs text-system-log hover:text-primary"
      >场景 {scene.scene_number} · {open ? "收起" : "展开"}</button>
      {open && (
        <div className="space-y-2">
          <div>
            <label className="block font-label-mono text-system-log mb-1 text-[10px] uppercase tracking-wider">goal</label>
            <textarea
              data-testid={`scene-${scene.scene_number}-goal`}
              value={scene.goal}
              onChange={(e) => onUpdate({ goal: e.target.value })}
              disabled={readOnly}
              className="w-full bg-surface-container border border-outline-variant rounded px-2 py-1 text-xs text-primary focus:outline-none focus:border-primary-container overflow-hidden"
            />
          </div>
          <div>
            <label className="block font-label-mono text-system-log mb-1 text-[10px] uppercase tracking-wider">conflict</label>
            <textarea
              data-testid={`scene-${scene.scene_number}-conflict`}
              value={scene.conflict}
              onChange={(e) => onUpdate({ conflict: e.target.value })}
              disabled={readOnly}
              className="w-full bg-surface-container border border-outline-variant rounded px-2 py-1 text-xs text-primary focus:outline-none focus:border-primary-container overflow-hidden"
            />
          </div>
          <div>
            <label className="block font-label-mono text-system-log mb-1 text-[10px] uppercase tracking-wider">emotional_arc</label>
            <textarea
              data-testid={`scene-${scene.scene_number}-emotional-arc`}
              value={scene.emotional_arc}
              onChange={(e) => onUpdate({ emotional_arc: e.target.value })}
              disabled={readOnly}
              className="w-full bg-surface-container border border-outline-variant rounded px-2 py-1 text-xs text-primary focus:outline-none focus:border-primary-container overflow-hidden"
            />
          </div>
          <div>
            <label className="block font-label-mono text-system-log mb-1 text-[10px] uppercase tracking-wider">narrative_role</label>
            <select
              data-testid={`scene-${scene.scene_number}-narrative-role`}
              value={scene.narrative_role}
              onChange={(e) => onUpdate({ narrative_role: e.target.value as ScenePlan["narrative_role"] })}
              disabled={readOnly}
              className="w-full bg-surface-container border border-outline-variant rounded px-2 py-1 text-xs text-primary focus:outline-none focus:border-primary-container"
            >
              {NARRATIVE_ROLES.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block font-label-mono text-system-log mb-1 text-[10px] uppercase tracking-wider">beat_type</label>
            <input
              data-testid={`scene-${scene.scene_number}-beat-type`}
              value={scene.beat_type}
              onChange={(e) => onUpdate({ beat_type: e.target.value })}
              disabled={readOnly}
              className="w-full bg-surface-container border border-outline-variant rounded px-2 py-1 text-xs text-primary focus:outline-none focus:border-primary-container"
            />
          </div>
        </div>
      )}
    </div>
  );
}
