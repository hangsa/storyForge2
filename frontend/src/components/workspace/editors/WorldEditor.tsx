import { useEffect, useRef, useState } from "react";
import api, { World } from "../../../api/client";

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
  power_system: { name: "", description: "", stages: [], core_rules: [], ceilings: [], cost_system: "" },
  factions: [],
  core_rules: [],
};

function readWorld(data: unknown): World {
  if (!data || typeof data !== "object") return EMPTY_WORLD;
  return { ...EMPTY_WORLD, ...(data as Partial<World>) };
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
 */
export default function WorldEditor({ projectId, data, onSaved, readOnly }: BaseEditorProps) {
  const [world, setWorld] = useState<World>(() => readWorld(data));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const worldRef = useRef(world);
  worldRef.current = world;

  useEffect(() => {
    setWorld(readWorld(data));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const setPs = <K extends keyof World["power_system"]>(k: K, v: World["power_system"][K]) => {
    setWorld({ ...world, power_system: { ...world.power_system, [k]: v } });
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

  const ps = world.power_system;

  return (
    <div data-testid="world-editor" className="space-y-3">
      <div className="font-label-mono text-system-log text-[10px] uppercase tracking-wider">世界观</div>

      <div>
        <label className="block font-label-mono text-system-log mb-1 text-xs">时代 (era)</label>
        <input
          data-testid="world-era"
          value={world.era}
          onChange={(e) => setWorld({ ...world, era: e.target.value })}
          className="w-full bg-surface-container border border-outline-variant rounded-lg px-3 py-2 text-sm text-primary focus:outline-none focus:border-primary-container"
        />
      </div>
      <div>
        <label className="block font-label-mono text-system-log mb-1 text-xs">地理 (geography)</label>
        <textarea
          data-testid="world-geography"
          value={world.geography}
          onChange={(e) => setWorld({ ...world, geography: e.target.value })}
          rows={2}
          className="w-full bg-surface-container border border-outline-variant rounded-lg px-3 py-2 text-sm text-primary focus:outline-none focus:border-primary-container resize-y"
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block font-label-mono text-system-log mb-1 text-xs">社会结构</label>
          <input
            data-testid="world-social"
            value={world.era_social_structure ?? ""}
            onChange={(e) => setWorld({ ...world, era_social_structure: e.target.value })}
            className="w-full bg-surface-container border border-outline-variant rounded-lg px-3 py-2 text-sm text-primary focus:outline-none focus:border-primary-container"
          />
        </div>
        <div>
          <label className="block font-label-mono text-system-log mb-1 text-xs">历史文化</label>
          <input
            data-testid="world-cultural"
            value={world.era_cultural_history ?? ""}
            onChange={(e) => setWorld({ ...world, era_cultural_history: e.target.value })}
            className="w-full bg-surface-container border border-outline-variant rounded-lg px-3 py-2 text-sm text-primary focus:outline-none focus:border-primary-container"
          />
        </div>
      </div>

      <div className="border-t border-outline-variant pt-3 space-y-2">
        <div className="font-label-mono text-system-log text-[10px] uppercase tracking-wider">力量体系</div>
        <div>
          <label className="block font-label-mono text-system-log mb-1 text-xs">名称</label>
          <input
            data-testid="world-power-name"
            value={ps.name}
            onChange={(e) => setPs("name", e.target.value)}
            className="w-full bg-surface-container border border-outline-variant rounded-lg px-3 py-2 text-sm text-primary focus:outline-none focus:border-primary-container"
          />
        </div>
        <div>
          <label className="block font-label-mono text-system-log mb-1 text-xs">描述</label>
          <textarea
            data-testid="world-power-description"
            value={ps.description}
            onChange={(e) => setPs("description", e.target.value)}
            rows={2}
            className="w-full bg-surface-container border border-outline-variant rounded-lg px-3 py-2 text-sm text-primary focus:outline-none focus:border-primary-container resize-y"
          />
        </div>
        <div>
          <label className="block font-label-mono text-system-log mb-1 text-xs">阶段 (stages, 、分隔)</label>
          <input
            data-testid="world-power-stages"
            value={chipsToString(ps.stages)}
            onChange={(e) => setPs("stages", parseChips(e.target.value))}
            className="w-full bg-surface-container border border-outline-variant rounded-lg px-3 py-2 text-sm text-primary focus:outline-none focus:border-primary-container"
          />
        </div>
        <div>
          <label className="block font-label-mono text-system-log mb-1 text-xs">核心规则 (core_rules, 、分隔)</label>
          <input
            data-testid="world-power-rules"
            value={chipsToString(ps.core_rules)}
            onChange={(e) => setPs("core_rules", parseChips(e.target.value))}
            className="w-full bg-surface-container border border-outline-variant rounded-lg px-3 py-2 text-sm text-primary focus:outline-none focus:border-primary-container"
          />
        </div>
        <div>
          <label className="block font-label-mono text-system-log mb-1 text-xs">天花板 (ceilings, 、分隔)</label>
          <input
            data-testid="world-power-ceilings"
            value={chipsToString(ps.ceilings)}
            onChange={(e) => setPs("ceilings", parseChips(e.target.value))}
            className="w-full bg-surface-container border border-outline-variant rounded-lg px-3 py-2 text-sm text-primary focus:outline-none focus:border-primary-container"
          />
        </div>
        <div>
          <label className="block font-label-mono text-system-log mb-1 text-xs">代价体系</label>
          <input
            data-testid="world-power-cost"
            value={ps.cost_system ?? ""}
            onChange={(e) => setPs("cost_system", e.target.value)}
            className="w-full bg-surface-container border border-outline-variant rounded-lg px-3 py-2 text-sm text-primary focus:outline-none focus:border-primary-container"
          />
        </div>
      </div>

      <div className="border-t border-outline-variant pt-3 space-y-2">
        <div className="font-label-mono text-system-log text-[10px] uppercase tracking-wider">世界规则 (core_rules, 、分隔)</div>
        <input
          data-testid="world-core-rules"
          value={chipsToString(world.core_rules)}
          onChange={(e) => setWorld({ ...world, core_rules: parseChips(e.target.value) })}
          className="w-full bg-surface-container border border-outline-variant rounded-lg px-3 py-2 text-sm text-primary focus:outline-none focus:border-primary-container"
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
          <div key={idx} className="border border-outline-variant rounded-lg p-2 space-y-1">
            <div className="grid grid-cols-2 gap-2">
              <input
                value={f.name}
                onChange={(e) => {
                  const next = world.factions.slice();
                  next[idx] = { ...next[idx], name: e.target.value };
                  setWorld({ ...world, factions: next });
                }}
                placeholder="名称"
                className="bg-surface-container border border-outline-variant rounded px-2 py-1 text-xs text-primary focus:outline-none focus:border-primary-container"
              />
              <input
                value={f.type}
                onChange={(e) => {
                  const next = world.factions.slice();
                  next[idx] = { ...next[idx], type: e.target.value };
                  setWorld({ ...world, factions: next });
                }}
                placeholder="类型"
                className="bg-surface-container border border-outline-variant rounded px-2 py-1 text-xs text-primary focus:outline-none focus:border-primary-container"
              />
            </div>
            <input
              value={f.goal}
              onChange={(e) => {
                const next = world.factions.slice();
                next[idx] = { ...next[idx], goal: e.target.value };
                setWorld({ ...world, factions: next });
              }}
              placeholder="目标"
              className="w-full bg-surface-container border border-outline-variant rounded px-2 py-1 text-xs text-primary focus:outline-none focus:border-primary-container"
            />
            <input
              value={f.relations}
              onChange={(e) => {
                const next = world.factions.slice();
                next[idx] = { ...next[idx], relations: e.target.value };
                setWorld({ ...world, factions: next });
              }}
              placeholder="关系概述"
              className="w-full bg-surface-container border border-outline-variant rounded px-2 py-1 text-xs text-primary focus:outline-none focus:border-primary-container"
            />
          </div>
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
