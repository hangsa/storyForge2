import { useEffect, useRef, useState } from "react";
import { SecondaryButton } from "@/components/ds";
import type { DimensionDecomposition, Operator, UnitCandidate } from "./types";

interface Props {
  dimensions: DimensionDecomposition[];
  loading: boolean;
  onRegenerateUnit: (unitId: string) => void;
  onSelectCandidate: (unitId: string, candidateIndex: number) => void;
  // Task 8: legacy-state auto-/diverge. When S3 mounts and any unit's
  // candidates lack the virtual `__original` row (state.json produced
  // before Tasks 2/3 wired `_append_original_candidate` into the backend),
  // the parent runs `/diverge` once via this callback so the regenerated
  // candidate set includes the virtual "原始拆解" row. The ref guard in
  // the effect prevents duplicate calls across StrictMode double-mount
  // and re-renders, and `loading` is checked so we don't pile onto an
  // in-flight regenerate.
  onRegenerateAll?: () => void;
  // The bulk 「全部重新生成」 button was moved to the page-level wizard
  // footer on 2026-09-08 — it now lives as a sibling of the
  // 「下一步:提交 →」 button, registered by CreativeDivergenceStep via
  // setRegenerateHandler. Per-unit 「重新生成该单元」 stays inline since
  // it targets a single unit, not the full diverge pass.
}

const OPERATOR_LABELS: Record<Operator, string> = {
  distort: "扭曲",
  break: "打破",
  blend: "融合",
  chain: "组合链",
};

const OPERATOR_ICONS: Record<Operator, string> = {
  distort: "transform",
  break: "construction",
  blend: "merge_type",
  chain: "link",
};

const DIMENSION_LABELS: Record<string, { label: string; icon: string }> = {
  ontology: { label: "世界构成", icon: "public" },
  energetics: { label: "能量体系", icon: "bolt" },
  power_structure: { label: "社会控制", icon: "gavel" },
  protagonist_engine: { label: "主角机制", icon: "person" },
  narrative_physics: { label: "叙事动力", icon: "auto_stories" },
};

const DIMENSION_ORDER = ["ontology", "energetics", "power_structure", "protagonist_engine", "narrative_physics"] as const;

export function partitionOriginalCandidate(
  candidates: UnitCandidate[],
): { original: UnitCandidate | null; others: UnitCandidate[] } {
  const idx = candidates.findIndex((c) => c.id.endsWith("__original"));
  if (idx === -1) {
    return { original: null, others: candidates };
  }
  const original = candidates[idx];
  const others = [...candidates.slice(0, idx), ...candidates.slice(idx + 1)];
  return { original, others };
}

