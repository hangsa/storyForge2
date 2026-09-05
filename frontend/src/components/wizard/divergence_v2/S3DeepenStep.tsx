import { useState } from "react";
import api from "@/api/client";
import { PrimaryButton } from "@/components/ds";
import {
  OPERATORS, OPERATOR_LABELS, OPERATOR_ICONS, type DeepenedCandidate, type Operator,
} from "./types";

interface Props {
  selectedCandidates: import("./types").Candidate[];
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
    <div className="flex flex-col flex-1 min-h-0">
      <div className="space-y-4 flex-1 min-h-0">
        <header className="font-mono text-primary-container text-[10px] uppercase tracking-wider">
          Stage 3 · 深化候选
        </header>

        <div className="grid grid-cols-1 md:grid-cols-[1fr,2fr] gap-3">
          <section className="bg-surface-container-low border border-outline-variant rounded-lg p-3 space-y-2">
            <h3 className="flex items-center gap-2 font-mono text-primary-container text-[10px] uppercase tracking-wider">
              已选候选
              <span className="ml-auto font-mono text-on-surface-variant text-xs">
                {selectedCandidates.length}
              </span>
            </h3>
            {selectedCandidates.length === 0 ? (
              <div className="text-sm text-on-surface-variant py-4 text-center">
                尚未选择候选 — 回到 Stage 2 挑选
              </div>
            ) : (
              selectedCandidates.map((c) => (
                <div
                  key={c.id}
                  className="bg-surface-container border border-outline-variant rounded-lg p-3 text-sm space-y-2"
                >
                  <div className="font-mono text-primary-container text-[10px] uppercase tracking-wider">
                    [{OPERATOR_LABELS[c.operator]}] {c.sub_dimension}
                  </div>
                  <div className="text-primary">{c.premise_one_line}</div>
                  <div className="flex flex-wrap gap-2">
                    {OPERATORS.filter((op) => op !== c.operator).map((op) => {
                      const isActive = appliedOperators[c.id] === op;
                      return (
                        <button
                          key={op}
                          type="button"
                          onClick={() => onAppliedOperatorChange(c.id, op)}
                          className={
                            "px-3 py-1.5 rounded-full border text-sm transition-colors " +
                            (isActive
                              ? "bg-primary text-on-primary border-primary font-medium"
                              : "border-outline-variant text-on-surface-variant hover:text-primary hover:border-primary-container/50")
                          }
                        >
                          <span aria-hidden="true" className="mr-1">
                            {OPERATOR_ICONS[op]}
                          </span>
                          {OPERATOR_LABELS[op]}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))
            )}
          </section>

          <section className="bg-surface-container-low border border-outline-variant rounded-lg p-3 space-y-2">
            <h3 className="flex items-center gap-2 font-mono text-primary-container text-[10px] uppercase tracking-wider">
              深化结果
              <span className="ml-auto font-mono text-on-surface-variant text-xs">
                {deepened.length}
              </span>
            </h3>
            {deepened.length === 0 ? (
              <div className="text-sm text-on-surface-variant py-4 text-center">
                尚未深化 — 在左侧选算子触发自动深化
              </div>
            ) : (
              deepened.map((d) => (
                <div
                  key={d.id}
                  className="bg-primary-container/10 border border-primary-container/40 rounded-lg p-3 text-sm"
                >
                  <div className="font-mono text-primary-container text-[10px] uppercase tracking-wider">
                    {OPERATOR_ICONS[d.applied_operator]} {OPERATOR_LABELS[d.applied_operator]} · {d.applied_sub_dimension}
                  </div>
                  <div className="text-primary mt-1">{d.premise_one_line}</div>
                </div>
              ))
            )}
          </section>
        </div>
      </div>

      <footer className="flex items-center justify-between px-margin-desktop py-3 border-t border-outline-variant gap-3 shrink-0">
        <span className="text-sm text-on-surface-variant">
          已深化 {deepened.length} / {selectedCandidates.length}
        </span>
        <PrimaryButton
          label={committing ? "提交中…" : "提交创意发散"}
          icon={committing ? undefined : "rocket_launch"}
          loading={committing}
          disabled={!canCommit}
          onClick={handleCommit}
        />
      </footer>
    </div>
  );
}