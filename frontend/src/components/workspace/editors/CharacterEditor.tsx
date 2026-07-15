import { useEffect, useRef, useState } from "react";
import api, { Character, CharacterSet } from "../../../api/client";

interface BaseEditorProps {
  projectId: string;
  data: unknown;
  onSaved: () => void;
  readOnly?: boolean;
}

const EMPTY_SET: CharacterSet = { characters: [], current: null as unknown as Character };

function readSet(data: unknown): CharacterSet {
  if (!data || typeof data !== "object") return EMPTY_SET;
  const raw = data as Partial<CharacterSet>;
  return {
    characters: Array.isArray(raw.characters) ? raw.characters : [],
    current: (raw.current as Character | undefined) ?? (raw.characters?.[0] as Character | undefined) ?? (null as unknown as Character),
  };
}

function setField(c: Character, path: string, value: string): Character {
  const next: Character = JSON.parse(JSON.stringify(c));
  const parts = path.split(".");
  let obj: Record<string, unknown> = next as unknown as Record<string, unknown>;
  for (let i = 0; i < parts.length - 1; i++) {
    obj = obj[parts[i]] as Record<string, unknown>;
  }
  obj[parts[parts.length - 1]] = value;
  return next;
}

const ROLE_LABELS: Record<Character["character_type"], string> = {
  protagonist: "主角",
  antagonist: "反派",
  supporting: "配角",
  mentor: "导师",
};

/**
 * In-place editor for Stage2 Character set. v1.8 Bug 3 fix. Renders each
 * character as a collapsible card with editable name/role and chip-style
 * fields for personality/voice. Adding/removing characters is intentionally
 * out of scope — Stage2 wizard owns that workflow.
 */
