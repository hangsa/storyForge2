import React from "react";
import type { SubStage } from "./types";

const STAGES: { key: SubStage; label: string }[] = [
  { key: "1", label: "1. 输入灵感" },
  { key: "2", label: "2. 第一性拆解" },
  { key: "3", label: "3. 自适应发散" },
  { key: "4", label: "4. 提交" },
];

interface Props {
  current: SubStage;
  completed: SubStage[];
  onStageClick: (stage: SubStage) => void;
}

export function StepIndicator({ current, completed, onStageClick }: Props) {
  return (
    <div className="flex items-center gap-2 mb-6">
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
                "px-3 py-1.5 rounded text-sm transition-colors",
                isCurrent
                  ? "bg-blue-600 text-white"
                  : isCompleted
                    ? "bg-blue-100 text-blue-800 hover:bg-blue-200"
                    : "bg-gray-100 text-gray-400 cursor-not-allowed",
              ].join(" ")}
              data-testid={`step-indicator-${s.key}`}
            >
              {s.label}
            </button>
            {idx < STAGES.length - 1 && <span className="text-gray-300">›</span>}
          </React.Fragment>
        );
      })}
    </div>
  );
}
