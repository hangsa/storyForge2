import { useEffect, useRef, useState } from "react";
import api, { PowerSystem, World } from "../../../api/client";
import { useAutoHeight } from "../../../hooks/useAutoHeight";
import { AutoTextarea } from "../../shared/AutoTextarea";

interface BaseEditorProps {
  projectId: string;
  data: unknown;
  onSaved: () => void;
  readOnly?: boolean;
}

const EMPTY_WORLD: World = {
  era: "",
  geography: "",
  era_social_structure: null,
  era_cultural_history: null,
  power_systems: [],
  factions: [],
  core_rules: [],
};

function readWorld(data: unknown): World {
  if (!data || typeof data !== "object") return EMPTY_WORLD;
  const raw = data as Partial<World> & { power_system?: PowerSystem };
  const power_systems = Array.isArray(raw.power_systems)
    ? raw.power_systems
    : raw.power_system && typeof raw.power_system === "object"
      ? [raw.power_system]
      : [];
  const next = { ...EMPTY_WORLD, ...raw, power_systems };
  delete (next as World & { power_system?: unknown }).power_system;
  return next;
}

function chipsToString(arr: string[] | undefined): string {
  return Array.isArray(arr) ? arr.join("、") : "";
}

function parseChips(s: string): string[] {
  return s.split(/[、,]/).map((x) => x.trim()).filter(Boolean);
}

/**
 * In-place editor for Stage2 World. v1.8 Bug 3 fix. Lists for stages /
 * core_rules / ceilings / world.core_rules are entered as comma- or
 * 、-separated chips (kept as strings under the hood — backend stores
 * string[]). Faction editing is a flat text list of {name|type|goal|relations}
 * per row, parsed/rejoined on save; the wizard's richer add/remove UI is
 * not required for workspace-level tweaks.
 *
 * v2.1.4: long-text fields (era, era_social_structure, era_cultural_history,
 * power_systems[i].stages / core_rules / ceilings / cost_system,
 * world.core_rules, factions[i].goal / relations) became auto-grow textareas
 * so multi-line content fits the box instead of being clipped by the
 * single-line <input> default. Short identifiers (name, type) stay as
 * <input>.
 */