export default function CharacterEditor({ projectId, data, onSaved, readOnly }: BaseEditorProps) {
  const [set, setSet] = useState<CharacterSet>(() => readSet(data));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const setRef = useRef(set);
  setRef.current = set;

  useEffect(() => {
    setSet(readSet(data));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const updateChar = (idx: number, next: Character) => {
    const list = set.characters.slice();
    list[idx] = next;
    setSet({ ...set, characters: list });
  };

  const setChipsField = (idx: number, field: string, chips: string) => {
    const next = setField(set.characters[idx], field, chips);
    updateChar(idx, next);
  };

  const handleSave = async () => {
    setBusy(true);
    setError(null);
    try {
      // backend updateCharacter wants the characters list, not the whole set
      await api.updateCharacter(projectId, { characters: setRef.current.characters, current: setRef.current.characters[0] ?? setRef.current.current });
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存失败");
    } finally {
      setBusy(false);
    }
  };

  const handleCancel = () => {
    setSet(readSet(data));
    setError(null);
  };

  if (set.characters.length === 0) {
    return (
      <div data-testid="character-editor" className="space-y-3">
        <div className="font-label-mono text-system-log text-[10px] uppercase tracking-wider">角色</div>
        <p className="font-body-ui text-system-log/60 text-xs">
          尚未创建角色 — 请到 Stage2 生成或新建。
        </p>
      </div>
    );
  }

  return (
    <div data-testid="character-editor" className="space-y-3">
      <div className="font-label-mono text-system-log text-[10px] uppercase tracking-wider">
        角色 ({set.characters.length} 个 — 详细增删请到 Stage2)
      </div>
      {set.characters.map((c, idx) => (
        <details key={c.id ?? idx} className="border border-outline-variant rounded-lg">
          <summary className="cursor-pointer px-3 py-2 font-body-ui text-sm text-primary">
            {c.name || "未命名角色"}{" "}
            <span className="text-system-log/60 text-xs">
              ({ROLE_LABELS[c.character_type] ?? c.character_type})
            </span>
          </summary>
          <div className="px-3 py-2 space-y-2 border-t border-outline-variant">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block font-label-mono text-system-log mb-1 text-xs">姓名</label>
                <input
                  data-testid={`character-${idx}-name`}
                  value={c.name}
                  onChange={(e) => updateChar(idx, setField(c, "name", e.target.value))}
                  className="w-full bg-surface-container border border-outline-variant rounded px-2 py-1 text-xs text-primary focus:outline-none focus:border-primary-container"
                />
              </div>
              <div>
                <label className="block font-label-mono text-system-log mb-1 text-xs">角色</label>
                <select
                  data-testid={`character-${idx}-role`}
                  value={c.character_type}
                  onChange={(e) => updateChar(idx, setField(c, "character_type", e.target.value))}
                  className="w-full bg-surface-container border border-outline-variant rounded px-2 py-1 text-xs text-primary focus:outline-none focus:border-primary-container"
                >
                  {Object.entries(ROLE_LABELS).map(([k, v]) => (
                    <option key={k} value={k}>{v}</option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="block font-label-mono text-system-log mb-1 text-xs">
                核心特质 (core_traits, 、分隔)
              </label>
              <input
                value={c.personality.core_traits.join("、")}
                onChange={(e) => setChipsField(idx, "personality.core_traits", e.target.value)}
                className="w-full bg-surface-container border border-outline-variant rounded px-2 py-1 text-xs text-primary focus:outline-none focus:border-primary-container"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block font-label-mono text-system-log mb-1 text-xs">信念 (beliefs, 、)</label>
                <input
                  value={c.personality.beliefs.join("、")}
                  onChange={(e) => setChipsField(idx, "personality.beliefs", e.target.value)}
                  className="w-full bg-surface-container border border-outline-variant rounded px-2 py-1 text-xs text-primary focus:outline-none focus:border-primary-container"
                />
              </div>
              <div>
                <label className="block font-label-mono text-system-log mb-1 text-xs">欲望 (desires, 、)</label>
                <input
                  value={c.personality.desires.join("、")}
                  onChange={(e) => setChipsField(idx, "personality.desires", e.target.value)}
                  className="w-full bg-surface-container border border-outline-variant rounded px-2 py-1 text-xs text-primary focus:outline-none focus:border-primary-container"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block font-label-mono text-system-log mb-1 text-xs">恐惧 (fears, 、)</label>
                <input
                  value={c.personality.fears.join("、")}
                  onChange={(e) => setChipsField(idx, "personality.fears", e.target.value)}
                  className="w-full bg-surface-container border border-outline-variant rounded px-2 py-1 text-xs text-primary focus:outline-none focus:border-primary-container"
                />
              </div>
              <div>
                <label className="block font-label-mono text-system-log mb-1 text-xs">价值观 (values, 、)</label>
                <input
                  value={c.personality.values.join("、")}
                  onChange={(e) => setChipsField(idx, "personality.values", e.target.value)}
                  className="w-full bg-surface-container border border-outline-variant rounded px-2 py-1 text-xs text-primary focus:outline-none focus:border-primary-container"
                />
              </div>
            </div>

            <div>
              <label className="block font-label-mono text-system-log mb-1 text-xs">说话风格</label>
              <textarea
                value={c.voice_signature.speech_style}
                onChange={(e) => updateChar(idx, setField(c, "voice_signature.speech_style", e.target.value))}
                rows={2}
                className="w-full bg-surface-container border border-outline-variant rounded px-2 py-1 text-xs text-primary focus:outline-none focus:border-primary-container resize-y"
              />
            </div>
            <div>
              <label className="block font-label-mono text-system-log mb-1 text-xs">内心活动 (thought_patterns)</label>
              <textarea
                value={c.voice_signature.thought_patterns}
                onChange={(e) => updateChar(idx, setField(c, "voice_signature.thought_patterns", e.target.value))}
                rows={2}
                className="w-full bg-surface-container border border-outline-variant rounded px-2 py-1 text-xs text-primary focus:outline-none focus:border-primary-container resize-y"
              />
            </div>
            <div>
              <label className="block font-label-mono text-system-log mb-1 text-xs">禁忌 (taboos, 、)</label>
              <input
                value={c.voice_signature.taboos.join("、")}
                onChange={(e) => setChipsField(idx, "voice_signature.taboos", e.target.value)}
                className="w-full bg-surface-container border border-outline-variant rounded px-2 py-1 text-xs text-primary focus:outline-none focus:border-primary-container"
              />
            </div>
          </div>
        </details>
      ))}

      {error && (
        <div data-testid="character-editor-error" className="p-2 bg-error-container/20 border border-error rounded text-error font-body-ui text-xs">
          {error}
        </div>
      )}

      <footer className="flex items-center justify-end gap-2 pt-2">
        <button
          type="button"
          data-testid="character-editor-cancel"
          onClick={handleCancel}
          disabled={busy}
          className="px-3 py-1 text-xs bg-surface-container text-system-log rounded-lg hover:bg-surface-container-low disabled:opacity-40"
        >取消</button>
        <button
          type="button"
          data-testid="character-editor-save"
          onClick={handleSave}
          disabled={busy || readOnly}
          title={readOnly ? "托管运行中,元数据已锁定" : undefined}
          className="px-4 py-1 text-xs bg-tertiary-container text-surface-container-low rounded-lg hover:opacity-90 disabled:opacity-40"
        >{busy ? "保存中…" : "保存"}</button>
      </footer>
    </div>
  );
}
