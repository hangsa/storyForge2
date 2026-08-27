import { useEffect, useRef, useState } from "react";
import api, { PowerSystem, World } from "../../api/client";
import { useWizard } from "./WizardContext";
import TagEditor from "../shared/TagEditor";
import { RegenerateModal } from "../shared/RegenerateModal";
import { SectionRegenerateButton } from "../shared/SectionRegenerateButton";
import { AutoTextarea } from "../shared/AutoTextarea";

interface WorldStepProps {
  projectId: string;
}

const EMPTY_WORLD: World = {
  era: "",
  geography: "",
  era_social_structure: "",
  era_cultural_history: "",
  power_systems: [],
  factions: [],
  core_rules: [],
};

/**
 * Normalize legacy/malformed world.json shapes. The LLM sometimes ignores
 * the prompt's string schema and produces nested objects for fields the
 * wizard expects as strings (proj_ec67d3e2 — `era_social_structure` was
 * returned as `{人类阶层, 异类阶层, 组织形态}` and `power_system.stages`
 * as `{人道阶, 地道阶, 天道阶}`). Without this, React's `<textarea
 * value={...}>` throws on the object and the form fails to render.
 *
 * The backend now coerces these via World model field_validators, but we
 * keep this as a defensive fallback so the form renders even if a stale
 * world.json slips through (e.g. cached response, in-flight save).
 *
 * This is also where the singular `power_system` of pre-multi-system
 * world.json gets folded into the `power_systems` array.
 */
function normalizeLegacyWorld(w: World | null): World {
  if (!w) return EMPTY_WORLD;
  const coerceString = (v: unknown): string => {
    if (typeof v === "string") return v;
    if (v && typeof v === "object") return JSON.stringify(v, null, 2);
    return "";
  };
  const coerceStages = (s: unknown): string[] => {
    if (Array.isArray(s)) return s.filter((x): x is string => typeof x === "string");
    if (s && typeof s === "object") {
      return Object.values(s as Record<string, unknown>)
        .flat()
        .filter((x): x is string => typeof x === "string");
    }
    return [];
  };
  const legacy = (w as World & { power_system?: unknown }).power_system;
  const raw: unknown[] = Array.isArray(w.power_systems)
    ? w.power_systems
    : legacy && typeof legacy === "object"
      ? [legacy]
      : [];
  const power_systems: PowerSystem[] = raw
    .filter((ps): ps is Record<string, unknown> => !!ps && typeof ps === "object")
    .map((ps) => ({
      name: coerceString(ps.name),
      description: coerceString(ps.description),
      stages: coerceStages(ps.stages),
      core_rules: coerceStages(ps.core_rules),
      ceilings: coerceStages(ps.ceilings),
      cost_system: coerceString(ps.cost_system),
    }));
  const next = {
    ...w,
    era_social_structure: coerceString(w.era_social_structure),
    era_cultural_history: coerceString(w.era_cultural_history),
    power_systems,
  };
  delete (next as World & { power_system?: unknown }).power_system;
  return next;
}

const EMPTY_POWER_SYSTEM: PowerSystem = {
  name: "",
  description: "",
  stages: [],
  core_rules: [],
  ceilings: [],
  cost_system: "",
};

type FactionField = "name" | "type" | "goal" | "relations";

