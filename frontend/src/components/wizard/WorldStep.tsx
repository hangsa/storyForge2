import { useEffect, useRef, useState } from "react";
import api, { World } from "../../api/client";
import { useWizard } from "./WizardContext";
import TagEditor from "../shared/TagEditor";
import { RegenerateModal } from "../shared/RegenerateModal";

interface WorldStepProps {
  projectId: string;
}

const EMPTY_WORLD: World = {
  era: "",
  geography: "",
  era_social_structure: "",
  era_cultural_history: "",
  power_system: { name: "", description: "", stages: [], core_rules: [], ceilings: [] },
  factions: [],
  core_rules: [],
};

type FactionField = "name" | "type" | "goal" | "relations";

export default function WorldStep({ projectId }: WorldStepProps) {
  const wizard = useWizard();
  const [world, setWorld] = useState<World>(wizard.data.world ?? EMPTY_WORLD);
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
      const merged = { ...EMPTY_WORLD, ...result };
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

  const setPowerSystemField = <K extends "name" | "description" | "cost_system">(
    key: K,
    value: World["power_system"][K],
  ) => {
    setWorld({ ...world, power_system: { ...world.power_system, [key]: value } });
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
      setWorld(persisted);
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

  // 重新生成 / 确认修改并继续 are rendered by the modal footer; the step
  // just registers the handlers and the current busy state.
  useEffect(() => {
    const canRegenerate =
      !!wizard.data.world ||
      wizard.status === "completed" ||
      wizard.status === "error";
    const canSave = !!wizard.data.world || wizard.status === "completed";
    wizard.setRegenerateHandler(canRegenerate ? () => setShowRegenerateModal(true) : null, busy);
    wizard.setNextHandler(canSave ? handleNext : null, busy);
    return () => {
      wizard.setRegenerateHandler(null, false);
      wizard.setNextHandler(null, false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wizard.status, !!wizard.data.world, busy]);

  return (
    <div data-testid="world-step" className="space-y-4">
      {wizard.status === "generating" && (
        <div className="text-center py-12">
          <span className="material-symbols-outlined text-4xl text-primary-container animate-spin inline-block">progress_activity</span>
          <p className="font-body-ui text-system-log mt-3 text-sm">正在生成世界观…</p>
        </div>
      )}

      {wizard.status === "error" && (
        <div className="p-4 bg-error-container/20 border border-error rounded-lg text-error font-body-ui text-sm">
          {wizard.errorMessage}
        </div>
      )}

      {(wizard.status === "completed" || wizard.data.world) && (
        <div data-testid="world-form" className="space-y-4">
          {/* 时代与地理 */}
          <div className="border border-outline-variant rounded-lg p-4">
            <div className="font-label-mono text-system-log text-[10px] uppercase tracking-wider mb-3">时代与地理</div>
            <div className="space-y-3">
              <div>
                <label className="block font-label-mono text-system-log mb-1 text-xs">时代背景</label>
                <textarea
                  value={world.era}
                  onChange={(e) => setWorld({ ...world, era: e.target.value })}
                  rows={2}
                  className="w-full bg-surface-container border border-outline-variant rounded-lg px-3 py-2 text-sm text-primary focus:outline-none focus:border-primary-container resize-y"
                />
              </div>
              <div>
                <label className="block font-label-mono text-system-log mb-1 text-xs">地理环境</label>
                <textarea
                  value={world.geography}
                  onChange={(e) => setWorld({ ...world, geography: e.target.value })}
                  rows={2}
                  className="w-full bg-surface-container border border-outline-variant rounded-lg px-3 py-2 text-sm text-primary focus:outline-none focus:border-primary-container resize-y"
                />
              </div>
              <div>
                <label className="block font-label-mono text-primary-container mb-1 text-xs">
                  社会结构 <span className="ml-1 text-[10px] text-primary-container/70">[新增]</span>
                </label>
                <textarea
                  data-testid="world-era-social-structure"
                  value={world.era_social_structure ?? ""}
                  onChange={(e) => setWorld({ ...world, era_social_structure: e.target.value })}
                  rows={2}
                  className="w-full bg-surface-container border border-primary-container/40 rounded-lg px-3 py-2 text-sm text-primary focus:outline-none focus:border-primary-container resize-y"
                />
              </div>
              <div>
                <label className="block font-label-mono text-primary-container mb-1 text-xs">
                  历史文化 <span className="ml-1 text-[10px] text-primary-container/70">[新增]</span>
                </label>
                <textarea
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
            <div className="font-label-mono text-system-log text-[10px] uppercase tracking-wider mb-3">力量体系</div>
            <div className="space-y-3">
              <div>
                <label className="block font-label-mono text-system-log mb-1 text-xs">体系名称</label>
                <input
                  value={world.power_system.name}
                  onChange={(e) => setPowerSystemField("name", e.target.value)}
                  className="w-full bg-surface-container border border-outline-variant rounded-lg px-3 py-2 text-sm text-primary focus:outline-none focus:border-primary-container"
                />
              </div>
              <div>
                <label className="block font-label-mono text-system-log mb-1 text-xs">描述</label>
                <textarea
                  value={world.power_system.description}
                  onChange={(e) => setPowerSystemField("description", e.target.value)}
                  rows={2}
                  className="w-full bg-surface-container border border-outline-variant rounded-lg px-3 py-2 text-sm text-primary focus:outline-none focus:border-primary-container resize-y"
                />
              </div>
              <div>
                <label className="block font-label-mono text-system-log mb-1 text-xs">阶段划分</label>
                <div data-testid="world-power-stages">
                  <TagEditor
                    items={world.power_system.stages ?? []}
                    onItemsChange={(items) => setPowerSystemField("stages", items)}
                    saving={busy}
                  />
                </div>
              </div>
              <div>
                <label className="block font-label-mono text-system-log mb-1 text-xs">体系规则</label>
                <div data-testid="world-power-rules">
                  <TagEditor
                    items={world.power_system.core_rules ?? []}
                    onItemsChange={(items) => setPowerSystemField("core_rules", items)}
                    saving={busy}
                  />
                </div>
              </div>
              <div>
                <label className="block font-label-mono text-system-log mb-1 text-xs">力量上限</label>
                <div data-testid="world-power-ceilings">
                  <TagEditor
                    items={world.power_system.ceilings ?? []}
                    onItemsChange={(items) => setPowerSystemField("ceilings", items)}
                    saving={busy}
                  />
                </div>
              </div>
              <div>
                <label className="block font-label-mono text-system-log mb-1 text-xs">代价系统</label>
                <input
                  value={world.power_system.cost_system ?? ""}
                  onChange={(e) => setPowerSystemField("cost_system", e.target.value)}
                  className="w-full bg-surface-container border border-outline-variant rounded-lg px-3 py-2 text-sm text-primary focus:outline-none focus:border-primary-container"
                />
              </div>
            </div>
          </div>

          {/* 世界规则 */}
          <div className="border border-outline-variant rounded-lg p-4">
            <div className="font-label-mono text-system-log text-[10px] uppercase tracking-wider mb-3">世界规则</div>
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
              <div className="font-label-mono text-system-log text-[10px] uppercase tracking-wider">势力分布</div>
              <button
                type="button"
                data-testid="world-faction-add"
                onClick={addFaction}
                disabled={busy}
                className="flex items-center gap-1 px-2 py-1 text-xs border border-dashed
                           border-system-log/30 rounded text-system-log/60
                           hover:text-primary-container hover:border-primary-container/50
                           transition-colors disabled:opacity-30"
              >
                <span className="material-symbols-outlined text-xs">add</span>
                添加势力
              </button>
            </div>
            <div data-testid="world-factions" className="space-y-3">
              {world.factions.length === 0 && (
                <p className="font-body-ui text-system-log/40 text-xs text-center py-3">暂无势力</p>
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
                    className="absolute top-2 right-2 text-system-log/40 hover:text-error transition-colors disabled:opacity-30"
                  >
                    <span className="material-symbols-outlined text-sm">close</span>
                  </button>
                  <div className="grid grid-cols-2 gap-2 pr-6">
                    <div>
                      <label className="block font-label-mono text-system-log mb-1 text-[10px]">名称</label>
                      <input
                        data-testid={`world-faction-${i}-name`}
                        value={f.name}
                        onChange={(e) => updateFaction(i, "name", e.target.value)}
                        className="w-full bg-surface-container border border-outline-variant rounded px-2 py-1.5 text-xs text-primary focus:outline-none focus:border-primary-container"
                      />
                    </div>
                    <div>
                      <label className="block font-label-mono text-system-log mb-1 text-[10px]">类型</label>
                      <input
                        data-testid={`world-faction-${i}-type`}
                        value={f.type}
                        onChange={(e) => updateFaction(i, "type", e.target.value)}
                        className="w-full bg-surface-container border border-outline-variant rounded px-2 py-1.5 text-xs text-primary focus:outline-none focus:border-primary-container"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block font-label-mono text-system-log mb-1 text-[10px]">目标</label>
                    <textarea
                      data-testid={`world-faction-${i}-goal`}
                      value={f.goal}
                      onChange={(e) => updateFaction(i, "goal", e.target.value)}
                      rows={2}
                      className="w-full bg-surface-container border border-outline-variant rounded px-2 py-1.5 text-xs text-primary focus:outline-none focus:border-primary-container resize-y"
                    />
                  </div>
                  <div>
                    <label className="block font-label-mono text-system-log mb-1 text-[10px]">关系</label>
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