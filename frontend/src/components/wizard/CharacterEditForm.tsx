import { useEffect, useRef, useState } from "react";
import api, { Character } from "../../api/client";
import CharacterRelationsEditor from "./CharacterRelationsEditor";

interface Props {
  projectId: string;
  character: Character;
  allCharacters: Character[];
  onComplete: (updated: Character) => void;
  onCancel: (discarded: boolean) => void;
}

const ROLE_LABELS: Record<Character["character_type"], string> = {
  protagonist: "主角",
  antagonist: "反派",
  supporting: "配角",
  mentor: "导师",
};

type SaveStatus = "idle" | "saving" | "error";

const debounce = (ms: number) => {
  let t: ReturnType<typeof setTimeout> | null = null;
  return (fn: () => void) => {
    if (t) clearTimeout(t);
    t = setTimeout(fn, ms);
  };
};

function labelOf(k: "beliefs" | "desires" | "fears" | "values" | "core_traits"): string {
  return { beliefs: "信念", desires: "欲望", fears: "恐惧", values: "价值观", core_traits: "核心特质" }[k];
}

// Hoisted to module scope so the component identity is stable across parent
// renders — otherwise every save-state transition (idle → saving → idle) would
// unmount and remount every chip instance, wiping focus and in-progress drafts.
function ChipArray({
  label,
  arr,
  onChange,
  placeholder,
}: {
  label: string;
  arr: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState("");
  return (
    <div>
      <label className="block font-label-mono text-system-log/80 mb-1 text-[10px]">{label}</label>
      <div className="flex flex-wrap gap-1 mb-1">
        {arr.map((chip, i) => (
          <span
            key={i}
            className="inline-flex items-center gap-1 px-2 py-0.5 bg-surface-container-low rounded text-[11px] font-body-narrative text-primary"
          >
            {chip}
            <button
              type="button"
              onClick={() => onChange(arr.filter((_, j) => j !== i))}
              className="text-system-log/60 hover:text-error"
              aria-label="删除"
            >×</button>
          </span>
        ))}
      </div>
      <input
        value={draft || arr.join("、")}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && draft.trim()) {
            e.preventDefault();
            onChange([...arr, draft.trim()]);
            setDraft("");
          }
        }}
        placeholder={placeholder ?? "回车添加"}
        className="w-full bg-surface-container border border-outline-variant rounded px-2 py-1 text-xs text-primary focus:outline-none focus:border-primary-container"
      />
    </div>
  );
}

