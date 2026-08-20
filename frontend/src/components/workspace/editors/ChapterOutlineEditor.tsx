import { useEffect, useRef, useState } from "react";
import api, { type Outline, type ScenePlan } from "../../../api/client";

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
  const [showB, setShowB] = useState(false);
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
          <div className="pt-2">
            <button
              type="button"
              data-testid={`scene-${scene.scene_number}-b-toggle`}
              onClick={() => setShowB((v) => !v)}
              className="text-[10px] text-system-log hover:text-primary"
            >预注册（{scene.registry_changes.created.length + scene.registry_changes.updated.length} 项 · {scene.required_logs.length} tags） · {showB ? "收起" : "展开"}</button>
            {showB && <BFieldsAccordion scene={scene} onUpdate={onUpdate} readOnly={readOnly} />}
          </div>
        </div>
      )}
    </div>
  );
}

function BFieldsAccordion({
  scene, onUpdate, readOnly,
}: {
  scene: ScenePlan;
  onUpdate: (patch: Partial<ScenePlan>) => void;
  readOnly?: boolean;
}) {
  const addCreated = () => {
    onUpdate({
      registry_changes: {
        ...scene.registry_changes,
        created: [...scene.registry_changes.created, { type: "", id_pattern: "", description: "" }],
      },
    });
  };
  const removeCreated = (i: number) => {
    onUpdate({
      registry_changes: {
        ...scene.registry_changes,
        created: scene.registry_changes.created.filter((_, idx) => idx !== i),
      },
    });
  };
  const updateCreated = (i: number, patch: Partial<ScenePlan["registry_changes"]["created"][number]>) => {
    onUpdate({
      registry_changes: {
        ...scene.registry_changes,
        created: scene.registry_changes.created.map((row, idx) =>
          idx === i ? { ...row, ...patch } : row,
        ),
      },
    });
  };
  const addUpdated = () => {
    onUpdate({
      registry_changes: {
        ...scene.registry_changes,
        updated: [...scene.registry_changes.updated, { asset_id: "", field: "", new_value: "" }],
      },
    });
  };
  const removeUpdated = (i: number) => {
    onUpdate({
      registry_changes: {
        ...scene.registry_changes,
        updated: scene.registry_changes.updated.filter((_, idx) => idx !== i),
      },
    });
  };
  const updateUpdated = (i: number, patch: Partial<ScenePlan["registry_changes"]["updated"][number]>) => {
    onUpdate({
      registry_changes: {
        ...scene.registry_changes,
        updated: scene.registry_changes.updated.map((row, idx) =>
          idx === i ? { ...row, ...patch } : row,
        ),
      },
    });
  };
  const [newTag, setNewTag] = useState("");
  const addTag = () => {
    const t = newTag.trim();
    if (!t) return;
    if (scene.required_logs.includes(t)) {
      setNewTag("");
      return;
    }
    onUpdate({ required_logs: [...scene.required_logs, t] });
    setNewTag("");
  };
  const removeTag = (i: number) => {
    onUpdate({ required_logs: scene.required_logs.filter((_, idx) => idx !== i) });
  };

  return (
    <div data-testid={`scene-${scene.scene_number}-b-accordion`} className="mt-2 space-y-2 border-t border-outline-variant pt-2">
      <div>
        <div className="flex items-center justify-between mb-1">
          <span className="font-label-mono text-system-log text-[10px] uppercase tracking-wider">预注册 · registry_changes.created</span>
          {!readOnly && (
            <button
              type="button"
              data-testid={`scene-${scene.scene_number}-registry-created-add`}
              onClick={addCreated}
              className="text-xs text-primary-container"
            >+ 新增</button>
          )}
        </div>
        {scene.registry_changes.created.length === 0 ? (
          <p className="text-[10px] text-system-log/70">（无）</p>
        ) : (
          <div className="space-y-1">
            {scene.registry_changes.created.map((row, i) => (
              <div key={i} className="grid grid-cols-3 gap-1">
                <input
                  data-testid={`scene-${scene.scene_number}-registry-created-${i}-type`}
                  value={row.type}
                  onChange={(e) => updateCreated(i, { type: e.target.value })}
                  placeholder="type"
                  disabled={readOnly}
                  className="bg-surface-container border border-outline-variant rounded px-1 py-0.5 text-[10px]"
                />
                <input
                  data-testid={`scene-${scene.scene_number}-registry-created-${i}-id-pattern`}
                  value={row.id_pattern}
                  onChange={(e) => updateCreated(i, { id_pattern: e.target.value })}
                  placeholder="id_pattern"
                  disabled={readOnly}
                  className="bg-surface-container border border-outline-variant rounded px-1 py-0.5 text-[10px]"
                />
                <div className="flex gap-1">
                  <input
                    data-testid={`scene-${scene.scene_number}-registry-created-${i}-description`}
                    value={row.description}
                    onChange={(e) => updateCreated(i, { description: e.target.value })}
                    placeholder="description"
                    disabled={readOnly}
                    className="flex-1 bg-surface-container border border-outline-variant rounded px-1 py-0.5 text-[10px]"
                  />
                  {!readOnly && (
                    <button
                      type="button"
                      data-testid={`scene-${scene.scene_number}-registry-created-${i}-remove`}
                      onClick={() => removeCreated(i)}
                      className="text-[10px] text-error"
                    >×</button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div>
        <div className="flex items-center justify-between mb-1">
          <span className="font-label-mono text-system-log text-[10px] uppercase tracking-wider">预注册 · registry_changes.updated</span>
          {!readOnly && (
            <button
              type="button"
              data-testid={`scene-${scene.scene_number}-registry-updated-add`}
              onClick={addUpdated}
              className="text-xs text-primary-container"
            >+ 新增</button>
          )}
        </div>
        {scene.registry_changes.updated.length === 0 ? (
          <p className="text-[10px] text-system-log/70">（无）</p>
        ) : (
          <div className="space-y-1">
            {scene.registry_changes.updated.map((row, i) => (
              <div key={i} className="grid grid-cols-3 gap-1">
                <input
                  data-testid={`scene-${scene.scene_number}-registry-updated-${i}-asset-id`}
                  value={row.asset_id}
                  onChange={(e) => updateUpdated(i, { asset_id: e.target.value })}
                  placeholder="asset_id"
                  disabled={readOnly}
                  className="bg-surface-container border border-outline-variant rounded px-1 py-0.5 text-[10px]"
                />
                <input
                  data-testid={`scene-${scene.scene_number}-registry-updated-${i}-field`}
                  value={row.field}
                  onChange={(e) => updateUpdated(i, { field: e.target.value })}
                  placeholder="field"
                  disabled={readOnly}
                  className="bg-surface-container border border-outline-variant rounded px-1 py-0.5 text-[10px]"
                />
                <div className="flex gap-1">
                  <input
                    data-testid={`scene-${scene.scene_number}-registry-updated-${i}-new-value`}
                    value={row.new_value}
                    onChange={(e) => updateUpdated(i, { new_value: e.target.value })}
                    placeholder="new_value"
                    disabled={readOnly}
                    className="flex-1 bg-surface-container border border-outline-variant rounded px-1 py-0.5 text-[10px]"
                  />
                  {!readOnly && (
                    <button
                      type="button"
                      data-testid={`scene-${scene.scene_number}-registry-updated-${i}-remove`}
                      onClick={() => removeUpdated(i)}
                      className="text-[10px] text-error"
                    >×</button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div>
        <div className="flex items-center justify-between mb-1">
          <span className="font-label-mono text-system-log text-[10px] uppercase tracking-wider">预注册 · required_logs</span>
        </div>
        <div className="flex flex-wrap gap-1 mb-1">
          {scene.required_logs.map((tag, i) => (
            <span
              key={i}
              data-testid={`scene-${scene.scene_number}-required-log-${i}`}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-surface-container text-[10px]"
            >
              {tag}
              {!readOnly && (
                <button
                  type="button"
                  data-testid={`scene-${scene.scene_number}-required-log-${i}-remove`}
                  onClick={() => removeTag(i)}
                  className="text-error"
                >×</button>
              )}
            </span>
          ))}
        </div>
        {!readOnly && (
          <div className="flex gap-1">
            <input
              data-testid={`scene-${scene.scene_number}-required-log-input`}
              value={newTag}
              onChange={(e) => setNewTag(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addTag(); } }}
              placeholder="新增 tag…"
              className="flex-1 bg-surface-container border border-outline-variant rounded px-1 py-0.5 text-[10px]"
            />
            <button
              type="button"
              data-testid={`scene-${scene.scene_number}-required-log-add`}
              onClick={addTag}
              className="text-[10px] text-primary-container"
            >添加</button>
          </div>
        )}
      </div>
    </div>
  );
}
