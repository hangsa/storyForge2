import { SUB_STAGES, type SubStage } from "./types";

interface Props {
  current: SubStage;
  completed: SubStage[];
  onJump: (stage: SubStage) => void;
}

export default function StepIndicator({ current, completed, onJump }: Props) {
  return (
    <div className="px-6 py-3 border-b border-outline-variant">
      <nav
        aria-label="3B 三阶段"
        className="flex items-center gap-2 text-sm"
        data-testid="step-indicator"
      >
        {SUB_STAGES.map((s, i) => {
          const isCurrent = s.key === current;
          const isCompleted = completed.includes(s.key);
          const clickable = isCompleted && !isCurrent;
          const chipClass = isCurrent
            ? "bg-primary text-on-primary rounded-full text-sm font-medium"
            : isCompleted
            ? "bg-surface-container text-primary hover:bg-surface-container-low rounded-full text-sm"
            : "bg-surface-container-lowest text-on-surface-variant opacity-50 cursor-not-allowed rounded-full text-sm";
          return (
            <div key={s.key} className="flex items-center gap-2">
              {i > 0 && (
                <span className="text-outline-variant" aria-hidden="true">
                  ›
                </span>
              )}
              <button
                type="button"
                disabled={!clickable}
                onClick={() => clickable && onJump(s.key)}
                className={`px-3 py-1 transition-colors ${chipClass}`}
              >
                {i + 1}. {s.label}
              </button>
            </div>
          );
        })}
      </nav>
    </div>
  );
}