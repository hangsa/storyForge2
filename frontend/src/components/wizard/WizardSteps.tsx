const STEP_LABELS = ["概念讨论", "世界观", "角色设计", "地图系统", "全书大纲", "章节大纲"];

interface WizardStepsProps {
  currentStep: number;
  completedSteps: number[];
  onJump: (step: number) => void;
}

export default function WizardSteps({ currentStep, completedSteps, onJump }: WizardStepsProps) {
  return (
    <div
      data-testid="wizard-steps"
      className="flex items-center justify-between gap-2 px-2 py-4 border-b border-outline-variant"
    >
      {STEP_LABELS.map((label, idx) => {
        const stepNum = idx + 1;
        const completed = completedSteps.includes(stepNum);
        const current = currentStep === stepNum;
        const isReachable = completed || current;
        return (
          <button
            key={stepNum}
            type="button"
            data-testid={`wizard-step-${stepNum}`}
            data-state={completed ? "completed" : current ? "current" : "pending"}
            disabled={!isReachable}
            onClick={() => isReachable && onJump(stepNum)}
            className={`flex-1 flex flex-col items-center gap-1 px-1 py-1 rounded transition-colors
              ${current ? "bg-primary-container/10" : ""}
              ${isReachable ? "cursor-pointer hover:bg-surface-container-low" : "cursor-not-allowed opacity-50"}`}
          >
            <span
              className={`w-7 h-7 rounded-full flex items-center justify-center font-label-mono text-xs
                ${completed ? "bg-primary-container text-surface-container-low" : ""}
                ${current && !completed ? "border-2 border-primary-container text-primary-container bg-surface-container-low" : ""}
                ${!isReachable ? "border border-outline-variant text-system-log bg-surface-container" : ""}`}
            >
              {completed ? "✓" : stepNum}
            </span>
            <span
              className={`font-label-mono text-[10px] ${current ? "text-primary-container" : "text-system-log"}`}
            >
              {label}
            </span>
          </button>
        );
      })}
    </div>
  );
}