export default function CharacterEditForm({ projectId, character, allCharacters, onComplete, onCancel }: Props) {
  const [local, setLocal] = useState<Character>(character);
  const [status, setStatus] = useState<SaveStatus>("idle");
  const dirtyRef = useRef(false);
  const debouncedRef = useRef(debounce(500));
  // Reset local copy if the parent passes a different character (e.g., sibling edit).
  useEffect(() => { setLocal(character); }, [character.id]);

  const patchField = async (patch: Partial<Character>) => {
    dirtyRef.current = true;
    setStatus("saving");
    try {
      const updated = await api.patchCharacter(projectId, character.id, patch);
      setLocal((prev) => ({ ...prev, ...updated }));
      setStatus("idle");
    } catch {
      setStatus("error");
    }
  };

  const queuePatch = (patch: Partial<Character>) => {
    setLocal((prev) => ({ ...prev, ...patch }));
    debouncedRef.current(() => { void patchField(patch); });
  };

  const handleBlurField = <K extends keyof Character>(key: K, value: Character[K]) => {
    // Compare against the canonical prop value, not the local optimistic copy:
    // the local copy was just updated by onChange, so comparing against it here
    // would always short-circuit and skip the PATCH.
    if (character[key] === value) return;
    queuePatch({ [key]: value } as Partial<Character>);
  };

  const handleBlurNested = (patch: Partial<Character>) => {
    const key = Object.keys(patch)[0] as keyof Character;
    // Compare against the canonical prop value, not the local optimistic copy:
    // the local copy was just updated by onChange, so comparing against it here
    // would always short-circuit and skip the PATCH. For nested objects,
    // JSON-stringify for a structural comparison; for arrays (relations,
    // unknown_to_character), direct compare works.
    const prev = character[key];
    const next = patch[key];
    if (JSON.stringify(prev) === JSON.stringify(next)) return;
    queuePatch(patch);
  };

  const handleCancel = () => {
    if (dirtyRef.current) {
      const ok = window.confirm("丢弃未保存的修改？");
      if (!ok) return;
    }
    onCancel(true);
  };

  // ChipArray is hoisted to module scope (see below) so it doesn't re-mount on
  // every parent render — that would lose focus and in-progress draft state.

  return (
    <div data-testid={`character-${character.id}-edit-form`} className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="font-label-mono text-system-log text-[10px]">
          {status === "saving" && "保存中…"}
          {status === "idle" && dirtyRef.current && "已同步"}
          {status === "error" && <span className="text-error">保存失败 (重试请再次编辑)</span>}
        </div>
      </div>

      {/* 基础信息 */}
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="block font-label-mono text-system-log mb-1 text-xs">姓名</label>
          <input
            data-testid={`character-${character.id}-name`}
            value={local.name}
            onChange={(e) => setLocal({ ...local, name: e.target.value })}
            onBlur={(e) => handleBlurField("name", e.target.value)}
            className="w-full bg-surface-container border border-outline-variant rounded px-2 py-1 text-xs text-primary focus:outline-none focus:border-primary-container"
          />
        </div>
        <div>
          <label className="block font-label-mono text-system-log mb-1 text-xs">角色类型</label>
          <select
            data-testid={`character-${character.id}-type`}
            value={local.character_type}
            onChange={(e) => {
              const v = e.target.value as Character["character_type"];
              setLocal({ ...local, character_type: v });
              handleBlurField("character_type", v);
            }}
            className="w-full bg-surface-container border border-outline-variant rounded px-2 py-1 text-xs text-primary focus:outline-none focus:border-primary-container"
          >
            {Object.entries(ROLE_LABELS).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </div>
      </div>
      <label className="flex items-center gap-2 font-body-ui text-xs text-primary">
        <input
          type="checkbox"
          checked={local.is_core_character}
          onChange={(e) => {
            setLocal({ ...local, is_core_character: e.target.checked });
            handleBlurField("is_core_character", e.target.checked);
          }}
        />
        核心角色
      </label>

      {/* 人格层 */}
      <div className="space-y-1">
        <div className="font-label-mono text-system-log text-[10px] uppercase tracking-wider">人格层</div>
        <div className="grid grid-cols-2 gap-2">
          {(["beliefs", "desires", "fears", "values", "core_traits"] as const).map((k) => (
            <ChipArray
              key={k}
              label={{ beliefs: "信念", desires: "欲望", fears: "恐惧", values: "价值观", core_traits: "核心特质" }[k]}
              arr={local.personality?.[k] ?? []}
              placeholder={`${labelOf(k)} - 回车添加`}
              onChange={(next) => {
                const nextPersonality = { ...(local.personality ?? { beliefs: [], desires: [], fears: [], values: [], core_traits: [] }), [k]: next };
                setLocal({ ...local, personality: nextPersonality });
                handleBlurNested({ personality: nextPersonality });
              }}
            />
          ))}
        </div>
      </div>

      {/* 声音签名 */}
      <div className="space-y-1">
        <div className="font-label-mono text-system-log text-[10px] uppercase tracking-wider">声音签名</div>
        <label className="block font-label-mono text-system-log/80 mb-1 text-[10px]">说话风格</label>
        <textarea
          value={local.voice_signature?.speech_style ?? ""}
          onChange={(e) => setLocal({ ...local, voice_signature: { ...(local.voice_signature ?? { speech_style: "", thought_patterns: "", taboos: [] }), speech_style: e.target.value } })}
          onBlur={(e) => {
            const next = { ...(local.voice_signature ?? { speech_style: "", thought_patterns: "", taboos: [] }), speech_style: e.target.value };
            handleBlurNested({ voice_signature: next });
          }}
          className="w-full bg-surface-container border border-outline-variant rounded px-2 py-1 text-xs text-primary focus:outline-none focus:border-primary-container"
          rows={2}
        />
        <label className="block font-label-mono text-system-log/80 mb-1 text-[10px]">内心活动</label>
        <textarea
          value={local.voice_signature?.thought_patterns ?? ""}
          onChange={(e) => setLocal({ ...local, voice_signature: { ...(local.voice_signature ?? { speech_style: "", thought_patterns: "", taboos: [] }), thought_patterns: e.target.value } })}
          onBlur={(e) => {
            const next = { ...(local.voice_signature ?? { speech_style: "", thought_patterns: "", taboos: [] }), thought_patterns: e.target.value };
            handleBlurNested({ voice_signature: next });
          }}
          className="w-full bg-surface-container border border-outline-variant rounded px-2 py-1 text-xs text-primary focus:outline-none focus:border-primary-container"
          rows={2}
        />
        <ChipArray
          label="禁忌"
          arr={local.voice_signature?.taboos ?? []}
          onChange={(next) => {
            const nextVoice = { ...(local.voice_signature ?? { speech_style: "", thought_patterns: "", taboos: [] }), taboos: next };
            setLocal({ ...local, voice_signature: nextVoice });
            handleBlurNested({ voice_signature: nextVoice });
          }}
        />
      </div>

      {/* 当前状态 */}
      <div className="space-y-1">
        <div className="font-label-mono text-system-log text-[10px] uppercase tracking-wider">当前状态</div>
        <label className="block font-label-mono text-system-log/80 mb-1 text-[10px]">位置</label>
        <input
          value={local.current_state?.location ?? ""}
          onChange={(e) => setLocal({ ...local, current_state: { ...(local.current_state ?? { location: "", physical_condition: "normal", emotional: "neutral", known_secrets: [] }), location: e.target.value } })}
          onBlur={(e) => {
            const next = { ...(local.current_state ?? { location: "", physical_condition: "normal", emotional: "neutral", known_secrets: [] }), location: e.target.value };
            handleBlurNested({ current_state: next });
          }}
          className="w-full bg-surface-container border border-outline-variant rounded px-2 py-1 text-xs text-primary focus:outline-none focus:border-primary-container"
        />
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block font-label-mono text-system-log/80 mb-1 text-[10px]">身体状况</label>
            <input
              value={local.current_state?.physical_condition ?? "normal"}
              onChange={(e) => setLocal({ ...local, current_state: { ...(local.current_state ?? { location: "", physical_condition: "normal", emotional: "neutral", known_secrets: [] }), physical_condition: e.target.value } })}
              onBlur={(e) => {
                const next = { ...(local.current_state ?? { location: "", physical_condition: "normal", emotional: "neutral", known_secrets: [] }), physical_condition: e.target.value };
                handleBlurNested({ current_state: next });
              }}
              className="w-full bg-surface-container border border-outline-variant rounded px-2 py-1 text-xs text-primary focus:outline-none focus:border-primary-container"
            />
          </div>
          <div>
            <label className="block font-label-mono text-system-log/80 mb-1 text-[10px]">情绪</label>
            <input
              value={local.current_state?.emotional ?? "neutral"}
              onChange={(e) => setLocal({ ...local, current_state: { ...(local.current_state ?? { location: "", physical_condition: "normal", emotional: "neutral", known_secrets: [] }), emotional: e.target.value } })}
              onBlur={(e) => {
                const next = { ...(local.current_state ?? { location: "", physical_condition: "normal", emotional: "neutral", known_secrets: [] }), emotional: e.target.value };
                handleBlurNested({ current_state: next });
              }}
              className="w-full bg-surface-container border border-outline-variant rounded px-2 py-1 text-xs text-primary focus:outline-none focus:border-primary-container"
            />
          </div>
        </div>
        <ChipArray
          label="已知秘密"
          arr={local.current_state?.known_secrets ?? []}
          onChange={(next) => {
            const nextState = { ...(local.current_state ?? { location: "", physical_condition: "normal", emotional: "neutral", known_secrets: [] }), known_secrets: next };
            setLocal({ ...local, current_state: nextState });
            handleBlurNested({ current_state: nextState });
          }}
        />
      </div>

      {/* 角色不知道的事 */}
      <div className="space-y-1">
        <div className="font-label-mono text-system-log text-[10px] uppercase tracking-wider">角色不知道的事</div>
        <ChipArray
          label="未知 (unknown_to_character)"
          arr={local.unknown_to_character ?? []}
          onChange={(next) => {
            setLocal({ ...local, unknown_to_character: next });
            handleBlurNested({ unknown_to_character: next });
          }}
        />
      </div>

      {/* 角色关系 */}
      <div className="space-y-1">
        <div className="font-label-mono text-system-log text-[10px] uppercase tracking-wider">角色关系</div>
        <CharacterRelationsEditor
          relations={local.relations ?? {}}
          allCharacters={allCharacters}
          selfId={character.id}
          onChange={(next) => {
            setLocal({ ...local, relations: next });
            handleBlurNested({ relations: next });
          }}
        />
      </div>

      <div className="flex justify-end gap-2 pt-2 border-t border-outline-variant">
        <button
          type="button"
          onClick={handleCancel}
          className="px-3 py-1 text-xs bg-surface-container text-system-log rounded-lg hover:bg-surface-container-low"
        >取消</button>
        <button
          type="button"
          onClick={() => onComplete(local)}
          className="px-4 py-1 text-xs bg-tertiary-container text-surface-container-low rounded-lg hover:opacity-90"
        >完成</button>
      </div>
    </div>
  );
}