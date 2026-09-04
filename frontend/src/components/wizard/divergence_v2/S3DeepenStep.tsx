import { useState } from "react";
import api from "@/api/client";
import {
  OPERATORS, OPERATOR_LABELS, type Candidate, type DeepenedCandidate, type Operator,
} from "./types";

interface Props {
  selectedCandidates: Candidate[];
  deepened: DeepenedCandidate[];
  appliedOperators: Record<string, Operator>;
  onAppliedOperatorChange: (candidateId: string, op: Operator) => void;
  projectId: string;
  onCommitSuccess: () => void;
}

export default function S3DeepenStep({
  selectedCandidates, deepened, appliedOperators,
  onAppliedOperatorChange, projectId, onCommitSuccess,
}: Props) {
  const [committing, setCommitting] = useState(false);

  const allDeepened = selectedCandidates.every((c) =>
    deepened.some((d) => d.source_candidate_id === c.id),
  );
  const canCommit = allDeepened && !committing;

  async function handleCommit() {
    if (!canCommit) return;
    setCommitting(true);
    try {
      const deepenedIds = selectedCandidates.map(
        (c) => deepened.find((d) => d.source_candidate_id === c.id)!.id,
      );
      await api.postThreeBCommit(projectId, { deepened_ids: deepenedIds });
      onCommitSuccess();
    } finally {
      setCommitting(false);
    }
  }

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold">深化候选</h2>

      <div className="grid grid-cols-1 md:grid-cols-[1fr,2fr] gap-4">
        <div className="space-y-2">
          <h3 className="font-medium">已选候选 ({selectedCandidates.length})</h3>
          {selectedCandidates.map((c) => (
            <div key={c.id} className="border rounded p-2 text-sm">
              <div className="font-medium">[{OPERATOR_LABELS[c.operator]}] {c.sub_dimension}</div>
              <div>{c.premise_one_line}</div>
              <div className="mt-2 flex gap-2">
                {OPERATORS.filter((op) => op !== c.operator).map((op) => (
                  <button
                    key={op}
                    type="button"
                    onClick={() => onAppliedOperatorChange(c.id, op)}
                    className={
                      "px-2 py-1 text-xs border rounded " +
                      (appliedOperators[c.id] === op
                        ? "bg-blue-500 text-white"
                        : "")
                    }
                  >
                    {OPERATOR_LABELS[op]}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="space-y-2">
          <h3 className="font-medium">深化结果</h3>
          {deepened.map((d) => (
            <div key={d.id} className="border rounded p-2 text-sm bg-blue-50">
              <div className="text-xs text-gray-500">
                算子: {OPERATOR_LABELS[d.applied_operator]} · 子维度: {d.applied_sub_dimension}
              </div>
              <div>{d.premise_one_line}</div>
            </div>
          ))}
          {deepened.length === 0 && (
            <div className="text-sm text-gray-500">尚未深化(在左侧选算子触发自动深化)</div>
          )}
        </div>
      </div>

      <div className="border-t pt-3 flex justify-between items-center">
        <span className="text-sm text-gray-600">
          已深化 {deepened.length} / {selectedCandidates.length}
        </span>
        <button
          type="button"
          disabled={!canCommit}
          onClick={handleCommit}
          className="px-4 py-2 bg-green-500 text-white rounded disabled:bg-gray-300"
        >
          {committing ? "提交中…" : "提交创意发散"}
        </button>
      </div>
    </div>
  );
}
