import { useEffect, useMemo, useRef, useState } from "react";
import api, { Character, CharacterSet } from "../../api/client";
import { useWizard } from "./WizardContext";

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

export default function CharacterStep({ projectId }: CharacterStepProps) {
  const wizard = useWizard();
  const [characters, setCharacters] = useState<CharacterSet | null>(wizard.data.characters ?? null);
  const [busy, setBusy] = useState(false);
  // Mirror latest state for handlers registered in the modal footer (limited deps).
  const charactersRef = useRef(characters);
  charactersRef.current = characters;

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

  const handleNext = async () => {
    const current = charactersRef.current;
    if (!current) return;
    setBusy(true);
    try {
      await api.updateCharacter(projectId, current);
      try {
        await api.advance(projectId, "STAGE3");
      } catch {
        // best-effort: STAGE3 needs both world.json and characters.json — if user
        // skipped WorldStep or went back without re-running it, advance fails.
      }
      wizard.saveStep(3, { characters: current });
    } catch (e) {
      wizard.setStatus("error", e instanceof Error ? e.message : "角色保存失败");
    } finally {
      setBusy(false);
    }
  };

  const hasCharacters = !!characters && characters.characters.length > 0;

  const nameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of characters?.characters ?? []) m.set(c.id, c.name || c.id);
    return m;
  }, [characters]);

  const renderTags = (items: string[] | undefined) =>
    (items ?? []).map((t, i) => (
      <span
        key={i}
        className="inline-block px-2 py-0.5 bg-surface-container-low rounded text-[11px] font-body-narrative text-primary"
      >
        {t}
      </span>
    ));

  const relationStatusStyle = (status: string) => {
    if (status === "ally") return "bg-primary-container/20 text-primary-container";
    if (status === "enemy") return "bg-error/10 text-error";
    return "bg-surface-container-low text-system-log";
  };

  // Sync local `characters` state from wizard.data when prefill lands. Only
  // overwrite if local state is still null (no characters yet).
  useEffect(() => {
    const persisted = wizard.data.characters;
    if (persisted && persisted.characters.length > 0 && !characters) {
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
    wizard.setRegenerateHandler(canRegenerate ? handleBatchStart : null, busy);
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
            {characters!.characters.map((c) => (
              <li
                key={c.id}
                data-testid={`character-${c.id}`}
                className="p-3 bg-surface-container rounded-lg space-y-3"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-display text-primary">{c.name || "未命名"}</div>
                    <div className="font-label-mono text-system-log text-xs">
                      {CHARACTER_TYPES.find((t) => t.value === c.character_type)?.label || c.character_type}
                      {c.is_core_character ? " · 核心角色" : ""}
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 border-t border-outline-variant pt-3">
                  {/* 人格层 */}
                  <div data-testid={`character-${c.id}-personality`} className="space-y-2">
                    <div className="font-label-mono text-system-log text-[10px] uppercase tracking-wider">人格层</div>
                    {([
                      ["core_traits", "核心特质"],
                      ["beliefs", "信念"],
                      ["desires", "欲望"],
                      ["fears", "恐惧"],
                      ["values", "价值观"],
                    ] as const).map(([key, label]) => (
                      <div key={key}>
                        <div className="font-label-mono text-system-log/80 text-[10px]">{label}</div>
                        <div className="flex flex-wrap gap-1 mt-0.5">
                          {renderTags(c.personality?.[key])}
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* 声音签名 */}
                  <div data-testid={`character-${c.id}-voice`} className="space-y-2">
                    <div className="font-label-mono text-system-log text-[10px] uppercase tracking-wider">声音签名</div>
                    <div>
                      <div className="font-label-mono text-system-log/80 text-[10px]">语言风格</div>
                      <p className="font-body-narrative text-primary text-xs mt-0.5">
                        {c.voice_signature?.speech_style || <span className="text-system-log/40">—</span>}
                      </p>
                    </div>
                    <div>
                      <div className="font-label-mono text-system-log/80 text-[10px]">思维模式</div>
                      <p className="font-body-narrative text-primary text-xs mt-0.5">
                        {c.voice_signature?.thought_patterns || <span className="text-system-log/40">—</span>}
                      </p>
                    </div>
                    <div>
                      <div className="font-label-mono text-system-log/80 text-[10px]">行为禁忌</div>
                      <div className="flex flex-wrap gap-1 mt-0.5">
                        {renderTags(c.voice_signature?.taboos)}
                      </div>
                    </div>
                  </div>

                  {/* 角色关系 */}
                  <div data-testid={`character-${c.id}-relations`} className="space-y-2">
                    <div className="font-label-mono text-system-log text-[10px] uppercase tracking-wider">角色关系</div>
                    {Object.keys(c.relations ?? {}).length === 0 ? (
                      <p className="font-body-ui text-system-log/40 text-xs">暂无</p>
                    ) : (
                      <ul className="space-y-1.5">
                        {Object.entries(c.relations ?? {}).map(([targetId, rel]) => (
                          <li
                            key={targetId}
                            className="flex items-center justify-between gap-2 p-1.5 bg-surface-container-low rounded"
                          >
                            <div className="min-w-0">
                              <div className="font-label-mono text-primary text-xs truncate">
                                {nameById.get(targetId) || targetId}
                              </div>
                              <div className="font-body-ui text-system-log/70 text-[10px]">
                                第{rel.last_update_chapter}章更新
                              </div>
                            </div>
                            <span className={`text-[10px] px-1.5 py-0.5 rounded font-body-ui shrink-0 ${relationStatusStyle(rel.status)}`}>
                              {rel.status}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              </li>
            ))}
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
    </div>
  );
}