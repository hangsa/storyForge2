import React from "react";
import type { SubStage } from "./types";

const STAGES: Array<{ key: SubStage; label: string; icon: string }> = [
  { key: "1", label: "输入灵感", icon: "edit_note" },
  { key: "2", label: "第一性拆解", icon: "account_tree" },
  { key: "3", label: "自适应发散", icon: "call_split" },
  { key: "4", label: "提交", icon: "task_alt" },
];

interface Props {
  current: SubStage;
  completed: SubStage[];
  onStageClick: (stage: SubStage) => void;
}

export function StepIndicator({ current, completed, onStageClick }: Props) {
  return (
    <div className="flex items-center gap-2 mb-6 px-6 pt-4" data-testid="step-indicator">
      {STAGES.map((s, idx) => {
        const isCurrent = current === s.key;
        const isCompleted = completed.includes(s.key);
        const canJump = isCompleted && !isCurrent;
        return (
          <React.Fragment key={s.key}>
            <button
              type="button"
              disabled={!canJump}
              onClick={() => onStageClick(s.key)}
              className={[
                "flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-full text-sm transition-colors min-w-[7.5rem]",
                isCurrent
                  ? "bg-primary text-on-primary font-semibold shadow-sm"
                  : isCompleted
                    ? "bg-primary-container/20 text-primary-container hover:bg-primary-container/30"
                    : "bg-surface-container text-on-surface-variant opacity-60 cursor-not-allowed",
              ].join(" ")}
              data-testid={`step-indicator-${s.key}`}
            >
              <span className="material-symbols-outlined text-base leading-none">{s.icon}</span>
              <span className="font-mono text-sm tracking-wider">{s.label}</span>
            </button>
            {idx < STAGES.length - 1 && (
              <span className="material-symbols-outlined text-on-surface-variant opacity-40 text-base leading-none">chevron_right</span>
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}
