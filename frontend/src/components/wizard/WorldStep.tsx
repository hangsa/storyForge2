import { useEffect, useMemo, useRef, useState } from "react";
import api, { CoreRule, PowerSystem, World } from "../../api/client";
import { useWizard } from "./WizardContext";
import TagEditor from "../shared/TagEditor";
import { RegenerateModal } from "../shared/RegenerateModal";
import {
  SectionRegenerateButton,
  useSectionRegenerate,
} from "../shared/SectionRegenerateButton";
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
      // 2026-09-20 (修订 F): source 是修订 B2 新加字段 — 老 world.json
      // 缺失时显式默认 "energetics",让 PowerSystemsPanel 的徽章 / 边框
      // 分支路径不会因为 undefined 走错分支(energetics = 无徽章,逻辑上
      // 等价于旧版)。不写入 JSON 是为了保留后端缺省行为,前端不替后端
      // 做主。
      source: typeof ps.source === "string" ? ps.source : "energetics",
    }));
  // 2026-09-20 (修订 F): core_rules 旧版是 string[] — 新 schema 是
  // `Array<{category, text}>`. 老 world.json 读到后,所有字符串塞进
  // category="physical" group(物理公理是 4 组里默认承载面最广的)。
  // 显式保留任何已经是对象形态的项(category 字段缺失时也降级 physical)。
  const rawCoreRules: unknown[] = Array.isArray(w.core_rules) ? w.core_rules : [];
  const core_rules: CoreRule[] = rawCoreRules
    .map((r): CoreRule | null => {
      if (typeof r === "string") return { category: "physical", text: r };
      if (r && typeof r === "object") {
        const obj = r as Record<string, unknown>;
        const cat = typeof obj["category"] === "string" ? (obj["category"] as string) : "physical";
        const text = typeof obj["text"] === "string" ? (obj["text"] as string) : "";
        return { category: cat, text };
      }
      return null;
    })
    .filter((r): r is CoreRule => r !== null && r.text !== "");
  const next = {
    ...w,
    era_social_structure: coerceString(w.era_social_structure),
    era_cultural_history: coerceString(w.era_cultural_history),
    power_systems,
    core_rules,
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
  source: "energetics",
};

type FactionField = "name" | "type" | "goal" | "relations";

// 2026-09-20: WorldStep 改为 sticky 横条 tab + 4 个 panel 的布局(对齐 S2 的
// dimension-tabs 模式)。activeKey 决定哪个 panel 真正可见,非激活 panel 用
// `hidden` 隐藏(保留 DOM + 所有 testid,便于单测零侵入)。
const WORLD_TABS = [
  { key: "era", label: "时代与地理", icon: "landscape" },
  { key: "power_system", label: "力量体系", icon: "bolt" },
  { key: "core_rules", label: "世界规则", icon: "rule" },
  { key: "factions", label: "势力分布", icon: "groups" },
] as const;
type WorldTabKey = (typeof WORLD_TABS)[number]["key"];

const TAB_COUNT: Record<WorldTabKey, (w: World) => number> = {
  era: () => 4,
  power_system: (w) => w.power_systems.length,
  core_rules: (w) => w.core_rules.length,
  factions: (w) => w.factions.length,
};

