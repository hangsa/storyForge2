import { PrimaryButton, SecondaryButton } from "@/components/ds";
import type { DimensionDecomposition, Operator, UnitCandidate } from "./types";

interface Props {
  dimensions: DimensionDecomposition[];
  loading: boolean;
  onRegenerateUnit: (unitId: string) => void;
  onSelectCandidate: (unitId: string, candidateIndex: number) => void;
  onRegenerateAll: () => void;
  onPrev: () => void;
  onNext: () => void;
}

const OPERATOR_LABELS: Record<Operator, string> = {
  distort: "扭曲",
  break: "打破",
  blend: "融合",
  chain: "组合链",
};

export default function S3DivergeStep({
  dimensions, loading, onRegenerateUnit, onSelectCandidate, onRegenerateAll, onPrev, onNext,
}: Props) {
  const allFailed = dimensions.length > 0 && dimensions.every((d) =>
    d.units.length > 0 && d.units.every((u) => !d.candidates.some((c) => c.unit_id === u.id))
  );

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="space-y-4 flex-1 min-h-0 overflow-y-auto">
        <div className="flex items-center justify-between">
          <header className="font-mono text-primary-container text-[10px] uppercase tracking-wider">
            Stage 3 · 自适应发散
          </header>
          <SecondaryButton label="全部重新生成" icon="refresh" size="sm" onClick={onRegenerateAll} />
        </div>

        {allFailed && (
          <div className="p-3 bg-error-container/20 border border-error rounded-lg text-error text-sm" data-testid="all-failed-banner">
            所有 unit 发散失败,请点击「全部重新生成」重试。
          </div>
        )}

        {dimensions.map((dim) => (
          <section key={dim.dimension} className="bg-surface-container-low border border-outline-variant rounded-lg p-3 space-y-2" data-testid={`diverge-dim-${dim.dimension}`}>
            <h3 className="font-mono text-primary-container text-[10px] uppercase tracking-wider">
              {dim.dimension}
            </h3>
            {dim.units.map((u) => {
              const unitCandidates = dim.candidates
                .filter((c) => c.unit_id === u.id)
                .sort((a, b) => a.selection_rank - b.selection_rank);
              const unitFailed = unitCandidates.length === 0;
              const selectedIdx = unitCandidates.findIndex((c) => c.selection_rank === 0);

              return (
                <div key={u.id} className="bg-surface-container border border-outline-variant rounded-lg p-3 text-sm space-y-2" data-testid={`diverge-unit-${u.id}`}>
                  <div className="font-mono text-primary-container text-[10px] uppercase tracking-wider">
                    {u.unit_name} [Unit #{u.id}]
                  </div>
                  {unitFailed ? (
                    <div className="space-y-2">
                      <div className="text-warning bg-warning-container/20 border border-warning/30 rounded p-2 text-sm">
                        该单元暂不可用 (发散失败)
                      </div>
                      <button
                        type="button"
                        onClick={() => onRegenerateUnit(u.id)}
                        className="px-3 py-1.5 rounded text-sm bg-primary-container/15 text-primary-container hover:bg-primary-container/25"
                      >
                        重新生成该单元
                      </button>
                    </div>
                  ) : (
                    <>
                      <div className="text-xs text-on-surface-variant">
                        算子: {OPERATOR_LABELS[unitCandidates[selectedIdx]?.main_operator ?? "distort"]}
                        {unitCandidates[selectedIdx]?.aux_operator && ` · ${OPERATOR_LABELS[unitCandidates[selectedIdx]?.aux_operator ?? "distort"]}`}
                      </div>
                      <div className="space-y-1">
                        {unitCandidates.map((c) => (
                          <CandidateRow
                            key={c.id}
                            candidate={c}
                            selected={c.selection_rank === 0}
                            onSelect={() => onSelectCandidate(u.id, c.selection_rank)}
                          />
                        ))}
                      </div>
                      <button
                        type="button"
                        onClick={() => onRegenerateUnit(u.id)}
                        className="px-3 py-1.5 rounded text-sm bg-primary-container/15 text-primary-container hover:bg-primary-container/25"
                      >
                        重新生成该单元
                      </button>
                    </>
                  )}
                </div>
              );
            })}
          </section>
        ))}
      </div>

      <footer className="flex items-center justify-between px-margin-desktop py-3 border-t border-outline-variant gap-3 shrink-0">
        <SecondaryButton label="上一步:拆解" icon="arrow_back" onClick={onPrev} />
        <PrimaryButton
          label={loading ? "发散中…" : "下一步:提交 →"}
          loading={loading}
          onClick={onNext}
        />
      </footer>
    </div>
  );
}

function CandidateRow({
  candidate, selected, onSelect,
}: {
  candidate: UnitCandidate;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <label className="flex items-start gap-2 cursor-pointer" data-testid={`candidate-${candidate.id}`}>
      <input type="radio" checked={selected} onChange={onSelect} className="mt-1 accent-primary-container" />
      <div className="flex-1">
        <div className="text-primary text-sm">{candidate.description}</div>
        <div className="text-xs text-on-surface-variant mt-1">
          连锁推演:{candidate.chain_reaction}
        </div>
      </div>
    </label>
  );
}