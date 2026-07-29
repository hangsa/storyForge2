import { useEffect, useMemo, useRef, useState } from "react";
import api, { BehaviorExample, Character, CharacterSet } from "../../api/client";
import { useWizard } from "./WizardContext";
import TagEditor from "../shared/TagEditor";
import CharacterRelationsEditor from "./CharacterRelationsEditor";
import BehaviorExamplesSection from "./BehaviorExamplesSection";

interface CharacterStepProps {
  projectId: string;
}

const CHARACTER_TYPES: { value: Character["character_type"]; label: string }[] = [
  { value: "protagonist", label: "主角" },
  { value: "antagonist", label: "反派" },
  { value: "supporting", label: "配角" },
  { value: "mentor", label: "导师" },
];

const DEFAULT_BATCH: Character["character_type"][] = [
  "protagonist",
  "antagonist",
  "antagonist",
  "supporting",
  "supporting",
  "supporting",
];

/**
 * The backend's `/stage2/generate-character` endpoint reads characters.json,
 * appends the new character, and returns the cumulative list. The new
 * character is always the last entry; earlier entries are whatever was on
 * disk before this call. Callers must NOT merge the full response — that
 * would double-count on the second call of a batch.
 */
function pickNewlyCreated(result: CharacterSet): Character | null {
  const list = result.characters ?? [];
  return list.length > 0 ? list[list.length - 1] : null;
}

type PersonalityKey = "beliefs" | "desires" | "fears" | "values" | "core_traits";

const PERSONALITY_FIELDS: { key: PersonalityKey; label: string }[] = [
  { key: "core_traits", label: "核心特质" },
  { key: "beliefs", label: "信念" },
  { key: "desires", label: "欲望" },
  { key: "fears", label: "恐惧" },
  { key: "values", label: "价值观" },
];