export default function WorldStep({ projectId }: WorldStepProps) {
  const wizard = useWizard();
  const [world, setWorld] = useState<World>(normalizeLegacyWorld(wizard.data.world));
  const [busy, setBusy] = useState(false);
  const [showRegenerateModal, setShowRegenerateModal] = useState(false);
  const [activeKey, setActiveKey] = useState<WorldTabKey>("era");
  // 2026-09-20: 每顶级 tab 各自记忆 active sub-tab
  const [subTab, setSubTab] = useState<Record<WorldTabKey, string>>({
    era: "era",
    power_system: "",
    core_rules: "",
    factions: "",
  });
  const updateSubTab = (key: WorldTabKey) => (subKey: string) => {
    setSubTab((prev) => ({ ...prev, [key]: subKey }));
  };
  // Mirror the latest `world` and `busy` so handlers registered in the
  // modal footer (with limited deps) always read fresh values, not the
  // snapshot from when the useEffect last ran.
  const worldRef = useRef(world);
  worldRef.current = world;
  const busyRef = useRef(busy);
  busyRef.current = busy;

  const handleTabKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    // Task 2: ← / → 切换 tab + 焦点跟随。
    // - 阻止默认滚动 (e.preventDefault)
    // - 边界环绕 (← 从第 1 个绕到最后, → 从最后绕到第 1 个)
    // - queueMicrotask 等 React 提交 DOM 更新后再 focus 新 tab,保证
    //   document.activeElement 与 aria-selected 同步 (jsdom 的 rAF/setTimeout
    //   不能被 @testing-library/react 的 act 自动 drain,微任务可以)
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const idx = WORLD_TABS.findIndex((t) => t.key === activeKey);
    const nextIdx = e.key === "ArrowRight"
      ? (idx + 1) % WORLD_TABS.length
      : (idx - 1 + WORLD_TABS.length) % WORLD_TABS.length;
    const nextKey = WORLD_TABS[nextIdx].key;
    setActiveKey(nextKey);
    queueMicrotask(() => {
      const nextTab = document.querySelector<HTMLButtonElement>(
        `[data-testid="world-tab-${nextKey}"]`,
      );
      nextTab?.focus();
    });
  };

  const handleStart = async (userModifications: string = "") => {
    wizard.startStep(wizard.currentStep);
    setBusy(true);
    try {
      const result = await api.generateWorld(projectId, userModifications);
      const merged = normalizeLegacyWorld({ ...EMPTY_WORLD, ...result });
      setWorld(merged);
      // v1.8.4: mark generated so step 2 stays reachable in the indicator
      // when the user navigates away before clicking "下一步".
      wizard.markStepGenerated(wizard.currentStep, { world: merged });
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
      wizard.saveStep(wizard.currentStep, { world: worldRef.current });
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
      wizard.markStepGenerated(wizard.currentStep, { world: worldRef.current });
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
      wizard.markStepGenerated(wizard.currentStep, { world: merged });
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
      wizard.markStepGenerated(wizard.currentStep, { world: merged });
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
          <WorldTabs
            activeKey={activeKey}
            counts={{
              era: TAB_COUNT.era(world),
              power_system: TAB_COUNT.power_system(world),
              core_rules: TAB_COUNT.core_rules(world),
              factions: TAB_COUNT.factions(world),
            }}
            regenerateDisabled={busy}
            onTabChange={setActiveKey}
            onRegenerateEra={handleSectionRegenerate("era")}
            onRegeneratePowerSystem={handleSectionRegenerate("power_system")}
            onRegenerateCoreRules={handleSectionRegenerate("core_rules")}
            onRegenerateFactions={handleSectionRegenerate("factions")}
            onTabKeyDown={handleTabKeyDown}
          />

          <EraPanel
            active={activeKey === "era"}
            projectId={projectId}
            world={world} setWorld={setWorld} busy={busy}
            activeSubTab={subTab.era}
            onSubTabChange={updateSubTab("era")}
          />
          <PowerSystemsPanel
            active={activeKey === "power_system"}
            projectId={projectId}
            world={world}
            setWorld={setWorld}
            busy={busy}
            activeSubTab={subTab.power_system}
            onSubTabChange={updateSubTab("power_system")}
            onAdd={addPowerSystem}
            onUpdateField={updatePowerSystem}
            onRemove={removePowerSystem}
            onRegenerateItem={(i) => handleItemRegenerate(i)}
          />
          <CoreRulesPanel
            active={activeKey === "core_rules"}
            projectId={projectId}
            world={world} setWorld={setWorld} busy={busy}
            activeSubTab={subTab.core_rules}
            onSubTabChange={updateSubTab("core_rules")}
          />
          <FactionsPanel
            active={activeKey === "factions"}
            projectId={projectId}
            world={world}
            setWorld={setWorld}
            busy={busy}
            activeSubTab={subTab.factions}
            onSubTabChange={updateSubTab("factions")}
            onAdd={addFaction}
            onUpdateField={updateFaction}
            onRemove={removeFaction}
          />
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

// ===========================================================================
// 2026-09-20: tab + panel 子组件。
// - WorldTabs    sticky 横条,4 个 tab + 各自的 SectionRegenerateButton
// - EraPanel     时代 + 地理 + 2 个新增字段 (固定 4 个)
// - PowerSystemsPanel  力量体系卡片数组 + 添加按钮
// - CoreRulesPanel     世界规则 TagEditor
// - FactionsPanel      势力卡片数组 + 添加按钮
// 五个组件都是 file-internal,只给 WorldStep 主组件使用。
// ===========================================================================

function WorldTabs({
  activeKey, counts, regenerateDisabled, onTabChange,
  onRegenerateEra, onRegeneratePowerSystem, onRegenerateCoreRules, onRegenerateFactions,
  onTabKeyDown,
}: {
  activeKey: WorldTabKey;
  counts: Record<WorldTabKey, number>;
  regenerateDisabled: boolean;
  onTabChange: (key: WorldTabKey) => void;
  onRegenerateEra: (mods: string) => Promise<void>;
  onRegeneratePowerSystem: (mods: string) => Promise<void>;
  onRegenerateCoreRules: (mods: string) => Promise<void>;
  onRegenerateFactions: (mods: string) => Promise<void>;
  onTabKeyDown: (e: React.KeyboardEvent<HTMLButtonElement>) => void;
}) {
  // 2026-09-20: spec 要求 ↻ 是 `<button role="tab">` 的 child(用户 Q1 决定,
  // design doc section 4 lines 88-114 + plan step 5 + design doc "风险与注意"
  // line 289)。不能直接嵌 `<button>` 进 `<button>`(HTML nesting 规则),所以
  // 用 `<span role="button">` 作为 inner trigger — 这是 design doc 写明的 a11y
  // 解决方案。useSectionRegenerate 是从 SectionRegenerateButton 抽出来的 hook,
  // 仍然负责 RegenerateModal + wizard footer status badge,只是把 trigger 元素
  // 的所有权交还给调用者。
  const era = useSectionRegenerate({
    target: "时代与地理",
    onRegenerate: onRegenerateEra,
    disabled: regenerateDisabled,
    testId: "world-tab-era-regenerate",
  });
  const power_system = useSectionRegenerate({
    target: "力量体系",
    onRegenerate: onRegeneratePowerSystem,
    disabled: regenerateDisabled,
    testId: "world-tab-power_system-regenerate",
  });
  const core_rules = useSectionRegenerate({
    target: "世界规则",
    onRegenerate: onRegenerateCoreRules,
    disabled: regenerateDisabled,
    testId: "world-tab-core_rules-regenerate",
  });
  const factions = useSectionRegenerate({
    target: "势力分布",
    onRegenerate: onRegenerateFactions,
    disabled: regenerateDisabled,
    testId: "world-tab-factions-regenerate",
  });
  const regenFor = { era, power_system, core_rules, factions };

  return (
    <>
      <div
        role="tablist"
        aria-label="世界观分区"
        data-testid="world-tabs"
        className="sticky top-0 z-10 -mx-6 px-6 bg-surface-container-low/95 backdrop-blur-sm flex gap-1 border-b border-outline-variant overflow-x-auto"
      >
        {WORLD_TABS.map(({ key, label, icon }) => {
          const isActive = activeKey === key;
          const regen = regenFor[key];
          return (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={isActive}
              aria-controls={`world-panel-${key}`}
              data-testid={`world-tab-${key}`}
              onClick={() => onTabChange(key)}
              onKeyDown={onTabKeyDown}
              className={
                "shrink-0 px-3 py-2 text-sm font-display font-medium inline-flex items-center border-b-2 -mb-px gap-2 transition-colors outline-none focus-visible:ring-2 ring-primary-container " +
                (isActive
                  ? "border-primary text-primary"
                  : "border-transparent text-on-surface-variant hover:text-primary")
              }
            >
              <span aria-hidden="true" className="material-symbols-outlined text-base leading-none">{icon}</span>
              <span>{label}</span>
              <span className="font-mono text-[10px] opacity-70" aria-label={`${counts[key]} 个`}>
                {counts[key]}
              </span>
              {/* Inner ↻ affordance — `<span role="button">` lives inside the
                  outer `<button role="tab">`. triggerProps.onClick already
                  calls e.stopPropagation() so it doesn't bubble to onTabChange,
                  and Enter/Space work via the hook's onKeyDown. We pass a
                  custom className here because the trigger's default
                  `disabled:cursor-not-allowed disabled:opacity-40` only works
                  on form elements — `<span>` doesn't react to `disabled`. The
                  trigger exposes `data-disabled="true"` and `aria-disabled`
                  instead, which the Tailwind `data-[disabled=true]:` variant
                  can target. */}
              <span
                {...regen.triggerProps}
                className="ml-1 inline-flex items-center justify-center w-5 h-5 rounded text-system-log/50 hover:text-primary-container hover:bg-surface-container transition-colors data-[disabled=true]:cursor-not-allowed data-[disabled=true]:opacity-30"
              >
                <span
                  className={`material-symbols-outlined text-[14px] leading-none${regen.busy ? " animate-spin text-primary-container" : ""}`}
                  data-testid={regen.busy ? `${regen.triggerProps["data-testid"]}-spinner` : undefined}
                  aria-hidden="true"
                >
                  {regen.busy ? "progress_activity" : "refresh"}
                </span>
              </span>
            </button>
          );
        })}
      </div>
      {/* Modals live outside the tab strip so they aren't trapped inside the
          sticky container. Each tab owns its own modal instance; only one can
          be open at a time because clicking another tab's ↻ closes the previous
          one via setOpen(false) on confirm/cancel. */}
      {era.modal}
      {power_system.modal}
      {core_rules.modal}
      {factions.modal}
    </>
  );
}

function EraPanel({
  active, projectId, world, setWorld, busy, activeSubTab, onSubTabChange,
}: {
  active: boolean;
  projectId: string;
  world: World;
  setWorld: (w: World) => void;
  busy: boolean;
  activeSubTab: string;
  onSubTabChange: (key: string) => void;
}) {
  // 临时: 把 props 接进来但暂不渲染 sub-tab,避免 TS 报错
  void projectId; void activeSubTab; void onSubTabChange;
  return (
    <div
      role="tabpanel"
      id="world-panel-era"
      aria-labelledby="world-tab-era"
      hidden={!active}
      data-testid="world-panel-era"
      className="space-y-3"
    >
      <div>
        <label className="block font-mono text-primary-container mb-1 text-xs">时代背景</label>
        <AutoTextarea
          value={world.era}
          onChange={(e) => setWorld({ ...world, era: e.target.value })}
          rows={2}
          disabled={busy}
          className="w-full bg-surface-container border border-outline-variant rounded-lg px-3 py-2 text-sm text-primary focus:outline-none focus:border-primary-container resize-y"
        />
      </div>
      <div>
        <label className="block font-mono text-primary-container mb-1 text-xs">地理环境</label>
        <AutoTextarea
          value={world.geography}
          onChange={(e) => setWorld({ ...world, geography: e.target.value })}
          rows={2}
          disabled={busy}
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
          disabled={busy}
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
          disabled={busy}
          className="w-full bg-surface-container border border-primary-container/40 rounded-lg px-3 py-2 text-sm text-primary focus:outline-none focus:border-primary-container resize-y"
        />
      </div>
    </div>
  );
}

function PowerSystemsPanel({
  active, projectId, world, setWorld, busy, onAdd, onUpdateField, onRemove, onRegenerateItem,
  activeSubTab, onSubTabChange,
}: {
  active: boolean;
  projectId: string;
  world: World;
  setWorld: (w: World) => void;
  busy: boolean;
  onAdd: () => void;
  onUpdateField: <K extends keyof PowerSystem>(index: number, key: K, value: PowerSystem[K]) => void;
  onRemove: (index: number) => void;
  onRegenerateItem: (index: number) => (mods: string) => Promise<void>;
  activeSubTab: string;
  onSubTabChange: (key: string) => void;
}) {
  // 临时: 把 props 接进来但暂不渲染 sub-tab,避免 TS 报错
  void projectId; void activeSubTab; void onSubTabChange;
  return (
    <div
      role="tabpanel"
      id="world-panel-power_system"
      aria-labelledby="world-tab-power_system"
      hidden={!active}
      data-testid="world-panel-power_system"
      className="space-y-3"
    >
      <div data-testid="world-power-systems" className="space-y-3">
        {world.power_systems.length === 0 && (
          <p className="font-body text-body-md text-primary-container/40 text-xs text-center py-3">暂无力量体系</p>
        )}
        {world.power_systems.map((ps, i) => (
          <div
            key={i}
            data-testid={`world-power-system-${i}`}
            className={
              "border rounded p-3 space-y-2 relative " +
              (ps.source === "protagonist_engine"
                ? "border-primary-container/60 bg-primary-container/5"
                : "border-outline-variant")
            }
          >
            <div className="absolute top-2 right-2 flex items-center gap-1">
              {ps.source === "protagonist_engine" && (
                <span
                  data-testid={`world-power-system-${i}-source-badge`}
                  className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-primary-container/20 text-primary-container"
                >
                  主角能力
                </span>
              )}
              <SectionRegenerateButton
                target={`力量体系: ${ps.name || `#${i + 1}`}`}
                onRegenerate={onRegenerateItem(i)}
                testId={`world-power-system-${i}-regenerate`}
              />
              <button
                type="button"
                data-testid={`world-power-system-${i}-remove`}
                onClick={() => onRemove(i)}
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
                onChange={(e) => onUpdateField(i, "name", e.target.value)}
                className="w-full bg-surface-container border border-outline-variant rounded px-2 py-1.5 text-xs text-primary focus:outline-none focus:border-primary-container"
              />
            </div>
            <div>
              <label className="block font-mono text-primary-container mb-1 text-[10px]">描述</label>
              <AutoTextarea
                data-testid={`world-power-system-${i}-description`}
                value={ps.description}
                onChange={(e) => onUpdateField(i, "description", e.target.value)}
                rows={2}
                className="w-full bg-surface-container border border-outline-variant rounded px-2 py-1.5 text-xs text-primary focus:outline-none focus:border-primary-container resize-y"
              />
            </div>
            <div>
              <label className="block font-mono text-primary-container mb-1 text-[10px]">阶段划分</label>
              <div data-testid={`world-power-system-${i}-stages`}>
                <TagEditor items={ps.stages ?? []} onItemsChange={(items) => onUpdateField(i, "stages", items)} saving={busy} />
              </div>
            </div>
            <div>
              <label className="block font-mono text-primary-container mb-1 text-[10px]">体系规则</label>
              <div data-testid={`world-power-system-${i}-rules`}>
                <TagEditor items={ps.core_rules ?? []} onItemsChange={(items) => onUpdateField(i, "core_rules", items)} saving={busy} />
              </div>
            </div>
            <div>
              <label className="block font-mono text-primary-container mb-1 text-[10px]">力量上限</label>
              <div data-testid={`world-power-system-${i}-ceilings`}>
                <TagEditor items={ps.ceilings ?? []} onItemsChange={(items) => onUpdateField(i, "ceilings", items)} saving={busy} />
              </div>
            </div>
            <div>
              <label className="block font-mono text-primary-container mb-1 text-[10px]">代价系统</label>
              <input
                data-testid={`world-power-system-${i}-cost`}
                value={ps.cost_system ?? ""}
                onChange={(e) => onUpdateField(i, "cost_system", e.target.value)}
                className="w-full bg-surface-container border border-outline-variant rounded px-2 py-1.5 text-xs text-primary focus:outline-none focus:border-primary-container"
              />
            </div>
          </div>
        ))}
      </div>
      <div className="flex justify-center pt-2">
        <button
          type="button"
          data-testid="world-power-system-add"
          onClick={onAdd}
          disabled={busy}
          className="flex items-center gap-1 px-3 py-1.5 text-xs border border-dashed border-system-log/30 rounded text-primary-container/60 hover:text-primary-container hover:border-primary-container/50 transition-colors disabled:opacity-30"
        >
          <span className="material-symbols-outlined text-xs">add</span>
          添加体系
        </button>
      </div>
    </div>
  );
}

// 2026-09-20 (修订 F): CategoryGroup 是 CoreRulesPanel 内的可折叠 group。
// 4 个 category group (physical / social / narrative / protagonist) 共享同一
// 渲染模式:`<details open>` 标题行 + TagEditor 内容。每个 group 独立维护
// `open` state,首次渲染默认展开。testid 在外层 `<details>` 上,用于单测定位。
function CategoryGroup({
  category, label, source, rules, onChange, saving,
}: {
  category: string;
  label: string;
  source: string;
  rules: string[];
  onChange: (texts: string[]) => void;
  saving: boolean;
}) {
  const [open, setOpen] = useState(true);
  return (
    <details
      open={open}
      data-testid={`world-core-rules-${category}`}
      className="border border-outline-variant rounded"
    >
      <summary
        onClick={(e) => { e.preventDefault(); setOpen(!open); }}
        className="cursor-pointer px-3 py-2 flex items-center justify-between hover:bg-surface-container/50"
      >
        <span className="flex items-center gap-2">
          <span className="material-symbols-outlined text-sm">
            {open ? "expand_less" : "expand_more"}
          </span>
          <span className="font-medium text-sm">{label}</span>
          <span className="font-mono text-[10px] text-primary-container/70">
            [{source}]
          </span>
        </span>
        <span className="font-mono text-[10px] opacity-70" aria-label={`${rules.length} 条`}>
          {rules.length}
        </span>
      </summary>
      <div className="px-3 pb-3">
        <TagEditor items={rules} onItemsChange={onChange} saving={saving} />
      </div>
    </details>
  );
}

// 2026-09-20 (修订 F): CoreRulesPanel 重构 — 把 list[CoreRule] 按 category 分
// 成 4 个折叠 group,每个 group 内部是 TagEditor。`setCategory` 通过 filter
// 保留非当前 category 的项,把当前 category 的新 texts 重新 attach 上,这样
// 切换 / 删除项不会影响其他 group 的内容。外层 `<div data-testid="world-
// core-rules">` 保留以向后兼容老单测 (回归保护)。
function CoreRulesPanel({
  active, projectId, world, setWorld, busy, activeSubTab, onSubTabChange,
}: {
  active: boolean;
  projectId: string;
  world: World;
  setWorld: (w: World) => void;
  busy: boolean;
  activeSubTab: string;
  onSubTabChange: (key: string) => void;
}) {
  // 临时: 把 props 接进来但暂不渲染 sub-tab,避免 TS 报错
  void projectId; void activeSubTab; void onSubTabChange;
  const grouped = useMemo(() => {
    const g: Record<string, string[]> = {
      physical: [], social: [], narrative: [], protagonist: [],
    };
    for (const r of (world.core_rules ?? []) as CoreRule[]) {
      const cat = r.category ?? "physical";
      if (!g[cat]) g[cat] = [];
      g[cat].push(r.text ?? "");
    }
    return g;
  }, [world.core_rules]);

  const setCategory = (cat: string, texts: string[]) => {
    const others = ((world.core_rules ?? []) as CoreRule[])
      .filter(r => r.category !== cat);
    setWorld({
      ...world,
      core_rules: [
        ...others,
        ...texts.map(t => ({ category: cat, text: t })),
      ],
    });
  };

  return (
    <div
      role="tabpanel"
      id="world-panel-core_rules"
      aria-labelledby="world-tab-core_rules"
      hidden={!active}
      data-testid="world-panel-core_rules"
    >
      <div data-testid="world-core-rules" className="space-y-2">
        <CategoryGroup category="physical" label="物理公理" source="ontology"
          rules={grouped.physical} onChange={t => setCategory("physical", t)} saving={busy} />
        <CategoryGroup category="social" label="结构性瓶颈" source="power_structure"
          rules={grouped.social} onChange={t => setCategory("social", t)} saving={busy} />
        <CategoryGroup category="narrative" label="解决路径封闭性" source="narrative_physics"
          rules={grouped.narrative} onChange={t => setCategory("narrative", t)} saving={busy} />
        <CategoryGroup category="protagonist" label="主角机制硬约束" source="protagonist_engine"
          rules={grouped.protagonist} onChange={t => setCategory("protagonist", t)} saving={busy} />
      </div>
    </div>
  );
}

function FactionsPanel({
  active, projectId, world, setWorld, busy, onAdd, onUpdateField, onRemove,
  activeSubTab, onSubTabChange,
}: {
  active: boolean;
  projectId: string;
  world: World;
  setWorld: (w: World) => void;
  busy: boolean;
  onAdd: () => void;
  onUpdateField: (index: number, field: FactionField, value: string) => void;
  onRemove: (index: number) => void;
  activeSubTab: string;
  onSubTabChange: (key: string) => void;
}) {
  // 临时: 把 props 接进来但暂不渲染 sub-tab,避免 TS 报错
  void projectId; void activeSubTab; void onSubTabChange;
  return (
    <div
      role="tabpanel"
      id="world-panel-factions"
      aria-labelledby="world-tab-factions"
      hidden={!active}
      data-testid="world-panel-factions"
      className="space-y-3"
    >
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
              onClick={() => onRemove(i)}
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
                  onChange={(e) => onUpdateField(i, "name", e.target.value)}
                  className="w-full bg-surface-container border border-outline-variant rounded px-2 py-1.5 text-xs text-primary focus:outline-none focus:border-primary-container"
                />
              </div>
              <div>
                <label className="block font-mono text-primary-container mb-1 text-[10px]">类型</label>
                <input
                  data-testid={`world-faction-${i}-type`}
                  value={f.type}
                  onChange={(e) => onUpdateField(i, "type", e.target.value)}
                  className="w-full bg-surface-container border border-outline-variant rounded px-2 py-1.5 text-xs text-primary focus:outline-none focus:border-primary-container"
                />
              </div>
            </div>
            <div>
              <label className="block font-mono text-primary-container mb-1 text-[10px]">目标</label>
              <AutoTextarea
                data-testid={`world-faction-${i}-goal`}
                value={f.goal}
                onChange={(e) => onUpdateField(i, "goal", e.target.value)}
                rows={2}
                className="w-full bg-surface-container border border-outline-variant rounded px-2 py-1.5 text-xs text-primary focus:outline-none focus:border-primary-container resize-y"
              />
            </div>
            <div>
              <label className="block font-mono text-primary-container mb-1 text-[10px]">关系</label>
              <input
                data-testid={`world-faction-${i}-relations`}
                value={f.relations}
                onChange={(e) => onUpdateField(i, "relations", e.target.value)}
                className="w-full bg-surface-container border border-outline-variant rounded px-2 py-1.5 text-xs text-primary focus:outline-none focus:border-primary-container"
              />
            </div>
          </div>
        ))}
      </div>
      <div className="flex justify-center pt-2">
        <button
          type="button"
          data-testid="world-faction-add"
          onClick={onAdd}
          disabled={busy}
          className="flex items-center gap-1 px-3 py-1.5 text-xs border border-dashed border-system-log/30 rounded text-primary-container/60 hover:text-primary-container hover:border-primary-container/50 transition-colors disabled:opacity-30"
        >
          <span className="material-symbols-outlined text-xs">add</span>
          添加势力
        </button>
      </div>
    </div>
  );
}

