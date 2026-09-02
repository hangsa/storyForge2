import { SecondaryButton } from "@/components/ds";

interface Props {
  currentStep: number;
  totalSteps: number;
  onViewPath: () => void;
  onReset: () => void;
}

export function CanvasToolbar({ currentStep, totalSteps, onViewPath, onReset }: Props) {
  return (
    <div className="flex items-center justify-between px-4 py-2 border-b border-outline-variant">
      <span className="text-sm text-on-surface-variant">
        Step {currentStep} / {totalSteps}
      </span>
      <div className="flex gap-2">
        <SecondaryButton label="查看完整路径" onClick={onViewPath} size="sm" />
        <SecondaryButton label="重新开始" onClick={onReset} size="sm" variant="destructive" />
      </div>
    </div>
  );
}