export default function WorldEditor({ projectId, data, onSaved, readOnly }: BaseEditorProps) {
  const [world, setWorld] = useState<World>(() => readWorld(data));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const worldRef = useRef(world);
  worldRef.current = world;
  const geographyRef = useRef<HTMLTextAreaElement>(null);
  const eraRef = useRef<HTMLTextAreaElement>(null);
  const socialRef = useRef<HTMLTextAreaElement>(null);
  const culturalRef = useRef<HTMLTextAreaElement>(null);
  const coreRulesRef = useRef<HTMLTextAreaElement>(null);
  useAutoHeight(geographyRef, [world.geography]);
  useAutoHeight(eraRef, [world.era]);
  useAutoHeight(socialRef, [world.era_social_structure ?? ""]);
  useAutoHeight(culturalRef, [world.era_cultural_history ?? ""]);
  useAutoHeight(coreRulesRef, [chipsToString(world.core_rules)]);

  useEffect(() => {
    setWorld(readWorld(data));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const setPs = <K extends keyof PowerSystem>(index: number, k: K, v: PowerSystem[K]) => {
    const next = world.power_systems.map((ps, i) => (i === index ? { ...ps, [k]: v } : ps));
    setWorld({ ...world, power_systems: next });
  };

  const handleSave = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.updateWorld(projectId, worldRef.current);
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存失败");
    } finally {
      setBusy(false);
    }
  };

  const handleCancel = () => {
    setWorld(readWorld(data));
    setError(null);
  };

  return (
    <div data-testid="world-editor" className="space-y-3">
      <div className="font-label-mono text-system-log text-[10px] uppercase tracking-wider">世界观</div>

      <div>
        <label className="block font-label-mono text-system-log mb-1 text-xs">时代 (era)</label>
        <textarea
          ref={eraRef}
          data-testid="world-era"
          value={world.era}
          onChange={(e) => setWorld({ ...world, era: e.target.value })}
          className="w-full bg-surface-container border border-outline-variant rounded-lg px-3 py-2 text-sm text-primary focus:outline-none focus:border-primary-container overflow-hidden"
        />
      </div>
      <div>
        <label className="block font-label-mono text-system-log mb-1 text-xs">地理 (geography)</label>
        <textarea
          ref={geographyRef}
          data-testid="world-geography"
          value={world.geography}
          onChange={(e) => setWorld({ ...world, geography: e.target.value })}
          className="w-full bg-surface-container border border-outline-variant rounded-lg px-3 py-2 text-sm text-primary focus:outline-none focus:border-primary-container overflow-hidden"
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block font-label-mono text-system-log mb-1 text-xs">社会结构</label>
          <textarea
            ref={socialRef}
            data-testid="world-social"
            value={world.era_social_structure ?? ""}
            onChange={(e) => setWorld({ ...world, era_social_structure: e.target.value })}
            className="w-full bg-surface-container border border-outline-variant rounded-lg px-3 py-2 text-sm text-primary focus:outline-none focus:border-primary-container overflow-hidden"
          />
        </div>
        <div>
          <label className="block font-label-mono text-system-log mb-1 text-xs">历史文化</label>
          <textarea
            ref={culturalRef}
            data-testid="world-cultural"
            value={world.era_cultural_history ?? ""}
            onChange={(e) => setWorld({ ...world, era_cultural_history: e.target.value })}
            className="w-full bg-surface-container border border-outline-variant rounded-lg px-3 py-2 text-sm text-primary focus:outline-none focus:border-primary-container overflow-hidden"
          />
        </div>
      </div>

      <div className="border-t border-outline-variant pt-3 space-y-2">
        <div className="font-label-mono text-system-log text-[10px] uppercase tracking-wider">
          力量体系 ({world.power_systems.length} 个 — 详细增删请到 Stage2)
        </div>
        {world.power_systems.length === 0 && (
          <p className="font-body-ui text-system-log/60 text-xs">尚未配置力量体系。</p>
        )}
        {world.power_systems.map((ps, i) => (
          <PowerSystemCard
            key={i}
            idx={i}
            ps={ps}
            onChange={(k, v) => setPs(i, k, v)}
          />
        ))}
      </div>

      <div className="border-t border-outline-variant pt-3 space-y-2">
        <div className="font-label-mono text-system-log text-[10px] uppercase tracking-wider">世界规则 (core_rules, 、分隔)</div>
        <textarea
          ref={coreRulesRef}
          data-testid="world-core-rules"
          value={chipsToString(world.core_rules)}
          onChange={(e) => setWorld({ ...world, core_rules: parseChips(e.target.value) })}
          className="w-full bg-surface-container border border-outline-variant rounded-lg px-3 py-2 text-sm text-primary focus:outline-none focus:border-primary-container overflow-hidden"
        />
      </div>

      <div className="border-t border-outline-variant pt-3 space-y-2">
        <div className="font-label-mono text-system-log text-[10px] uppercase tracking-wider">
          势力 (factions, {world.factions.length} 个 — 详细增删请到 Stage2)
        </div>
        {world.factions.length === 0 && (
          <p className="font-body-ui text-system-log/60 text-xs">尚未配置势力。</p>
        )}
        {world.factions.map((f, idx) => (
          <FactionCard
            key={idx}
            idx={idx}
            faction={f}
            onChange={(patch) => {
              const next = world.factions.slice();
              next[idx] = { ...next[idx], ...patch };
              setWorld({ ...world, factions: next });
            }}
          />
        ))}
      </div>

      {error && (
        <div data-testid="world-editor-error" className="p-2 bg-error-container/20 border border-error rounded text-error font-body-ui text-xs">
          {error}
        </div>
      )}

      <footer className="flex items-center justify-end gap-2 pt-2">
        <button
          type="button"
          data-testid="world-editor-cancel"
          onClick={handleCancel}
          disabled={busy}
          className="px-3 py-1 text-xs bg-surface-container text-system-log rounded-lg hover:bg-surface-container-low disabled:opacity-40"
        >取消</button>
        <button
          type="button"
          data-testid="world-editor-save"
          onClick={handleSave}
          disabled={busy || readOnly}
          title={readOnly ? "托管运行中,元数据已锁定" : undefined}
          className="px-4 py-1 text-xs bg-tertiary-container text-surface-container-low rounded-lg hover:opacity-90 disabled:opacity-40"
        >{busy ? "保存中…" : "保存"}</button>
      </footer>
    </div>
  );
}

/** Sub-component for one power-system card. Split out so each instance
 *  can host its own `useAutoHeight` refs (Rules of Hooks forbid hooks
 *  inside `.map()`). Short identifier (name) stays as <input>; long-text
 *  fields (stages / core_rules / ceilings / cost_system) are textareas. */
