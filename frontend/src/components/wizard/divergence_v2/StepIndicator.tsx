import { SUB_STAGES, type SubStage } from "./types";

interface Props {
  current: SubStage;
  completed: SubStage[];
  onJump: (stage: SubStage) => void;
}

export default function StepIndicator({ current, completed, onJump }: Props) {
  return (
    <nav
      aria-label="3B 三阶段"
      className="flex items-center gap-2 text-sm"
      data-testid="step-indicator"
    >
      {SUB_STAGES.map((s, i) => {
        const isCurrent = s.key === current;
        const isCompleted = completed.includes(s.key);
        const clickable = isCompleted && !isCurrent;
        return (
          <div key={s.key} className="flex items-center gap-2">
            {i > 0 && <span className="text-gray-400">›</span>}
            <button
              type="button"
              disabled={!clickable}
              onClick={() => clickable && onJump(s.key)}
              className={
                "px-3 py-1 rounded transition-colors " +
                (isCurrent
                  ? "bg-blue-500 text-white"
                  : isCompleted
                  ? "bg-green-100 text-green-800 hover:bg-green-200"
                  : "bg-gray-100 text-gray-500 cursor-not-allowed")
              }
            >
              {s.key}. {s.label}
            </button>
          </div>
        );
      })}
    </nav>
  );
}