function SubTabStrip({
  tabs,
  active,
  onChange,
  onRegenerate,
  testidPrefix,
  disabled,
}: {
  tabs: { key: string; label: string; testidSuffix?: string }[];
  active: string;
  onChange: (key: string) => void;
  onRegenerate?: (key: string) => void;
  testidPrefix: string;
  disabled?: boolean;
}) {
  return (
    <div
      role="tablist"
      data-testid={`${testidPrefix}-strip`}
      className="sticky top-[40px] z-[5] -mx-1 px-1 bg-surface-container-low/95 backdrop-blur-sm flex gap-1 border-b border-outline-variant overflow-x-auto"
    >
      {tabs.map((t) => {
        const isActive = t.key === active;
        const tid = `${testidPrefix}-${t.testidSuffix ?? t.key}`;
        const isDisabled = !!disabled;
        return (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={isActive}
            aria-controls={`${testidPrefix}-panel-${t.key}`}
            data-testid={tid}
            onClick={() => onChange(t.key)}
            className={
              "shrink-0 px-2 py-1 text-sm font-display font-medium border-b-2 -mb-px inline-flex items-center gap-1 whitespace-nowrap transition-colors outline-none focus-visible:ring-2 ring-primary-container " +
              (isActive
                ? "border-primary text-primary"
                : "border-transparent text-on-surface-variant hover:text-primary")
            }
          >
            <span>{t.label}</span>
            {onRegenerate && (
              <span
                role="button"
                aria-label={`重新生成 ${t.label}`}
                aria-disabled={isDisabled}
                tabIndex={isDisabled ? -1 : 0}
                data-testid={`${tid}-regenerate`}
                onClick={(e) => {
                  e.stopPropagation();
                  if (!isDisabled) onRegenerate(t.key);
                }}
                onKeyDown={(e) => {
                  if ((e.key === "Enter" || e.key === " ") && !isDisabled) {
                    e.preventDefault();
                    e.stopPropagation();
                    onRegenerate(t.key);
                  }
                }}
                className={
                  "ml-1 inline-flex items-center justify-center w-4 h-4 rounded text-on-surface-variant hover:text-primary hover:bg-primary-container/15 " +
                  (isDisabled ? "opacity-30 cursor-not-allowed" : "cursor-pointer")
                }
              >
                <span aria-hidden="true" className="material-symbols-outlined text-[12px] leading-none">refresh</span>
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

// 内部测试钩子 — 仅 *.test.tsx 引用,生产代码不要 import 这个 namespace。
export const __testing__ = {
  SubTabStrip,
};