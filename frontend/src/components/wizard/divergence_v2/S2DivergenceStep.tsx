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

export default function S2DivergenceStep({
  candidates, byOperator, selectedIds,
  onToggleSelect, onRegenerateOne, onRegenerateAll, onNext,
}: Props) {
  const canSelectMore = selectedIds.length < MAX_SELECT;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">
          3B 并行发散结果 · 共 {candidates.length} 个候选
        </h2>
        <button
          type="button"
          onClick={onRegenerateAll}
          className="px-3 py-1 border rounded text-sm"
        >
          重新生成全部
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {OPERATORS.map((op) => (
          <div key={op} className="border rounded p-3">
            <h3 className="font-medium mb-2">
              {OPERATOR_ICONS[op]} {OPERATOR_LABELS[op]} ({byOperator[op]?.length ?? 0})
            </h3>
            {byOperator[op]?.length ? (
              <div className="space-y-2">
                {byOperator[op].map((c) => (
                  <CandidateCard
                    key={c.id}
                    candidate={c}
                    selected={selectedIds.includes(c.id)}
                    selectable={selectedIds.includes(c.id) || canSelectMore}
                    onToggle={() => onToggleSelect(c.id)}
                    onRegenerate={() => onRegenerateOne(c.id)}
                  />
                ))}
              </div>
            ) : (
              <div className="text-sm text-amber-600 bg-amber-50 p-2 rounded">
                该算子暂不可用
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="sticky bottom-0 bg-white border-t p-3 flex justify-between items-center">
        <span className="text-sm">
          已选 {selectedIds.length} / {MAX_SELECT}
        </span>
        <button
          type="button"
          disabled={selectedIds.length === 0}
          onClick={onNext}
          className="px-4 py-2 bg-blue-500 text-white rounded disabled:bg-gray-300"
        >
          下一步：深化
        </button>
      </div>
    </div>
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
        "border rounded p-2 text-sm cursor-pointer " +
        (selected ? "border-blue-500 bg-blue-50" : "")
      }
      data-testid={`candidate-card-${candidate.id}`}
    >
      <div className="font-medium">[{candidate.sub_dimension}]</div>
      <div>{candidate.premise_one_line}</div>
      <div className="text-xs text-gray-500 mt-1">新颖点：{candidate.novelty_hook}</div>
      <div className="flex justify-between items-center mt-2">
        <label className={selectable ? "" : "opacity-50"}>
          <input
            type="checkbox"
            checked={selected}
            disabled={!selectable}
            onChange={onToggle}
          />{" "}
          选择
        </label>
        <button
          type="button"
          onClick={onRegenerate}
          className="text-xs px-2 py-1 border rounded"
        >
          再生成{candidate.regenerated_count > 0 ? ` (${candidate.regenerated_count})` : ""}
        </button>
      </div>
    </div>
  );
}
