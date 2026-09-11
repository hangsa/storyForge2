import { useState } from "react";
import { SecondaryButton } from "@/components/ds";
import { RegenerateModal } from "@/components/shared/RegenerateModal";
import type { DimensionDecomposition, Unit } from "./types";

interface Props {
  dimensions: DimensionDecomposition[];
  topLevelSummary: string;
  followUpLoadingUnitId: string | null;
  onFollowUp: (unitId: string, userQuestion: string | null) => void;
  // Footer navigation (上一步 / 下一步 / 重新生成) is registered through the
  // page-level wizard footer by CreativeDivergenceStep. The Stage-2 header
  // and the causal_map <pre> block were removed on 2026-09-08 (see git
  // history).
  //
  // The 「总览」 h3 title row above the top-level summary was removed on
  // 2026-09-11 — the heading felt redundant with the body text below it.
  // The summary paragraph itself is still surfaced (without the heading).
}

const DIMENSION_LABELS: Record<string, { label: string; icon: string }> = {
  ontology: { label: "世界构成 (Ontology)", icon: "public" },
  energetics: { label: "能量体系 (Energetics)", icon: "bolt" },
  power_structure: { label: "社会控制 (Power Structure)", icon: "gavel" },
  protagonist_engine: { label: "主角机制 (Protagonist Engine)", icon: "person" },
  narrative_physics: { label: "叙事动力 (Narrative Physics)", icon: "auto_stories" },
};

const DIMENSION_ORDER = ["ontology", "energetics", "power_structure", "protagonist_engine", "narrative_physics"] as const;

// Round 5 of the v2 wizard 6-item optimization: narrative_physics 维度的
// `insight` 字段本身就是"核心矛盾",把它以虚拟 unit 的形式展示在该维度
// 顶部,unit_name="核心矛盾",is_irreducible=true (无追问按钮)。
const CORE_CONTRADICTION_ID = "__core_contradiction__";

function withCoreContradictionUnit(dim: DimensionDecomposition): DimensionDecomposition {
  if (dim.dimension !== "narrative_physics" || !dim.insight?.trim()) {
    return dim;
  }
  const virtual: Unit = {
    id: CORE_CONTRADICTION_ID,
    dimension: "narrative_physics",
    unit_name: "核心矛盾",
    description: dim.insight,
    follow_up_count: 0,
    is_irreducible: true,
  };
  return { ...dim, units: [virtual, ...dim.units] };
}

export default function S2DecomposeStep({
  dimensions, topLevelSummary, followUpLoadingUnitId, onFollowUp,
}: Props) {
  // Defense-in-depth: callers upstream (reducer / HYDRATE) already coerce
  // undefined to [], but a stray malformed payload must not crash the
  // render with `dimensions.length`.
  const safeDimensions = Array.isArray(dimensions) ? dimensions : [];

  // Round 3: 追问弹窗提到顶层,共享一个 RegenerateModal,避免每个 unit
  // 都维护自己的 inline dialog 状态(text 泄漏 / 弹窗叠加 / 焦点跳跃)。
  const [followUpTarget, setFollowUpTarget] = useState<{ unitId: string; unitName: string } | null>(null);

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="space-y-3 flex-1 min-h-0 overflow-y-auto px-6">
        {topLevelSummary && (
          // The 「总览」 h3 title row above this paragraph was removed on
          // 2026-09-11 — it felt redundant. Keep the summary content here
          // so users still see the LLM's overall conclusion before
          // expanding the 5 dimensions below.
          <div
            className="bg-primary-container/5 rounded-lg p-4"
            data-testid="top-level-summary"
          >
            <p className="text-sm text-primary">{topLevelSummary}</p>
          </div>
        )}

        {DIMENSION_ORDER.map((key) => {
          const dim = safeDimensions.find((d) => d.dimension === key);
          if (!dim) return null;
          return (
            <DimensionBlock
              key={dim.dimension}
              dimension={withCoreContradictionUnit(dim)}
              followUpLoadingUnitId={followUpLoadingUnitId}
              onFollowUpClick={(unitId, unitName) => setFollowUpTarget({ unitId, unitName })}
            />
          );
        })}

        {safeDimensions
          .filter((d) => !DIMENSION_ORDER.includes(d.dimension as typeof DIMENSION_ORDER[number]))
          .map((dim) => (
            <DimensionBlock
              key={dim.dimension}
              dimension={withCoreContradictionUnit(dim)}
              followUpLoadingUnitId={followUpLoadingUnitId}
              onFollowUpClick={(unitId, unitName) => setFollowUpTarget({ unitId, unitName })}
            />
          ))}
      </div>

      <RegenerateModal
        open={followUpTarget !== null}
        target={followUpTarget ? `追问 - ${followUpTarget.unitName}` : ""}
        busy={followUpLoadingUnitId !== null}
        onConfirm={(text) => {
          if (!followUpTarget) return;
          onFollowUp(followUpTarget.unitId, text.trim() || null);
          setFollowUpTarget(null);
        }}
        onCancel={() => setFollowUpTarget(null)}
      />
    </div>
  );
}

function DimensionBlock({
  dimension, followUpLoadingUnitId, onFollowUpClick,
}: {
  dimension: DimensionDecomposition;
  followUpLoadingUnitId: string | null;
  onFollowUpClick: (unitId: string, unitName: string) => void;
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
            <UnitCard
              key={u.id}
              unit={u}
              loading={followUpLoadingUnitId === u.id}
              onFollowUpClick={() => onFollowUpClick(u.id, u.unit_name)}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function UnitCard({
  unit, loading, onFollowUpClick,
}: {
  unit: Unit;
  loading: boolean;
  onFollowUpClick: () => void;
}) {
  const isVirtualCore = unit.id === CORE_CONTRADICTION_ID;
  const followUpLabel = isVirtualCore
    ? "核心矛盾"
    : unit.is_irreducible
      ? "已不可再分"
      : unit.follow_up_count > 0
        ? `已追问 ${unit.follow_up_count} 次`
        : "追问";
  return (
    <div
      className={
        "bg-surface-container border border-outline-variant rounded-lg p-3 text-sm " +
        (loading ? "opacity-50" : "")
      }
      data-testid={`unit-${unit.id}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-[10px] uppercase tracking-wider text-on-surface-variant">
              Unit #{unit.id}
            </span>
            <span className="font-display text-sm font-semibold text-primary">{unit.unit_name}</span>
            {isVirtualCore && (
              <span
                className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-primary-container/20 text-primary-container"
                data-testid={`core-contradiction-badge-${unit.id}`}
              >
                📌 核心矛盾
              </span>
            )}
          </div>
          <div className="text-primary mt-1">{unit.description}</div>
        </div>
        {!isVirtualCore && (
          <SecondaryButton
            label={followUpLabel}
            icon="forum"
            size="sm"
            testId={`follow-up-${unit.id}`}
            disabled={unit.is_irreducible}
            onClick={onFollowUpClick}
          />
        )}
      </div>
    </div>
  );
}