export default function CharacterStep({ projectId }: CharacterStepProps) {
  const wizard = useWizard();
  const [characters, setCharacters] = useState<CharacterSet | null>(wizard.data.characters ?? null);
  const [busy, setBusy] = useState(false);
  // Mirror latest state for handlers registered in the modal footer (limited deps).
  const charactersRef = useRef(characters);
  charactersRef.current = characters;
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [regenerateConfirmOpen, setRegenerateConfirmOpen] = useState(false);
  // Per-card pending flag for the BehaviorExamplesSection AI regenerate button.
  // Tracked as a Set so multiple cards can be independently loading.
  const [regeneratingExamplesIds, setRegeneratingExamplesIds] = useState<Set<string>>(() => new Set());

  const handleBatchStart = async () => {
    wizard.startStep(3);
    setBusy(true);
    try {
      // Sequential, not parallel: the backend's generate-character is a
      // read-append-write race, and the LLM prompt relies on
      // existing_characters for differentiation. Parallel calls cause both
      // to fail (6 cards named the same; see "6×李玄阳" diagnosis).
      const newChars: Character[] = [];
      for (const type of DEFAULT_BATCH) {
        const result = await api.generateCharacter(projectId, type);
        const fresh = pickNewlyCreated(result);
        if (!fresh) throw new Error("生成结果为空");
        newChars.push(fresh);
      }
      const next = { characters: newChars, current: newChars[0] };
      setCharacters(next);
      // v1.8.4: mark generated so step 3 stays reachable in the indicator
      // when the user navigates away before clicking "下一步".
      wizard.markStepGenerated(3, { characters: next });
    } catch (e) {
      wizard.setStatus("error", e instanceof Error ? e.message : "角色生成失败");
    } finally {
      setBusy(false);
    }
  };

  const handleAddOne = async (type: Character["character_type"]) => {
    setBusy(true);
    try {
      const result = await api.generateCharacter(projectId, type);
      const fresh = pickNewlyCreated(result);
      if (!fresh) throw new Error("生成结果为空");
      const existing = characters?.characters ?? [];
      const current = characters?.current ?? fresh;
      setCharacters({ characters: [...existing, fresh], current });
    } catch (e) {
      wizard.setStatus("error", e instanceof Error ? e.message : "角色添加失败");
    } finally {
      setBusy(false);
    }
  };

  const requestRegenerate = () => {
    if (characters && characters.characters.length > 0) {
      setRegenerateConfirmOpen(true);
      return;
    }
    void handleBatchStart();
  };

  const handleNext = async () => {
    const current = charactersRef.current;
    if (!current) return;
    setBusy(true);
    try {
      await api.updateCharacter(projectId, current);
      await api.advance(projectId, "STAGE3");
      wizard.saveStep(3, { characters: current });
    } catch (e) {
      wizard.setStatus("error", e instanceof Error ? e.message : "角色保存失败");
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteConfirm = async () => {
    if (!deletingId) return;
    if (busy) return;
    const targetId = deletingId;
    setDeletingId(null);
    try {
      await api.deleteCharacter(projectId, targetId);
      const list = (characters?.characters ?? []).filter((c) => c.id !== targetId);
      const current = characters?.current;
      const next = {
        characters: list,
        current: current && current.id !== targetId ? current : list[0],
      };
      setCharacters(next);
      wizard.saveStep(3, { characters: next });
    } catch (e) {
      wizard.setStatus("error", e instanceof Error ? e.message : "角色删除失败");
    }
  };

  const handleRegenerateConfirm = async () => {
    setRegenerateConfirmOpen(false);
    await handleBatchStart();
  };

  // Local-state patch for inline editing. Mirrors WorldStep's pattern: edits
  // stay in React state until the user clicks the modal footer's
  // "确认修改并继续", which then bulk-saves via api.updateCharacter. No
  // per-keystroke PATCH roundtrip.
  const updateCharacterAt = (id: string, patch: Partial<Character>) => {
    setCharacters((prev) => {
      const list = (prev?.characters ?? []).map((c) =>
        c.id === id ? { ...c, ...patch } : c,
      );
      return { characters: list, current: prev?.current ?? list[0] };
    });
  };

  const updatePersonality = (id: string, key: PersonalityKey, next: string[]) => {
    const c = characters?.characters.find((x) => x.id === id);
    if (!c) return;
    const nextPersonality = {
      ...(c.personality ?? { beliefs: [], desires: [], fears: [], values: [], core_traits: [] }),
      [key]: next,
    };
    updateCharacterAt(id, { personality: nextPersonality });
  };

  const updateVoiceField = (
    id: string,
    key: "speech_style" | "thought_patterns" | "taboos",
    value: string | string[],
  ) => {
    const c = characters?.characters.find((x) => x.id === id);
    if (!c) return;
    const nextVoice = {
      ...(c.voice_signature ?? { speech_style: "", thought_patterns: "", taboos: [] }),
      [key]: value,
    };
    updateCharacterAt(id, { voice_signature: nextVoice });
  };

  const updateVoiceBehaviorExamples = (id: string, next: BehaviorExample[]) => {
    const c = characters?.characters.find((x) => x.id === id);
    if (!c) return;
    const nextVoice = {
      ...(c.voice_signature ?? { speech_style: "", thought_patterns: "", taboos: [] }),
      behavior_examples: next,
    };
    updateCharacterAt(id, { voice_signature: nextVoice });
  };

  const handleRegenerateExamples = async (characterId: string) => {
    setRegeneratingExamplesIds((prev) => {
      const next = new Set(prev);
      next.add(characterId);
      return next;
    });
    try {
      const updated = await api.regenerateCharacterExamples(projectId, characterId, false);
      setCharacters((prev) => {
        const list = (prev?.characters ?? []).map((c) =>
          c.id === characterId ? { ...c, ...updated } : c,
        );
        return { characters: list, current: prev?.current ?? list[0] };
      });
    } catch (e) {
      // Follow the existing pattern: route through wizard.setStatus so the
      // error banner above the cards displays the message. No new toast UI.
      wizard.setStatus("error", e instanceof Error ? e.message : "行为示例重新生成失败");
    } finally {
      setRegeneratingExamplesIds((prev) => {
        const next = new Set(prev);
        next.delete(characterId);
        return next;
      });
    }
  };

  const updateCurrentState = (
    id: string,
    key: "location" | "physical_condition" | "emotional" | "known_secrets",
    value: string | string[],
  ) => {
    const c = characters?.characters.find((x) => x.id === id);
    if (!c) return;
    const nextState = {
      ...(c.current_state ?? { location: "", physical_condition: "normal", emotional: "neutral", known_secrets: [] }),
      [key]: value,
    };
    updateCharacterAt(id, { current_state: nextState });
  };

  const updateUnknown = (id: string, next: string[]) => {
    updateCharacterAt(id, { unknown_to_character: next });
  };

  const updateRelations = (id: string, next: Character["relations"]) => {
    updateCharacterAt(id, { relations: next });
  };

  const inboundRelationCount = (targetId: string): number => {
    return (characters?.characters ?? []).filter(
      (c) => c.id !== targetId && c.relations && targetId in c.relations,
    ).length;
  };

  const hasCharacters = !!characters && characters.characters.length > 0;

  const nameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of characters?.characters ?? []) m.set(c.id, c.name || c.id);
    return m;
  }, [characters]);

  // Sync local `characters` state from wizard.data whenever wizard.data changes.
  // This covers both the initial mount (wizard.data carries the prefill result
  // or a sessionStorage restore) and later changes (e.g., after the user
  // clicks "下一步" / handleNext, which writes the local list back to
  // wizard.data via saveStep). It is safe to overwrite local state because
  // character edits only touch local state — wizard.data.characters is the
  // persisted source of truth and only changes via prefill or saveStep.
  //
  // v1.9.1: previously this guard read `!characters`, which was meant to
  // protect in-progress edits. But it had the side effect of freezing the
  // wizard at a stale sessionStorage value (e.g., 6 chars from a prior
  // session) even after prefill updated wizard.data to 15 — the user then
  // saw the regenerated 6-char batch instead of the 15 chars on disk,
  // making 石坚 / 林凤娇 (the original 2 chars) invisible. Fix: always
  // re-sync when wizard.data.characters changes.
  useEffect(() => {
    const persisted = wizard.data.characters;
    if (persisted && persisted.characters.length > 0) {
      setCharacters(persisted);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wizard.data.characters]);

  // Auto-trigger the default batch (1 protagonist + 2 antagonists + 3 supporting)
  // on mount when there are no characters yet and we're not already generating
  // or in an error state. Subsequent retries use the footer "重新生成" button.
  //
  // v1.8.2: wait for prefill to finish before deciding — same race-condition
  // fix as OutlineStep (proj_cc4ca4ae regression).
  useEffect(() => {
    if (!wizard.prefillComplete) return;
    const noCharacters = !characters || characters.characters.length === 0;
    if (
      noCharacters &&
      wizard.status !== "generating" &&
      wizard.status !== "error"
    ) {
      handleBatchStart();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wizard.prefillComplete]);

  // 重新生成 / 确认修改并继续 are rendered by the modal footer; the step
  // just registers the handlers and the current busy state.
  //
  // wizard.status is in the deps (matching ConceptStep's pattern) so the
  // effect re-runs when the LLM call rejects: status goes
  // idle → generating → error. Without wizard.status in deps, the effect
  // only sees the initial `busy=false, hasChars=false` and the final
  // `busy=false, hasChars=false` (busy toggles true then false inside the
  // try/finally), so the regenerate handler never gets registered on the
  // error path — see "error state shows the error banner" test ordering
  // regression after the v1.8.2 prefill gate was added.
  useEffect(() => {
    const hasChars = !!characters && characters.characters.length > 0;
    const canRegenerate =
      hasChars ||
      wizard.status === "completed" ||
      wizard.status === "error";
    wizard.setRegenerateHandler(canRegenerate ? requestRegenerate : null, busy);
    wizard.setNextHandler(hasChars ? handleNext : null, busy);
    return () => {
      wizard.setRegenerateHandler(null, false);
      wizard.setNextHandler(null, false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasCharacters, busy, wizard.status]);

  return (
    <div data-testid="character-step" className="space-y-4">
      {wizard.status === "generating" && (
        <div className="text-center py-12">
          <span className="material-symbols-outlined text-4xl text-primary-container animate-spin inline-block">progress_activity</span>
          <p className="font-body-ui text-system-log mt-3 text-sm">正在生成角色…</p>
        </div>
      )}

      {wizard.status === "error" && (
        <div className="p-4 bg-error-container/20 border border-error rounded-lg text-error font-body-ui text-sm">
          {wizard.errorMessage}
        </div>
      )}

      {hasCharacters && (
        <div data-testid="character-form" className="space-y-3">
          <div className="font-label-mono text-system-log text-[10px] uppercase tracking-wider">
            已生成 {characters!.characters.length} 个角色
          </div>
          <ul data-testid="character-list" className="space-y-2">
            {characters!.characters.map((c) => {
              const personality = c.personality ?? { beliefs: [], desires: [], fears: [], values: [], core_traits: [] };
              const voice = c.voice_signature ?? { speech_style: "", thought_patterns: "", taboos: [] };
              const state = c.current_state ?? { location: "", physical_condition: "normal", emotional: "neutral", known_secrets: [] };
              return (
                <li
                  key={c.id}
                  data-testid={`character-${c.id}`}
                  className="p-3 bg-surface-container rounded-lg space-y-3"
                >
                  {/* 基础信息：可编辑的姓名 + 类型 + 核心角色标记 + 删除按钮 */}
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <div>
                        <label className="block font-label-mono text-system-log mb-1 text-[10px]">姓名</label>
                        <input
                          data-testid={`character-${c.id}-name`}
                          value={c.name ?? ""}
                          onChange={(e) => updateCharacterAt(c.id, { name: e.target.value })}
                          disabled={busy}
                          className="w-full bg-surface-container border border-outline-variant rounded px-2 py-1 text-xs text-primary focus:outline-none focus:border-primary-container disabled:opacity-40"
                        />
                      </div>
                      <div>
                        <label className="block font-label-mono text-system-log mb-1 text-[10px]">角色类型</label>
                        <select
                          data-testid={`character-${c.id}-type`}
                          value={c.character_type}
                          onChange={(e) => updateCharacterAt(c.id, { character_type: e.target.value as Character["character_type"] })}
                          disabled={busy}
                          className="w-full bg-surface-container border border-outline-variant rounded px-2 py-1 text-xs text-primary focus:outline-none focus:border-primary-container disabled:opacity-40"
                        >
                          {CHARACTER_TYPES.map((t) => (
                            <option key={t.value} value={t.value}>{t.label}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-2 pt-1">
                      <label className="flex items-center gap-1 font-body-ui text-[11px] text-primary whitespace-nowrap">
                        <input
                          type="checkbox"
                          data-testid={`character-${c.id}-core`}
                          checked={!!c.is_core_character}
                          onChange={(e) => updateCharacterAt(c.id, { is_core_character: e.target.checked })}
                          disabled={busy}
                        />
                        核心角色
                      </label>
                      <button
                        type="button"
                        data-testid={`character-delete-${c.id}`}
                        onClick={() => setDeletingId(c.id)}
                        disabled={busy}
                        className="p-1 text-system-log/70 hover:text-error disabled:opacity-40"
                        aria-label="删除"
                      >🗑️</button>
                    </div>
                  </div>

                  {/* 人格层 — 5 个 TagEditor（与世界观的力量体系/世界规则一致） */}
                  <div data-testid={`character-${c.id}-personality`} className="space-y-2 border-t border-outline-variant pt-3">
                    <div className="font-label-mono text-system-log text-[10px] uppercase tracking-wider">人格层</div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {PERSONALITY_FIELDS.map(({ key, label }) => (
                        <div key={key}>
                          <div className="font-label-mono text-system-log/80 text-[10px] mb-1">{label}</div>
                          <TagEditor
                            items={personality[key] ?? []}
                            onItemsChange={(next) => updatePersonality(c.id, key, next)}
                            saving={busy}
                          />
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* 声音签名 */}
                  <div data-testid={`character-${c.id}-voice`} className="space-y-2 border-t border-outline-variant pt-3">
                    <div className="font-label-mono text-system-log text-[10px] uppercase tracking-wider">声音签名</div>
                    <div>
                      <label className="block font-label-mono text-system-log/80 mb-1 text-[10px]">说话风格</label>
                      <textarea
                        data-testid={`character-${c.id}-speech-style`}
                        value={voice.speech_style}
                        onChange={(e) => updateVoiceField(c.id, "speech_style", e.target.value)}
                        disabled={busy}
                        rows={2}
                        className="w-full bg-surface-container border border-outline-variant rounded px-2 py-1 text-xs text-primary focus:outline-none focus:border-primary-container disabled:opacity-40 resize-y"
                      />
                    </div>
                    <div>
                      <label className="block font-label-mono text-system-log/80 mb-1 text-[10px]">思维模式</label>
                      <textarea
                        data-testid={`character-${c.id}-thought-patterns`}
                        value={voice.thought_patterns}
                        onChange={(e) => updateVoiceField(c.id, "thought_patterns", e.target.value)}
                        disabled={busy}
                        rows={2}
                        className="w-full bg-surface-container border border-outline-variant rounded px-2 py-1 text-xs text-primary focus:outline-none focus:border-primary-container disabled:opacity-40 resize-y"
                      />
                    </div>
                    <div>
                      <div className="font-label-mono text-system-log/80 mb-1 text-[10px]">行为禁忌</div>
                      <TagEditor
                        items={voice.taboos ?? []}
                        onItemsChange={(next) => updateVoiceField(c.id, "taboos", next)}
                        saving={busy}
                      />
                    </div>
                    <div className="border-t border-outline-variant pt-3">
                      <BehaviorExamplesSection
                        examples={voice.behavior_examples ?? []}
                        onChange={(next) => updateVoiceBehaviorExamples(c.id, next)}
                        onRegenerate={() => handleRegenerateExamples(c.id)}
                        regenerating={regeneratingExamplesIds.has(c.id)}
                      />
                    </div>
                  </div>

                  {/* 当前状态 */}
                  <div className="space-y-2 border-t border-outline-variant pt-3">
                    <div className="font-label-mono text-system-log text-[10px] uppercase tracking-wider">当前状态</div>
                    <div>
                      <label className="block font-label-mono text-system-log/80 mb-1 text-[10px]">位置</label>
                      <input
                        data-testid={`character-${c.id}-location`}
                        value={state.location}
                        onChange={(e) => updateCurrentState(c.id, "location", e.target.value)}
                        disabled={busy}
                        className="w-full bg-surface-container border border-outline-variant rounded px-2 py-1 text-xs text-primary focus:outline-none focus:border-primary-container disabled:opacity-40"
                      />
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <div>
                        <label className="block font-label-mono text-system-log/80 mb-1 text-[10px]">身体状况</label>
                        <input
                          data-testid={`character-${c.id}-physical-condition`}
                          value={state.physical_condition}
                          onChange={(e) => updateCurrentState(c.id, "physical_condition", e.target.value)}
                          disabled={busy}
                          className="w-full bg-surface-container border border-outline-variant rounded px-2 py-1 text-xs text-primary focus:outline-none focus:border-primary-container disabled:opacity-40"
                        />
                      </div>
                      <div>
                        <label className="block font-label-mono text-system-log/80 mb-1 text-[10px]">情绪</label>
                        <input
                          data-testid={`character-${c.id}-emotional`}
                          value={state.emotional}
                          onChange={(e) => updateCurrentState(c.id, "emotional", e.target.value)}
                          disabled={busy}
                          className="w-full bg-surface-container border border-outline-variant rounded px-2 py-1 text-xs text-primary focus:outline-none focus:border-primary-container disabled:opacity-40"
                        />
                      </div>
                    </div>
                    <div>
                      <div className="font-label-mono text-system-log/80 mb-1 text-[10px]">已知秘密</div>
                      <TagEditor
                        items={state.known_secrets ?? []}
                        onItemsChange={(next) => updateCurrentState(c.id, "known_secrets", next)}
                        saving={busy}
                      />
                    </div>
                  </div>

                  {/* 角色不知道的事 */}
                  <div className="space-y-2 border-t border-outline-variant pt-3">
                    <div className="font-label-mono text-system-log text-[10px] uppercase tracking-wider">角色不知道的事</div>
                    <div className="font-label-mono text-system-log/80 mb-1 text-[10px]">未知 (unknown_to_character)</div>
                    <TagEditor
                      items={c.unknown_to_character ?? []}
                      onItemsChange={(next) => updateUnknown(c.id, next)}
                      saving={busy}
                    />
                  </div>

                  {/* 角色关系 — 始终可见，添加/删除关系直接操作本地状态 */}
                  <div data-testid={`character-${c.id}-relations`} className="space-y-2 border-t border-outline-variant pt-3">
                    <div className="font-label-mono text-system-log text-[10px] uppercase tracking-wider">角色关系</div>
                    <CharacterRelationsEditor
                      relations={c.relations ?? {}}
                      allCharacters={characters?.characters ?? []}
                      selfId={c.id}
                      onChange={(next) => updateRelations(c.id, next)}
                    />
                  </div>
                </li>
              );
            })}
          </ul>

          <div className="border-t border-outline-variant pt-3 space-y-2">
            <p className="font-label-mono text-system-log/70 text-xs">手动添加更多角色：</p>
            <div className="flex flex-wrap gap-2">
              {CHARACTER_TYPES.map(({ value, label }) => (
                <button
                  key={value}
                  type="button"
                  data-testid={`character-add-${value}`}
                  onClick={() => handleAddOne(value)}
                  disabled={busy}
                  className="px-3 py-1.5 rounded-full border border-dashed text-sm font-body-ui
                             border-outline-variant text-system-log/70
                             hover:text-primary-container hover:border-primary-container/50
                             transition-colors disabled:opacity-40"
                >
                  + {label}
                </button>
              ))}
            </div>
          </div>

          <p className="font-body-ui text-system-log/60 text-xs">
            角色详情可在工作台的角色标签页内继续编辑。
          </p>

          {/* 重新生成 / 确认修改并继续 buttons moved to modal footer (see useEffect above). */}
        </div>
      )}

      {/* Delete confirmation modal */}
      {deletingId && (() => {
        const target = characters?.characters.find((c) => c.id === deletingId);
        if (!target) return null;
        const cascade = inboundRelationCount(deletingId);
        return (
          <div data-testid="delete-confirm-modal" className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-surface-container p-6 rounded-lg max-w-md space-y-4">
              <h3 className="font-display text-lg text-primary">删除「{target.name || "未命名"}」？</h3>
              <p className="font-body-ui text-sm text-system-log">
                将同时清理 <strong>{cascade}</strong> 个反向关系。
              </p>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  data-testid="delete-cancel-button"
                  onClick={() => setDeletingId(null)}
                  className="px-3 py-1 text-xs bg-surface-container-low text-system-log rounded-lg"
                >取消</button>
                <button
                  type="button"
                  data-testid="delete-confirm-button"
                  onClick={() => void handleDeleteConfirm()}
                  className="px-4 py-1 text-xs bg-error text-on-error rounded-lg"
                >确认删除</button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Regenerate confirmation modal */}
      {regenerateConfirmOpen && (
        <div data-testid="regenerate-confirm-modal" className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-surface-container p-6 rounded-lg max-w-md space-y-4">
            <h3 className="font-display text-lg text-primary">重新生成所有角色？</h3>
            <p className="font-body-ui text-sm text-system-log">
              现有 <strong>{characters?.characters.length ?? 0}</strong> 个角色（包含你的编辑）将被覆盖，无法恢复。
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                data-testid="regenerate-cancel-button"
                onClick={() => setRegenerateConfirmOpen(false)}
                className="px-3 py-1 text-xs bg-surface-container-low text-system-log rounded-lg"
              >取消</button>
              <button
                type="button"
                data-testid="regenerate-confirm-button"
                onClick={() => void handleRegenerateConfirm()}
                className="px-4 py-1 text-xs bg-error text-on-error rounded-lg"
              >确认重新生成</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
