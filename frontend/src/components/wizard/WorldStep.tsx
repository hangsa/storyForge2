import { useState } from "react";
import api, { World } from "../../api/client";
import { useWizard } from "./WizardContext";

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

export default function WorldStep({ projectId }: WorldStepProps) {
  const wizard = useWizard();
  const [world, setWorld] = useState<World>(wizard.data.world ?? EMPTY_WORLD);
  const [busy, setBusy] = useState(false);

  const handleStart = async () => {
    wizard.startStep(2);
    setBusy(true);
    try {
      const result = await api.generateWorld(projectId);
      setWorld({ ...EMPTY_WORLD, ...result });
      wizard.setStatus("completed");
    } catch (e) {
      wizard.setStatus("error", e instanceof Error ? e.message : "世界观生成失败");
    } finally {
      setBusy(false);
    }
  };

  const handleNext = async () => {
    setBusy(true);
    try {
      await api.updateWorld(projectId, world);
      wizard.saveStep(2, { world });
    } catch (e) {
      wizard.setStatus("error", e instanceof Error ? e.message : "世界观保存失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div data-testid="world-step" className="space-y-4">
      {wizard.status === "idle" && (
        <div data-testid="world-idle" className="text-center py-12">
          <span className="material-symbols-outlined text-5xl text-system-log/30 mb-4 block">public</span>
          <p className="font-body-ui text-system-log mb-6">点击下方按钮生成世界观</p>
          <button
            data-testid="world-start"
            onClick={handleStart}
            disabled={busy}
            className="px-5 py-2.5 bg-primary-container text-surface-container-low font-body-ui rounded-lg hover:opacity-90 disabled:opacity-40"
          >
            {busy ? "生成中…" : "开始生成"}
          </button>
        </div>
      )}

      {wizard.status === "generating" && (
        <div className="text-center py-12">
          <span className="material-symbols-outlined text-4xl text-primary-container animate-spin inline-block">progress_activity</span>
          <p className="font-body-ui text-system-log mt-3 text-sm">正在生成世界观…</p>
        </div>
      )}

      {wizard.status === "error" && (
        <div className="p-4 bg-error-container/20 border border-error rounded-lg text-error font-body-ui text-sm">
          {wizard.errorMessage}
          <button onClick={handleStart} className="ml-3 px-3 py-1 bg-surface-container text-primary rounded text-xs">重试</button>
        </div>
      )}

      {(wizard.status === "completed" || wizard.data.world) && (
        <div data-testid="world-form" className="space-y-4">
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

          <div className="border border-outline-variant rounded-lg p-4">
            <div className="font-label-mono text-system-log text-[10px] uppercase tracking-wider mb-3">力量体系</div>
            <div className="space-y-3">
              <div>
                <label className="block font-label-mono text-system-log mb-1 text-xs">体系名称</label>
                <input
                  value={world.power_system.name}
                  onChange={(e) => setWorld({ ...world, power_system: { ...world.power_system, name: e.target.value } })}
                  className="w-full bg-surface-container border border-outline-variant rounded-lg px-3 py-2 text-sm text-primary focus:outline-none focus:border-primary-container"
                />
              </div>
              <div>
                <label className="block font-label-mono text-system-log mb-1 text-xs">描述</label>
                <textarea
                  value={world.power_system.description}
                  onChange={(e) => setWorld({ ...world, power_system: { ...world.power_system, description: e.target.value } })}
                  rows={2}
                  className="w-full bg-surface-container border border-outline-variant rounded-lg px-3 py-2 text-sm text-primary focus:outline-none focus:border-primary-container resize-y"
                />
              </div>
              <div>
                <label className="block font-label-mono text-system-log mb-1 text-xs">代价系统</label>
                <input
                  value={world.power_system.cost_system ?? ""}
                  onChange={(e) => setWorld({ ...world, power_system: { ...world.power_system, cost_system: e.target.value } })}
                  className="w-full bg-surface-container border border-outline-variant rounded-lg px-3 py-2 text-sm text-primary focus:outline-none focus:border-primary-container"
                />
              </div>
            </div>
          </div>

          <div className="flex justify-between pt-2">
            <button
              data-testid="world-regenerate"
              onClick={handleStart}
              disabled={busy}
              className="px-4 py-2 text-sm bg-surface-container text-system-log rounded-lg hover:bg-surface-container-low disabled:opacity-40"
            >
              重新生成
            </button>
            <button
              data-testid="world-next"
              onClick={handleNext}
              disabled={busy}
              className="px-5 py-2 bg-tertiary-container text-surface-container-low text-sm rounded-lg hover:opacity-90 disabled:opacity-40"
            >
              {busy ? "保存中…" : "下一步"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
