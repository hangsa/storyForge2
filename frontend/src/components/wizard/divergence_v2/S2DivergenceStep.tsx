import { PrimaryButton, SecondaryButton } from "@/components/ds";
import {
  OPERATORS, OPERATOR_LABELS, OPERATOR_ICONS,
  type Candidate, type Operator,
} from "./types";

interface Props {
  candidates: Candidate[];
  byOperator: Record<Operator, Candidate[]>;
  selectedIds: string[];
  onToggleSelect: (id: string) => void;
  onRegenerateOne: (id: string) => void;
  onRegenerateAll: () => void;
  onNext: () => void;
}

const MAX_SELECT = 3;

// Material-Symbol glyphs for each operator — match the conceptual metaphor
// (breaking = hammer/impact, bending = wave, blending = merge). These render
// in the existing `material-symbols-outlined` font family loaded by the app.
const OPERATOR_GLYPHS: Record<Operator, string> = {
  breaking: "build",
  bending: "waves",
  blending: "merge_type",
};

export default function S2DivergenceStep({
  candidates, byOperator, selectedIds,
  onToggleSelect, onRegenerateOne, onRegenerateAll, onNext,
}: Props) {
  const canSelectMore = selectedIds.length < MAX_SELECT;

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="space-y-4 flex-1 min-h-0">
        <div className="flex items-center justify-between">
          <header className="font-mono text-primary-container text-[10px] uppercase tracking-wider">
            Stage 2 · 3B 并行发散结果 · 共 {candidates.length} 个候选
          </header>
          <SecondaryButton
            label="重新生成全部"
            icon="refresh"
            size="sm"
            onClick={onRegenerateAll}
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {OPERATORS.map((op) => (
            <OperatorColumn
              key={op}
              operator={op}
              count={byOperator[op]?.length ?? 0}
              candidates={byOperator[op] ?? []}
              selectedIds={selectedIds}
              canSelectMore={canSelectMore}
              onToggle={onToggleSelect}
              onRegenerateOne={onRegenerateOne}
            />
          ))}
        </div>
      </div>

      <footer className="flex items-center justify-between px-margin-desktop py-3 border-t border-outline-variant gap-3 shrink-0">
        <span className="text-sm text-on-surface-variant">
          已选 {selectedIds.length} / {MAX_SELECT}
        </span>
        <PrimaryButton
          label="下一步：深化"
          icon="arrow_forward"
          disabled={selectedIds.length === 0}
          onClick={onNext}
        />
      </footer>
    </div>
  );
}

function OperatorColumn({
  operator,
  count,
  candidates,
  selectedIds,
  canSelectMore,
  onToggle,
  onRegenerateOne,
}: {
  operator: Operator;
  count: number;
  candidates: Candidate[];
  selectedIds: string[];
  canSelectMore: boolean;
  onToggle: (id: string) => void;
  onRegenerateOne: (id: string) => void;
}) {
  return (
    <section className="bg-surface-container-low border border-outline-variant rounded-lg p-3 space-y-2 flex flex-col">
      <h3 className="flex items-center gap-2 text-on-surface">
        <span
          aria-hidden="true"
          className="material-symbols-outlined text-base text-primary-container"
        >
          {OPERATOR_GLYPHS[operator]}
        </span>
        <span className="font-mono text-primary-container text-[10px] uppercase tracking-wider">
          {OPERATOR_LABELS[operator]}
        </span>
        <span className="font-mono text-on-surface-variant text-xs ml-auto">
          {count}
        </span>
        <span aria-hidden="true" className="text-sm">
          {OPERATOR_ICONS[operator]}
        </span>
      </h3>
      {candidates.length ? (
        <div className="space-y-2">
          {candidates.map((c) => (
            <CandidateCard
              key={c.id}
              candidate={c}
              selected={selectedIds.includes(c.id)}
              selectable={selectedIds.includes(c.id) || canSelectMore}
              onToggle={() => onToggle(c.id)}
              onRegenerate={() => onRegenerateOne(c.id)}
            />
          ))}
        </div>
      ) : (
        <div className="text-sm text-warning bg-warning-container/20 border border-warning/30 rounded p-2">
          该算子暂不可用
        </div>
      )}
    </section>
  );
}

function CandidateCard({
  candidate, selected, selectable, onToggle, onRegenerate,
}: {
  candidate: Candidate;
  selected: boolean;
  selectable: boolean;
  onToggle: () => void;
  onRegenerate: () => void;
}) {
  return (
    // Outer div is clickable so the whole card body (e.g. premise text) toggles
    // selection. The onClick guard below ensures clicking the regenerate button
    // inside the card still fires only that button's onRegenerate handler.
    <div
      onClick={(e) => {
        if ((e.target as HTMLElement).closest("button")) return;
        onToggle();
      }}
      className={
        "border rounded-lg p-3 text-sm cursor-pointer transition-colors " +
        (selected
          ? "border-primary-container bg-primary-container/10"
          : "border-outline-variant bg-surface-container hover:border-primary-container/40")
      }
      data-testid={`candidate-card-${candidate.id}`}
    >
      <div className="font-mono text-primary-container text-[10px] uppercase tracking-wider">
        [{candidate.sub_dimension}]
      </div>
      <div className="text-primary mt-1">{candidate.premise_one_line}</div>
      <div className="text-xs text-on-surface-variant mt-2">
        新颖点:{candidate.novelty_hook}
      </div>
      <div className="flex justify-between items-center mt-3">
        <label
          className={
            "flex items-center gap-2 text-sm " +
            (selectable ? "" : "opacity-50 cursor-not-allowed")
          }
        >
          <input
            type="checkbox"
            checked={selected}
            disabled={!selectable}
            onChange={onToggle}
            className="accent-primary-container"
          />
          <span className="text-on-surface-variant">选择</span>
        </label>
        <SecondaryButton
          label={`再生成${candidate.regenerated_count > 0 ? ` (${candidate.regenerated_count})` : ""}`}
          icon="refresh"
          size="sm"
          onClick={onRegenerate}
        />
      </div>
    </div>
  );
}