import { useEffect, useRef } from "react";
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
  const allFailed = dimensions.length > 0 && dimensions.every((d) =>
    d.units.length > 0 && d.units.every((u) => !d.candidates.some((c) => c.unit_id === u.id))
  );

  // Task 8: legacy-state detection. If any unit has candidates but none of
  // them ends with `__original`, the state.json predates the backend
  // `_append_original_candidate` wiring (Tasks 2/3) and lacks the virtual
  // 原始拆解 row. Fire the parent's /diverge flow exactly once so the
  // backend regenerates the candidate set with the virtual row included.
  // The ref guard absorbs StrictMode double-mount and re-renders so we
  // never POST /diverge twice for the same legacy state.
  const needsLegacyRegenerate = dimensions.some((d) =>
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

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="space-y-3 flex-1 min-h-0 overflow-y-auto px-6 pt-2">
        {allFailed && (
          <div className="p-3 bg-error-container/20 border border-error rounded-lg text-error text-sm" data-testid="all-failed-banner">
            所有 unit 发散失败,请点击 footer 「重新生成」重试。
          </div>
        )}

        {dimensions.map((dim) => (
          <section key={dim.dimension} className="bg-surface-container-low border border-outline-variant rounded-lg p-3 space-y-2" data-testid={`diverge-dim-${dim.dimension}`}>
            <h3 className="font-display text-sm font-semibold text-primary-container">
              {dim.dimension}
            </h3>
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
        ))}
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
