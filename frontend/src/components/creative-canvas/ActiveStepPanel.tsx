import { PrimaryButton } from "@/components/ds";

interface CreativeOptionShape {
  id: string;
  title: string;
  premise: string;
  logic: string;
  scores: Record<string, number>;
}

interface OperationShape {
  type: string;
  name: string;
  reason: string;
}

interface Props {
  step: number;
  operation: OperationShape;
  options: CreativeOptionShape[];
  onSelect: (optionId: string) => void;
  disabled?: boolean;
}

export function ActiveStepPanel({
  step,
  operation,
  options,
  onSelect,
  disabled = false,
}: Props) {
  return (
    <div className="border border-outline-variant rounded-lg p-6 bg-surface-container">
      <div className="mb-4">
        <h2 className="text-lg font-medium">
          STEP {step} / {operation.name}
        </h2>
        <p className="text-sm text-on-surface-variant mt-1">
          AI 为什么推荐「{operation.name}」?{operation.reason}
        </p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {options.map((opt, idx) => (
          <div
            key={opt.id}
            data-testid={`option-card-${idx}`}
            className="border border-outline-variant rounded-lg p-4 bg-surface flex flex-col"
          >
            <h3 className="font-medium mb-2">{opt.title}</h3>
            <p className="text-sm text-on-surface-variant flex-1 mb-3">
              {opt.premise}
            </p>
            {opt.logic && (
              <p className="text-xs text-on-surface-variant/70 italic mb-2">
                {opt.logic}
              </p>
            )}
            <PrimaryButton
              label={disabled ? "提交中..." : "选择"}
              onClick={() => onSelect(opt.id)}
              disabled={disabled}
              size="sm"
            />
          </div>
        ))}
      </div>
    </div>
  );
}
