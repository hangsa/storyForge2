import { useState } from "react";
import type { DimensionDecomposition, Unit } from "./types";

interface Props {
  dimensions: DimensionDecomposition[];
  topLevelSummary: string;
  // Footer navigation (上一步 / 下一步 / 重新生成) is registered through the
  // page-level wizard footer by CreativeDivergenceStep. The Stage-2 header
  // and the causal_map <pre> block were removed on 2026-09-08 (see git
  // history); the per-unit "追问" affordance was removed on the same day
  // (decision 2026-09-08: "暂时忽略"). The follow-up props were dropped
  // along with it.
}

const DIMENSION_LABELS: Record<string, { label: string; icon: string }> = {
  ontology: { label: "世界构成 (Ontology)", icon: "public" },
  energetics: { label: "能量体系 (Energetics)", icon: "bolt" },
  power_structure: { label: "社会控制 (Power Structure)", icon: "gavel" },
  protagonist_engine: { label: "主角机制 (Protagonist Engine)", icon: "person" },
  narrative_physics: { label: "叙事动力 (Narrative Physics)", icon: "auto_stories" },
};

const DIMENSION_ORDER = ["ontology", "energetics", "power_structure", "protagonist_engine", "narrative_physics"] as const;

export default function S2DecomposeStep({
  dimensions, topLevelSummary,
}: Props) {
  // Defense-in-depth: callers upstream (reducer / HYDRATE) already coerce
  // undefined to [], but a stray malformed payload must not crash the
  // render with `dimensions.length`.
  const safeDimensions = Array.isArray(dimensions) ? dimensions : [];

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="space-y-3 flex-1 min-h-0 overflow-y-auto px-6 pt-2">
        {DIMENSION_ORDER.map((key) => {
          const dim = safeDimensions.find((d) => d.dimension === key);
          if (!dim) return null;
          return (
            <DimensionBlock key={dim.dimension} dimension={dim} />
          );
        })}

        {safeDimensions
          .filter((d) => !DIMENSION_ORDER.includes(d.dimension as typeof DIMENSION_ORDER[number]))
          .map((dim) => (
            <DimensionBlock key={dim.dimension} dimension={dim} />
          ))}

        {topLevelSummary && (
          <div className="border-t border-outline-variant pt-3" data-testid="top-level-summary">
            <h3 className="font-display text-sm font-semibold text-primary-container mb-1">
              总览
            </h3>
            <p className="text-sm text-primary">{topLevelSummary}</p>
          </div>
        )}
      </div>
    </div>
  );
}

function DimensionBlock({
  dimension,
}: {
  dimension: DimensionDecomposition;
}) {
  const [collapsed, setCollapsed] = useState(false);

  const meta = DIMENSION_LABELS[dimension.dimension] ?? { label: dimension.dimension, icon: "auto_awesome" };

  return (
    <section className="bg-surface-container-low border border-outline-variant rounded-lg p-3" data-testid={`dimension-${dimension.dimension}`}>
      <button
        type="button"
        onClick={() => setCollapsed(!collapsed)}
        className="flex items-center gap-2 w-full text-left"
      >
        <span aria-hidden="true" className="material-symbols-outlined text-base leading-none text-on-surface-variant">
          {collapsed ? "chevron_right" : "expand_more"}
        </span>
        <span aria-hidden="true" className="material-symbols-outlined text-primary-container text-base leading-none">
          {meta.icon}
        </span>
        <h3 className="font-display text-sm font-semibold text-primary">
          {meta.label}
        </h3>
        <span className="ml-auto font-mono text-[10px] uppercase tracking-wider text-on-surface-variant">
          {dimension.units.length} 单元
        </span>
      </button>
      {dimension.insight && (
        <p className="text-xs text-on-surface-variant mt-1 ml-10">
          核心洞察:{dimension.insight}
        </p>
      )}
      {!collapsed && (
        <div className="space-y-2 mt-3">
          {dimension.units.map((u) => (
            <UnitCard key={u.id} unit={u} />
          ))}
        </div>
      )}
    </section>
  );
}

function UnitCard({
  unit,
}: {
  unit: Unit;
}) {
  return (
    <div
      className="bg-surface-container border border-outline-variant rounded-lg p-3 text-sm"
      data-testid={`unit-${unit.id}`}
    >
      <div className="flex items-center gap-2">
        <span className="font-mono text-[10px] uppercase tracking-wider text-on-surface-variant">
          Unit #{unit.id}
        </span>
        <span className="font-display text-sm font-semibold text-primary">{unit.unit_name}</span>
      </div>
      <div className="text-primary mt-1">{unit.description}</div>
    </div>
  );
}