export default function S3DivergeStep({
  dimensions, loading, onRegenerateUnit, onSelectCandidate, onRegenerateAll,
}: Props) {
  // Defense-in-depth: callers upstream (reducer / HYDRATE) already coerce
  // undefined to [], but a stray malformed payload must not crash the
  // render with `dimensions.length`.
  const safeDimensions = Array.isArray(dimensions) ? dimensions : [];

  const allFailed = safeDimensions.length > 0 && safeDimensions.every((d) =>
    d.units.length > 0 && d.units.every((u) => !d.candidates.some((c) => c.unit_id === u.id))
  );

  // Task 8: legacy-state detection. If any unit has candidates but none of
  // them ends with `__original`, the state.json predates the backend
  // `_append_original_candidate` wiring (Tasks 2/3) and lacks the virtual
  // 原始拆解 row. Fire the parent's /diverge flow exactly once so the
  // backend regenerates the candidate set with the virtual row included.
  // The ref guard absorbs StrictMode double-mount and re-renders so we
  // never POST /diverge twice for the same legacy state.
  const needsLegacyRegenerate = safeDimensions.some((d) =>
    d.units.some((u) => {
      const unitCandidates = d.candidates.filter((c) => c.unit_id === u.id);
      return (
        unitCandidates.length > 0 &&
        !unitCandidates.some((c) => c.id.endsWith("__original"))
      );
    }),
  );
  const legacyTriggeredRef = useRef(false);
  useEffect(() => {
    if (legacyTriggeredRef.current) return;
    if (!needsLegacyRegenerate) return;
    if (loading) return;
    if (!onRegenerateAll) return;
    legacyTriggeredRef.current = true;
    onRegenerateAll();
  }, [needsLegacyRegenerate, loading, onRegenerateAll]);

  // 2026-09-15: stacked dim sections → horizontal tab strip (mirrors S2).
  // Ordered by DIMENSION_ORDER first so tabs are stable regardless of the
  // payload order; unknown dimensions appended at the end. Default active
  // is the first available dim so users land on content immediately after
  // /diverge returns.
  const orderedKeys: string[] = [
    ...DIMENSION_ORDER.filter((k) => safeDimensions.some((d) => d.dimension === k)),
    ...safeDimensions
      .filter((d) => !DIMENSION_ORDER.includes(d.dimension as typeof DIMENSION_ORDER[number]))
      .map((d) => d.dimension),
  ];
  const [activeKey, setActiveKey] = useState<string>(
    () => orderedKeys[0] ?? "",
  );

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="flex-1 min-h-0 overflow-y-auto px-6 pt-2">
        {allFailed && (
          <div className="p-3 bg-error-container/20 border border-error rounded-lg text-error text-sm" data-testid="all-failed-banner">
            所有 unit 发散失败,请点击 footer 「重新生成」重试。
          </div>
        )}

        {orderedKeys.length > 0 && (
          // Sticky tab strip; inactive panels stay in DOM under `hidden` so
          // candidate radio states + regen buttons remain reachable without
          // remount, matching the S2 convention.
          <div
            role="tablist"
            aria-label="发散维度"
            data-testid="diverge-dim-tabs"
            className="sticky top-0 z-10 -mx-6 px-6 bg-surface-container-low/95 backdrop-blur-sm flex gap-1 mt-3 border-b border-outline-variant overflow-x-auto"
          >
            {orderedKeys.map((key) => {
              const dim = safeDimensions.find((d) => d.dimension === key);
              if (!dim) return null;
              const meta = DIMENSION_LABELS[key] ?? { label: key, icon: "auto_awesome" };
              const isActive = activeKey === key;
              return (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  aria-controls={`diverge-dim-panel-${key}`}
                  data-testid={`diverge-dim-tab-${key}`}
                  onClick={() => setActiveKey(key)}
                  className={
                    "shrink-0 px-3 py-2 text-sm font-display font-medium border-b-2 -mb-px flex items-center gap-2 transition-colors " +
                    (isActive
                      ? "border-primary text-primary"
                      : "border-transparent text-on-surface-variant hover:text-primary hover:border-outline-variant")
                  }
                >
                  <span aria-hidden="true" className="material-symbols-outlined text-base leading-none">
                    {meta.icon}
                  </span>
                  <span>{meta.label}</span>
                  <span className="font-mono text-[10px] opacity-70" aria-label={`${dim.units.length} 个单元`}>
                    {dim.units.length}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {orderedKeys.map((key) => {
          const dim = safeDimensions.find((d) => d.dimension === key);
          if (!dim) return null;
          const isActive = activeKey === key;
          return (
            <section
              key={key}
              id={`diverge-dim-panel-${key}`}
              role="tabpanel"
              aria-labelledby={`diverge-dim-tab-${key}`}
              hidden={!isActive}
              data-testid={`diverge-dim-${key}`}
              className="bg-surface-container-low border border-outline-variant rounded-lg p-3 space-y-2 mt-3"
            >
              {dim.units.map((u) => {
                const unitCandidatesAll = dim.candidates.filter((c) => c.unit_id === u.id);
                const { original, others } = partitionOriginalCandidate(unitCandidatesAll);
                const unitCandidates = original
                  ? [original, ...others]
                  : [...others].sort((a, b) => a.selection_rank - b.selection_rank);
                const unitFailed = unitCandidates.length === 0;
                const selectedIdx = unitCandidates.findIndex((c) => c.selection_rank === 0);
                const mainOp = unitCandidates[selectedIdx]?.main_operator ?? "distort";
                const auxOp = unitCandidates[selectedIdx]?.aux_operator ?? null;

                return (
                  <div key={u.id} className="bg-surface-container border border-outline-variant rounded-lg p-3 text-sm space-y-2" data-testid={`diverge-unit-${u.id}`}>
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-[10px] uppercase tracking-wider text-on-surface-variant">
                            Unit #{u.id}
                          </span>
                          <span className="font-display text-sm font-semibold text-primary truncate">
                            {u.unit_name}
                          </span>
                        </div>
                      </div>
                      <SecondaryButton
                        label="重新生成该单元"
                        icon="refresh"
                        size="sm"
                        onClick={() => onRegenerateUnit(u.id)}
                      />
                    </div>
                    {unitFailed ? (
                      <div className="text-warning bg-warning-container/20 border border-warning/30 rounded p-2 text-sm">
                        该单元暂不可用 (发散失败)
                      </div>
                    ) : (
                      <>
                        <div className="flex items-center gap-3 text-xs text-on-surface-variant">
                          <span className="inline-flex items-center gap-1">
                            <span aria-hidden="true" className="material-symbols-outlined text-sm leading-none">
                              {OPERATOR_ICONS[mainOp]}
                            </span>
                            主算子:{OPERATOR_LABELS[mainOp]}
                          </span>
                          {auxOp && (
                            <span className="inline-flex items-center gap-1">
                              <span aria-hidden="true" className="material-symbols-outlined text-sm leading-none">
                                {OPERATOR_ICONS[auxOp]}
                              </span>
                              副算子:{OPERATOR_LABELS[auxOp]}
                            </span>
                          )}
                        </div>
                        <div className="space-y-1">
                          {unitCandidates.map((c) => {
                            const dataIdx = dim.candidates
                              .filter((x) => x.unit_id === u.id)
                              .indexOf(c);
                            return (
                              <CandidateRow
                                key={c.id}
                                candidate={c}
                                selected={c.selection_rank === 0}
                                isOriginal={original !== null && c.id === original.id}
                                onSelect={() => onSelectCandidate(u.id, dataIdx)}
                              />
                            );
                          })}
                        </div>
                      </>
                    )}
                  </div>
                );
              })}
            </section>
          );
        })}
      </div>
    </div>
  );
}

function CandidateRow({
  candidate, selected, isOriginal = false, onSelect,
}: {
  candidate: UnitCandidate;
  selected: boolean;
  isOriginal?: boolean;
  onSelect: () => void;
}) {
  return (
    <label className="flex items-start gap-2 cursor-pointer" data-testid={`candidate-${candidate.id}`}>
      <input type="radio" checked={selected} onChange={onSelect} className="mt-1 accent-primary-container" />
      <div className="flex-1">
        <div className="text-primary text-sm">
          {isOriginal && <span className="text-on-surface-variant mr-1">[原始拆解]</span>}
          {candidate.description}
        </div>
        {candidate.chain_reaction && (
          <div className="text-xs text-on-surface-variant mt-1">
            连锁推演:{candidate.chain_reaction}
          </div>
        )}
      </div>
    </label>
  );
}