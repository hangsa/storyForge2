import { useState } from "react";
import { PrimaryButton, SecondaryButton } from "@/components/ds";
import type { DimensionDecomposition, Unit } from "./types";

interface Props {
  dimensions: DimensionDecomposition[];
  topLevelSummary: string;
  loading: boolean;
  followUpLoadingUnitId: string | null;
  onFollowUp: (unitId: string, userQuestion: string | null) => void;
  // Footer navigation (上一步 / 下一步) moved to the page-level wizard
  // footer in WorkspaceWizardPanel. See CreativeDivergenceStep, which
  // registers the handlers via setNextHandler / setPrevHandler based on
  // the current sub-stage.
  //
  // The Stage-2 header (title + dimension/unit counts) and the causal_map
  // <pre> block were removed on 2026-09-08 — the title is redundant with
  // the StepIndicator above, and the causal map was just the dimension
  // order string ("ontology → energetics → ...") echoing what's already
  // obvious from the section headers below. causalMap is still persisted
  // in divergence state for future use; we just don't render it here.
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
  dimensions, topLevelSummary, loading, followUpLoadingUnitId,
  onFollowUp,
}: Props) {
  // Defense-in-depth: callers upstream (reducer / HYDRATE) already coerce
  // undefined to [], but a stray malformed payload must not crash the
  // render with `dimensions.length`.
  const safeDimensions = Array.isArray(dimensions) ? dimensions : [];

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="space-y-3 flex-1 min-h-0 overflow-y-auto px-margin-desktop pt-2">
        {DIMENSION_ORDER.map((key) => {
          const dim = safeDimensions.find((d) => d.dimension === key);
          if (!dim) return null;
          return (
            <DimensionBlock
              key={dim.dimension}
              dimension={dim}
              followUpLoadingUnitId={followUpLoadingUnitId}
              onFollowUp={onFollowUp}
            />
          );
        })}

        {safeDimensions
          .filter((d) => !DIMENSION_ORDER.includes(d.dimension as typeof DIMENSION_ORDER[number]))
          .map((dim) => (
            <DimensionBlock
              key={dim.dimension}
              dimension={dim}
              followUpLoadingUnitId={followUpLoadingUnitId}
              onFollowUp={onFollowUp}
            />
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
  dimension, followUpLoadingUnitId, onFollowUp,
}: {
  dimension: DimensionDecomposition;
  followUpLoadingUnitId: string | null;
  onFollowUp: (unitId: string, userQuestion: string | null) => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [followUpUnitId, setFollowUpUnitId] = useState<string | null>(null);

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
              followUpUnitId={followUpUnitId}
              setFollowUpUnitId={setFollowUpUnitId}
              onSubmit={(text) => {
                onFollowUp(u.id, text.trim() || null);
                setFollowUpUnitId(null);
              }}
              onCancel={() => {
                setFollowUpUnitId(null);
              }}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function UnitCard({
  unit, loading, followUpUnitId,
  setFollowUpUnitId, onSubmit, onCancel,
}: {
  unit: Unit;
  loading: boolean;
  followUpUnitId: string | null;
  setFollowUpUnitId: (id: string | null) => void;
  onSubmit: (text: string) => void;
  onCancel: () => void;
}) {
  const [followUpText, setFollowUpText] = useState("");
  const showDialog = followUpUnitId === unit.id;
  const followUpLabel = unit.is_irreducible
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
          <div className="flex items-center gap-2">
            <span className="font-mono text-[10px] uppercase tracking-wider text-on-surface-variant">
              Unit #{unit.id}
            </span>
            <span className="font-display text-sm font-semibold text-primary">{unit.unit_name}</span>
          </div>
          <div className="text-primary mt-1">{unit.description}</div>
        </div>
        <SecondaryButton
          label={followUpLabel}
          icon="forum"
          size="sm"
          testId={`follow-up-${unit.id}`}
          disabled={unit.is_irreducible}
          onClick={() => setFollowUpUnitId(unit.id)}
        />
      </div>

      {showDialog && (
        <div className="mt-3 p-3 border border-primary-container/30 rounded-lg bg-primary-container/5 space-y-2">
          <textarea
            placeholder="(留空使用默认追问)"
            className="w-full bg-surface-container border border-outline-variant rounded px-2 py-1 text-sm"
            value={followUpText}
            onChange={(e) => setFollowUpText(e.target.value)}
            rows={2}
            data-testid={`follow-up-input-${unit.id}`}
          />
          <div className="flex justify-end gap-2">
            <SecondaryButton label="取消" size="sm" onClick={onCancel} />
            <PrimaryButton
              label="确认追问"
              size="sm"
              onClick={() => onSubmit(followUpText)}
            />
          </div>
        </div>
      )}
    </div>
  );
}
