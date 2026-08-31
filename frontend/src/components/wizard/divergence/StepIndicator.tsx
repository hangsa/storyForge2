export type SubStage = "A" | "B" | "C" | "D" | "E";

interface Props {
  current: SubStage;
  completed: SubStage[];
  onJump: (sub: SubStage) => void;
}

const STAGES: Array<{ key: SubStage; label: string }> = [
  { key: "A", label: "输入" },
  { key: "B", label: "变体" },
  { key: "C", label: "矛盾" },
  { key: "D", label: "展开" },
  { key: "E", label: "提交" },
];

export default function StepIndicator({ current, completed, onJump }: Props) {
  return (
    <div className="flex items-center gap-2 px-4 py-3 border-b border-outline-variant">
      {STAGES.map((s, i) => {
        const isCurrent = s.key === current;
        const isCompleted = completed.includes(s.key);
        const isClickable = isCompleted && !isCurrent;
        return (
          <div key={s.key} className="flex items-center gap-2">
            <button
              data-testid={`step-${s.key}`}
              type="button"
              disabled={!isClickable}
              onClick={() => isClickable && onJump(s.key)}
              className={[
                "px-3 py-1 rounded-full text-sm transition-colors",
                isCurrent ? "bg-primary text-on-primary font-medium" :
                isCompleted ? "bg-surface-container text-primary hover:bg-surface-container-low" :
                "bg-surface-container-lowest text-on-surface-variant opacity-50 cursor-not-allowed",
              ].join(" ")}
            >
              {i + 1}. {s.label}
            </button>
            {i < STAGES.length - 1 && <span className="text-outline-variant">›</span>}
          </div>
        );
      })}
    </div>
  );
}