function PowerSystemCard({
  idx, ps, onChange,
}: {
  idx: number;
  ps: PowerSystem;
  onChange: <K extends keyof PowerSystem>(k: K, v: PowerSystem[K]) => void;
}) {
  const stagesRef = useRef<HTMLTextAreaElement>(null);
  const rulesRef = useRef<HTMLTextAreaElement>(null);
  const ceilingsRef = useRef<HTMLTextAreaElement>(null);
  const costRef = useRef<HTMLTextAreaElement>(null);
  useAutoHeight(stagesRef, [chipsToString(ps.stages)]);
  useAutoHeight(rulesRef, [chipsToString(ps.core_rules)]);
  useAutoHeight(ceilingsRef, [chipsToString(ps.ceilings)]);
  useAutoHeight(costRef, [ps.cost_system ?? ""]);
  return (
    <div
      data-testid={`world-power-${idx}`}
      className="border border-outline-variant rounded-lg p-2 space-y-2"
    >
      <div>
        <label className="block font-label-mono text-system-log mb-1 text-xs">名称</label>
        <input
          data-testid={`world-power-${idx}-name`}
          value={ps.name}
          onChange={(e) => onChange("name", e.target.value)}
          className="w-full bg-surface-container border border-outline-variant rounded-lg px-3 py-2 text-sm text-primary focus:outline-none focus:border-primary-container"
        />
      </div>
      <div>
        <label className="block font-label-mono text-system-log mb-1 text-xs">描述</label>
        <AutoTextarea
          data-testid={`world-power-${idx}-description`}
          value={ps.description}
          onChange={(e) => onChange("description", e.target.value)}
          className="w-full bg-surface-container border border-outline-variant rounded-lg px-3 py-2 text-sm text-primary focus:outline-none focus:border-primary-container overflow-hidden"
        />
      </div>
      <div>
        <label className="block font-label-mono text-system-log mb-1 text-xs">阶段 (stages, 、分隔)</label>
        <textarea
          ref={stagesRef}
          data-testid={`world-power-${idx}-stages`}
          value={chipsToString(ps.stages)}
          onChange={(e) => onChange("stages", parseChips(e.target.value))}
          className="w-full bg-surface-container border border-outline-variant rounded-lg px-3 py-2 text-sm text-primary focus:outline-none focus:border-primary-container overflow-hidden"
        />
      </div>
      <div>
        <label className="block font-label-mono text-system-log mb-1 text-xs">核心规则 (core_rules, 、分隔)</label>
        <textarea
          ref={rulesRef}
          data-testid={`world-power-${idx}-rules`}
          value={chipsToString(ps.core_rules)}
          onChange={(e) => onChange("core_rules", parseChips(e.target.value))}
          className="w-full bg-surface-container border border-outline-variant rounded-lg px-3 py-2 text-sm text-primary focus:outline-none focus:border-primary-container overflow-hidden"
        />
      </div>
      <div>
        <label className="block font-label-mono text-system-log mb-1 text-xs">天花板 (ceilings, 、分隔)</label>
        <textarea
          ref={ceilingsRef}
          data-testid={`world-power-${idx}-ceilings`}
          value={chipsToString(ps.ceilings)}
          onChange={(e) => onChange("ceilings", parseChips(e.target.value))}
          className="w-full bg-surface-container border border-outline-variant rounded-lg px-3 py-2 text-sm text-primary focus:outline-none focus:border-primary-container overflow-hidden"
        />
      </div>
      <div>
        <label className="block font-label-mono text-system-log mb-1 text-xs">代价体系</label>
        <textarea
          ref={costRef}
          data-testid={`world-power-${idx}-cost`}
          value={ps.cost_system ?? ""}
          onChange={(e) => onChange("cost_system", e.target.value)}
          className="w-full bg-surface-container border border-outline-variant rounded-lg px-3 py-2 text-sm text-primary focus:outline-none focus:border-primary-container overflow-hidden"
        />
      </div>
    </div>
  );
}

/** Sub-component for one faction card. Same hook-per-card pattern as
 *  PowerSystemCard. Identity (name) and category (type) stay as <input>;
 *  long-text fields (goal / relations) are textareas. */
function FactionCard({
  idx, faction, onChange,
}: {
  idx: number;
  faction: { name: string; type: string; goal: string; relations: string };
  onChange: (patch: Partial<{ name: string; type: string; goal: string; relations: string }>) => void;
}) {
  const goalRef = useRef<HTMLTextAreaElement>(null);
  const relationsRef = useRef<HTMLTextAreaElement>(null);
  useAutoHeight(goalRef, [faction.goal]);
  useAutoHeight(relationsRef, [faction.relations]);
  return (
    <div className="border border-outline-variant rounded-lg p-2 space-y-1">
      <div className="grid grid-cols-2 gap-2">
        <input
          data-testid={`world-faction-${idx}-name`}
          value={faction.name}
          onChange={(e) => onChange({ name: e.target.value })}
          placeholder="名称"
          className="bg-surface-container border border-outline-variant rounded px-2 py-1 text-xs text-primary focus:outline-none focus:border-primary-container"
        />
        <input
          data-testid={`world-faction-${idx}-type`}
          value={faction.type}
          onChange={(e) => onChange({ type: e.target.value })}
          placeholder="类型"
          className="bg-surface-container border border-outline-variant rounded px-2 py-1 text-xs text-primary focus:outline-none focus:border-primary-container"
        />
      </div>
      <textarea
        ref={goalRef}
        data-testid={`world-faction-${idx}-goal`}
        value={faction.goal}
        onChange={(e) => onChange({ goal: e.target.value })}
        placeholder="目标"
        className="w-full bg-surface-container border border-outline-variant rounded px-2 py-1 text-xs text-primary focus:outline-none focus:border-primary-container overflow-hidden"
      />
      <textarea
        ref={relationsRef}
        data-testid={`world-faction-${idx}-relations`}
        value={faction.relations}
        onChange={(e) => onChange({ relations: e.target.value })}
        placeholder="关系概述"
        className="w-full bg-surface-container border border-outline-variant rounded px-2 py-1 text-xs text-primary focus:outline-none focus:border-primary-container overflow-hidden"
      />
    </div>
  );
}
