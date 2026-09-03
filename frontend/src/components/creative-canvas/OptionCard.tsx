import type { CreativeOption } from "@/api/client";
import { QualityBar } from "./QualityBar";
import { AIRecommendedBadge } from "./AIRecommendedBadge";

type Slot = "A" | "B" | "C";

interface Props {
  option: CreativeOption;
  slot: Slot;
  operationLabel: string; // e.g. "融合"
  recommended: boolean;
  selected: boolean;
  onSelect: (optionId: string) => void;
  disabled: boolean;
}

export function OptionCard({
  option,
  slot,
  operationLabel,
  recommended,
  selected,
  onSelect,
  disabled,
}: Props) {
  const titleClass = recommended
    ? "text-primary"
    : "text-on-surface group-hover:text-primary";
  const panelClass = recommended
    ? "glass-panel rounded-xl p-md flex flex-col border-primary glow-active bg-surface-container-highest relative h-full"
    : "glass-panel rounded-xl p-md flex flex-col hover:border-primary/50 transition-colors cursor-pointer group h-full";

  return (
    <div
      data-testid={`option-card-${option.id}`}
      data-recommended={recommended}
      data-selected={selected}
      className={panelClass}
    >
      {recommended && <AIRecommendedBadge />}
      <div className="flex justify-between items-start mb-md mt-2">
        <h4
          className={`font-title-md text-title-md transition-colors ${titleClass}`}
        >
          {operationLabel} {slot}: {option.title}
        </h4>
        <QualityBar
          novelty={option.scores?.novelty ?? 0}
          conflict={option.scores?.conflict ?? 0}
        />
      </div>
      <p
        className={`text-sm flex-1 mb-md ${recommended ? "text-on-surface" : "text-on-surface-variant"}`}
      >
        {option.premise}
      </p>
      <button
        type="button"
        disabled={disabled}
        onClick={() => onSelect(option.id)}
        className={
          recommended
            ? "w-full py-xs rounded bg-primary text-on-primary font-bold hover:bg-primary-container transition-colors shadow-[0_0_15px_rgba(56,189,248,0.2)]"
            : "w-full py-xs rounded border border-outline-variant text-on-surface-variant group-hover:border-primary/50 group-hover:text-primary transition-colors"
        }
      >
        {recommended
          ? `Continue with Option ${slot}`
          : `Select Option ${slot}`}
      </button>
    </div>
  );
}