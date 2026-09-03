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
  // Card treatment aligned to the divergence wizard's variant cards (S0B):
  // flat borders (border-primary for recommended, border-outline-variant
  // otherwise), no glass-panel / glow overlays. Keeps the canvas option
  // cards visually consistent with the divergence variants when both
  // surface inside the wizard main area.
  const panelClass = recommended
    ? "border-2 border-primary rounded-lg p-4 flex flex-col bg-surface-container relative h-full"
    : "border border-outline-variant rounded-lg p-4 flex flex-col hover:border-primary transition-colors cursor-pointer group h-full";

  return (
    <div
      data-testid={`option-card-${option.id}`}
      data-recommended={recommended}
      data-selected={selected}
      className={panelClass}
    >
      {recommended && <AIRecommendedBadge />}
      <div className="flex justify-between items-start mb-2 mt-2">
        <h4
          className={`font-medium transition-colors ${titleClass}`}
        >
          {operationLabel} {slot}: {option.title}
        </h4>
        <QualityBar
          novelty={option.scores?.novelty ?? 0}
          conflict={option.scores?.conflict ?? 0}
        />
      </div>
      <p
        className={`text-sm flex-1 mb-4 ${recommended ? "text-on-surface" : "text-on-surface-variant"}`}
      >
        {option.premise}
      </p>
      <button
        type="button"
        disabled={disabled}
        onClick={() => onSelect(option.id)}
        className={
          recommended
            ? "w-full py-2 rounded bg-primary text-on-primary disabled:opacity-40 transition-colors"
            : "w-full py-2 rounded border border-outline-variant text-on-surface-variant hover:border-primary hover:text-primary transition-colors"
        }
      >
        {recommended
          ? `Continue with Option ${slot}`
          : `Select Option ${slot}`}
      </button>
    </div>
  );
}