export default function WorldStep({ projectId }: WorldStepProps) {
  const wizard = useWizard();
  const [world, setWorld] = useState<World>(normalizeLegacyWorld(wizard.data.world));
  const [busy, setBusy] = useState(false);
  const [showRegenerateModal, setShowRegenerateModal] = useState(false);
  // Mirror the latest `world` and `busy` so handlers registered in the
  // modal footer (with limited deps) always read fresh values, not the
  // snapshot from when the useEffect last ran.
  const worldRef = useRef(world);
  worldRef.current = world;
  const busyRef = useRef(busy);
  busyRef.current = busy;

  const handleStart = async (userModifications: string = "") => {
    wizard.startStep(2);
    setBusy(true);
    try {
      const result = await api.generateWorld(projectId, userModifications);
      const merged = normalizeLegacyWorld({ ...EMPTY_WORLD, ...result });
      setWorld(merged);
      // v1.8.4: mark generated so step 2 stays reachable in the indicator
      // when the user navigates away before clicking "下一步".
      wizard.markStepGenerated(2, { world: merged });
    } catch (e) {
      wizard.setStatus("error", e instanceof Error ? e.message : "世界观生成失败");
    } finally {
      setBusy(false);
    }
  };

  const handleNext = async () => {
    setBusy(true);
    try {
      await api.updateWorld(projectId, worldRef.current);
      wizard.saveStep(2, { world: worldRef.current });
    } catch (e) {
      wizard.setStatus("error", e instanceof Error ? e.message : "世界观保存失败");
    } finally {
      setBusy(false);
    }
  };

  const handleSave = async () => {
    setBusy(true);
    try {
      await api.updateWorld(projectId, worldRef.current);
      wizard.markStepGenerated(2, { world: worldRef.current });
    } catch (e) {
      wizard.setStatus("error", e instanceof Error ? e.message : "世界观保存失败");
    } finally {
      setBusy(false);
    }
  };

  const handleSectionRegenerate = (
    section: "era" | "power_system" | "core_rules" | "factions",
  ) => async (mods: string) => {
    try {
      const result = await api.regenerateWorldSection(projectId, section, mods);
      const merged = normalizeLegacyWorld({ ...EMPTY_WORLD, ...result });
      setWorld(merged);
      wizard.markStepGenerated(2, { world: merged });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "板块重新生成失败";
      wizard.setStatus("error", msg);
      // Re-throw so SectionRegenerateButton can surface the failure toast.
      throw new Error(msg);
    }
  };

  const handleItemRegenerate = (index: number) => async (mods: string) => {
    try {
      const result = await api.regeneratePowerSystemItem(projectId, index, mods);
      const merged = normalizeLegacyWorld(result.world);
      setWorld(merged);
      wizard.markStepGenerated(2, { world: merged });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "体系重新生成失败";
      wizard.setStatus("error", msg);
      // Re-throw so SectionRegenerateButton can surface the failure toast.
      throw new Error(msg);
    }
  };

  const updatePowerSystem = <K extends keyof PowerSystem>(
    index: number,
    key: K,
    value: PowerSystem[K],
  ) => {
    const next = world.power_systems.map((ps, i) =>
      i === index ? { ...ps, [key]: value } : ps,
    );
    setWorld({ ...world, power_systems: next });
  };

  // Add a blank power-system card AND immediately persist the new array to
  // disk. Without the persist, the user clicks ↻ on the new card and gets
  // "system_index 1 超出范围 (0..0)" — the backend reads world.json (which
  // still has only N slots) and rejects the index. Persisting here keeps
  // the wizard's slot count in lockstep with what the user sees on screen.
  //
  // Button text stays "添加体系" — the user-facing affordance didn't change,
  // only the side-effect.
  const addPowerSystem = async () => {
    if (busy) return;
    const next: World = {
      ...world,
      power_systems: [...world.power_systems, { ...EMPTY_POWER_SYSTEM }],
    };
    // Optimistic: render the new card right away. The persist round-trip
    // is short enough not to justify a spinner on the button, and on
    // failure we keep the local state so the user can remove the card
    // manually rather than be confused by it vanishing mid-typing.
    setWorld(next);
    setBusy(true);
    try {
      await api.updateWorld(projectId, next);
      // Keep wizard.data.world in sync so navigating away and back doesn't
      // drop the just-added slot from view. updateData deliberately does
      // NOT mark step 2 "completed" — the user has only added an empty
      // slot, not generated content.
      wizard.updateData({ world: next });
    } catch (e) {
      wizard.setStatus(
        "error",
        e instanceof Error ? e.message : "新增力量体系失败",
      );
    } finally {
      setBusy(false);
    }
  };

  const removePowerSystem = (index: number) => {
    setWorld({ ...world, power_systems: world.power_systems.filter((_, i) => i !== index) });
  };

  const updateFaction = (index: number, field: FactionField, value: string) => {
    const next = world.factions.map((f, i) => (i === index ? { ...f, [field]: value } : f));
    setWorld({ ...world, factions: next });
  };

  const addFaction = () => {
    setWorld({
      ...world,
      factions: [...world.factions, { name: "", type: "", goal: "", relations: "" }],
    });
  };

  const removeFaction = (index: number) => {
    setWorld({ ...world, factions: world.factions.filter((_, i) => i !== index) });
  };

  // Sync local `world` state from wizard.data when prefill lands. Only
  // overwrite if the user hasn't typed anything (local state still EMPTY).
  useEffect(() => {
    const persisted = wizard.data.world;
    if (persisted && world.era === "" && world.geography === "") {
      setWorld(normalizeLegacyWorld(persisted));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wizard.data.world]);

  // Auto-trigger generation on mount if no world has been generated yet.
  // Errors keep the error UI visible so the user can hit "重新生成" in the footer.
  //
  // v1.8.2: wait for prefill to finish before deciding — same race-condition
  // fix as OutlineStep (proj_cc4ca4ae regression).
  useEffect(() => {
    if (!wizard.prefillComplete) return;
    if (
      !wizard.data.world &&
      wizard.status !== "generating" &&
      wizard.status !== "error"
    ) {
      handleStart();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wizard.prefillComplete]);

  // 重新生成 / 保存修改 / 确认修改并继续 are rendered by the modal footer;
  // the step just registers the handlers and the current busy state.
  useEffect(() => {
    const canRegenerate =
      !!wizard.data.world ||
      wizard.status === "completed" ||
      wizard.status === "error";
    const canSave = !!wizard.data.world || wizard.status === "completed";
    wizard.setRegenerateHandler(canRegenerate ? () => setShowRegenerateModal(true) : null, busy);
    wizard.setSaveHandler(canSave ? handleSave : null, busy);
    wizard.setNextHandler(canSave ? handleNext : null, busy);
    return () => {
      wizard.setRegenerateHandler(null, false);
      wizard.setSaveHandler(null, false);
      wizard.setNextHandler(null, false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wizard.status, !!wizard.data.world, busy]);

  return (
    <div data-testid="world-step" className="space-y-4">
      {wizard.status === "generating" && (
        <div className="text-center py-12">
          <span className="material-symbols-outlined text-4xl text-primary-container animate-spin inline-block">progress_activity</span>
          <p className="font-body text-body-md text-primary-container mt-3 text-sm">正在生成世界观…</p>
        </div>
      )}

      {wizard.status === "error" && (
        <div className="p-4 bg-error-container/20 border border-error rounded-lg text-error font-body text-body-md text-sm">
          {wizard.errorMessage}
        </div>
      )}

      {(wizard.status === "completed" || wizard.data.world) && (
        <div data-testid="world-form" className="space-y-4">
          {/* 时代与地理 */}
          <div className="border border-outline-variant rounded-lg p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="font-mono text-primary-container text-[10px] uppercase tracking-wider">时代与地理</div>
              <SectionRegenerateButton
                target="时代与地理"
                onRegenerate={handleSectionRegenerate("era")}
                testId="world-era-regenerate"
              />
            </div>
            <div className="space-y-3">
              <div>
                <label className="block font-mono text-primary-container mb-1 text-xs">时代背景</label>
                <AutoTextarea
                  value={world.era}
                  onChange={(e) => setWorld({ ...world, era: e.target.value })}
                  rows={2}
                  className="w-full bg-surface-container border border-outline-variant rounded-lg px-3 py-2 text-sm text-primary focus:outline-none focus:border-primary-container resize-y"
                />
              </div>
              <div>
                <label className="block font-mono text-primary-container mb-1 text-xs">地理环境</label>
                <AutoTextarea
                  value={world.geography}
                  onChange={(e) => setWorld({ ...world, geography: e.target.value })}
                  rows={2}
                  className="w-full bg-surface-container border border-outline-variant rounded-lg px-3 py-2 text-sm text-primary focus:outline-none focus:border-primary-container resize-y"
                />
              </div>
              <div>
                <label className="block font-mono text-primary-container mb-1 text-xs">
                  社会结构 <span className="ml-1 text-[10px] text-primary-container/70">[新增]</span>
                </label>
                <AutoTextarea
                  data-testid="world-era-social-structure"
                  value={world.era_social_structure ?? ""}
                  onChange={(e) => setWorld({ ...world, era_social_structure: e.target.value })}
                  rows={2}
                  className="w-full bg-surface-container border border-primary-container/40 rounded-lg px-3 py-2 text-sm text-primary focus:outline-none focus:border-primary-container resize-y"
                />
              </div>
              <div>
                <label className="block font-mono text-primary-container mb-1 text-xs">
                  历史文化 <span className="ml-1 text-[10px] text-primary-container/70">[新增]</span>
                </label>
                <AutoTextarea
                  data-testid="world-era-cultural-history"
                  value={world.era_cultural_history ?? ""}
                  onChange={(e) => setWorld({ ...world, era_cultural_history: e.target.value })}
                  rows={2}
                  className="w-full bg-surface-container border border-primary-container/40 rounded-lg px-3 py-2 text-sm text-primary focus:outline-none focus:border-primary-container resize-y"
                />
              </div>
            </div>
          </div>

          {/* 力量体系 */}
          <div className="border border-outline-variant rounded-lg p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="font-mono text-primary-container text-[10px] uppercase tracking-wider">力量体系</div>
              <div className="flex items-center gap-1">
                <SectionRegenerateButton
                  target="力量体系"
                  onRegenerate={handleSectionRegenerate("power_system")}
                  testId="world-power-system-regenerate"
                />
                <button
                  type="button"
                  data-testid="world-power-system-add"
                  onClick={addPowerSystem}
                  disabled={busy}
                  className="flex items-center gap-1 px-2 py-1 text-xs border border-dashed
                             border-system-log/30 rounded text-primary-container/60
                             hover:text-primary-container hover:border-primary-container/50
                             transition-colors disabled:opacity-30"
                >
                  <span className="material-symbols-outlined text-xs">add</span>
                  添加体系
                </button>
              </div>
            </div>
            <div data-testid="world-power-systems" className="space-y-3">
              {world.power_systems.length === 0 && (
                <p className="font-body text-body-md text-primary-container/40 text-xs text-center py-3">暂无力量体系</p>
              )}
              {world.power_systems.map((ps, i) => (
                <div
                  key={i}
                  data-testid={`world-power-system-${i}`}
                  className="border border-outline-variant rounded p-3 space-y-2 relative"
                >
                  <div className="absolute top-2 right-2 flex items-center gap-1">
                    <SectionRegenerateButton
                      target={`力量体系: ${ps.name || `#${i + 1}`}`}
                      onRegenerate={handleItemRegenerate(i)}
                      testId={`world-power-system-${i}-regenerate`}
                    />
                    <button
                      type="button"
                      data-testid={`world-power-system-${i}-remove`}
                      onClick={() => removePowerSystem(i)}
                      disabled={busy}
                      aria-label="删除力量体系"
                      className="text-primary-container/40 hover:text-error transition-colors disabled:opacity-30"
                    >
                      <span className="material-symbols-outlined text-sm">close</span>
                    </button>
                  </div>
                  <div className="pr-6">
                    <label className="block font-mono text-primary-container mb-1 text-[10px]">体系名称</label>
                    <input
                      data-testid={`world-power-system-${i}-name`}
                      value={ps.name}
                      onChange={(e) => updatePowerSystem(i, "name", e.target.value)}
                      className="w-full bg-surface-container border border-outline-variant rounded px-2 py-1.5 text-xs text-primary focus:outline-none focus:border-primary-container"
                    />
                  </div>
                  <div>
                    <label className="block font-mono text-primary-container mb-1 text-[10px]">描述</label>
                    <AutoTextarea
                      data-testid={`world-power-system-${i}-description`}
                      value={ps.description}
                      onChange={(e) => updatePowerSystem(i, "description", e.target.value)}
                      rows={2}
                      className="w-full bg-surface-container border border-outline-variant rounded px-2 py-1.5 text-xs text-primary focus:outline-none focus:border-primary-container resize-y"
                    />
                  </div>
                  <div>
                    <label className="block font-mono text-primary-container mb-1 text-[10px]">阶段划分</label>
                    <div data-testid={`world-power-system-${i}-stages`}>
                      <TagEditor
                        items={ps.stages ?? []}
                        onItemsChange={(items) => updatePowerSystem(i, "stages", items)}
                        saving={busy}
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block font-mono text-primary-container mb-1 text-[10px]">体系规则</label>
                    <div data-testid={`world-power-system-${i}-rules`}>
                      <TagEditor
                        items={ps.core_rules ?? []}
                        onItemsChange={(items) => updatePowerSystem(i, "core_rules", items)}
                        saving={busy}
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block font-mono text-primary-container mb-1 text-[10px]">力量上限</label>
                    <div data-testid={`world-power-system-${i}-ceilings`}>
                      <TagEditor
                        items={ps.ceilings ?? []}
                        onItemsChange={(items) => updatePowerSystem(i, "ceilings", items)}
                        saving={busy}
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block font-mono text-primary-container mb-1 text-[10px]">代价系统</label>
                    <input
                      data-testid={`world-power-system-${i}-cost`}
                      value={ps.cost_system ?? ""}
                      onChange={(e) => updatePowerSystem(i, "cost_system", e.target.value)}
                      className="w-full bg-surface-container border border-outline-variant rounded px-2 py-1.5 text-xs text-primary focus:outline-none focus:border-primary-container"
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* 世界规则 */}
          <div className="border border-outline-variant rounded-lg p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="font-mono text-primary-container text-[10px] uppercase tracking-wider">世界规则</div>
              <SectionRegenerateButton
                target="世界规则"
                onRegenerate={handleSectionRegenerate("core_rules")}
                testId="world-core-rules-regenerate"
              />
            </div>
            <div data-testid="world-core-rules">
              <TagEditor
                items={world.core_rules ?? []}
                onItemsChange={(items) => setWorld({ ...world, core_rules: items })}
                saving={busy}
              />
            </div>
          </div>

          {/* 势力分布 */}
          <div className="border border-outline-variant rounded-lg p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="font-mono text-primary-container text-[10px] uppercase tracking-wider">势力分布</div>
              <div className="flex items-center gap-1">
                <SectionRegenerateButton
                  target="势力分布"
                  onRegenerate={handleSectionRegenerate("factions")}
                  testId="world-factions-regenerate"
                />
                <button
                  type="button"
                  data-testid="world-faction-add"
                  onClick={addFaction}
                  disabled={busy}
                  className="flex items-center gap-1 px-2 py-1 text-xs border border-dashed
                             border-system-log/30 rounded text-primary-container/60
                             hover:text-primary-container hover:border-primary-container/50
                             transition-colors disabled:opacity-30"
                >
                  <span className="material-symbols-outlined text-xs">add</span>
                  添加势力
                </button>
              </div>
            </div>
            <div data-testid="world-factions" className="space-y-3">
              {world.factions.length === 0 && (
                <p className="font-body text-body-md text-primary-container/40 text-xs text-center py-3">暂无势力</p>
              )}
              {world.factions.map((f, i) => (
                <div
                  key={i}
                  data-testid={`world-faction-${i}`}
                  className="border border-outline-variant rounded p-3 space-y-2 relative"
                >
                  <button
                    type="button"
                    data-testid={`world-faction-${i}-remove`}
                    onClick={() => removeFaction(i)}
                    disabled={busy}
                    aria-label="删除势力"
                    className="absolute top-2 right-2 text-primary-container/40 hover:text-error transition-colors disabled:opacity-30"
                  >
                    <span className="material-symbols-outlined text-sm">close</span>
                  </button>
                  <div className="grid grid-cols-2 gap-2 pr-6">
                    <div>
                      <label className="block font-mono text-primary-container mb-1 text-[10px]">名称</label>
                      <input
                        data-testid={`world-faction-${i}-name`}
                        value={f.name}
                        onChange={(e) => updateFaction(i, "name", e.target.value)}
                        className="w-full bg-surface-container border border-outline-variant rounded px-2 py-1.5 text-xs text-primary focus:outline-none focus:border-primary-container"
                      />
                    </div>
                    <div>
                      <label className="block font-mono text-primary-container mb-1 text-[10px]">类型</label>
                      <input
                        data-testid={`world-faction-${i}-type`}
                        value={f.type}
                        onChange={(e) => updateFaction(i, "type", e.target.value)}
                        className="w-full bg-surface-container border border-outline-variant rounded px-2 py-1.5 text-xs text-primary focus:outline-none focus:border-primary-container"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block font-mono text-primary-container mb-1 text-[10px]">目标</label>
                    <AutoTextarea
                      data-testid={`world-faction-${i}-goal`}
                      value={f.goal}
                      onChange={(e) => updateFaction(i, "goal", e.target.value)}
                      rows={2}
                      className="w-full bg-surface-container border border-outline-variant rounded px-2 py-1.5 text-xs text-primary focus:outline-none focus:border-primary-container resize-y"
                    />
                  </div>
                  <div>
                    <label className="block font-mono text-primary-container mb-1 text-[10px]">关系</label>
                    <input
                      data-testid={`world-faction-${i}-relations`}
                      value={f.relations}
                      onChange={(e) => updateFaction(i, "relations", e.target.value)}
                      className="w-full bg-surface-container border border-outline-variant rounded px-2 py-1.5 text-xs text-primary focus:outline-none focus:border-primary-container"
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* 重新生成 / 确认修改并继续 buttons moved to modal footer (see useEffect above). */}
        </div>
      )}

      <RegenerateModal
        open={showRegenerateModal}
        target="世界观"
        onConfirm={async (text) => {
          setShowRegenerateModal(false);
          await handleStart(text);
        }}
        onCancel={() => setShowRegenerateModal(false)}
      />
    </div>
  );
}