const OPERATION_LABELS: Record<string, { zh: string; en: string }> = {
  twist:      { zh: "扭曲", en: "TWIST" },
  break:      { zh: "打破", en: "BREAK" },
  fuse:       { zh: "融合", en: "FUSE" },
  fusion:     { zh: "融合", en: "FUSE" },
  invert:     { zh: "反转", en: "INVERT" },
  escalate:   { zh: "升级", en: "ESCALATE" },
  dramaturgy: { zh: "收束", en: "DRAMATURGY" },
};

interface Props {
  currentStep: number;
  maxSteps: number;
  operation: string;
}

export function StepIndicator({ currentStep, maxSteps, operation }: Props) {
  const label = OPERATION_LABELS[operation] ?? { zh: operation, en: operation.toUpperCase() };
  return (
    <div data-testid="step-indicator" className="flex flex-col items-end">
      <span className="font-label-sm text-label-sm text-primary mb-xs uppercase tracking-wider">
        STEP {currentStep} / {maxSteps} : {label.zh} ({label.en})
      </span>
      <div className="flex gap-2">
        {Array.from({ length: maxSteps }, (_, i) => i + 1).map((n) => {
          const isCompleted = n < currentStep;
          const isCurrent = n === currentStep;
          const cls = isCompleted || isCurrent
            ? "w-8 h-2 rounded-full bg-primary glow-active"
            : "w-8 h-2 rounded-full bg-surface-variant";
          return <div key={n} data-testid={`progress-dot-${n}`} className={cls} />;
        })}
      </div>
    </div>
  );
}