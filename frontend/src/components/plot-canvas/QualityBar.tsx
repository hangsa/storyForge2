interface Props {
  novelty: number;
  conflict: number;
}

// TODO(canvas-v2): backend scores scale is currently undecided. compute_op_hint
// tests pass 0-1, but NoveltyEvaluator has not yet been wired to fill option
// `scores`. If the real evaluator writes 0-100, normalize here before display.
// Until then: clamp to [0, 1] so a 0-100 input can't render as 7000%.
const toPct = (v: number) => Math.min(100, Math.max(0, Math.round(v * 100)));

export function QualityBar({ novelty, conflict }: Props) {
  const items = [
    { key: "novelty", label: "Novelty", value: novelty, color: "bg-primary", labelColor: "text-surface-tint" },
    { key: "conflict", label: "Conflict", value: conflict, color: "bg-error", labelColor: "text-error" },
  ];
  return (
    <div data-testid="quality-bar" className="flex flex-col gap-1 items-end">
      {items.map((item) => (
        <div
          key={item.key}
          data-testid={`quality-${item.key}`}
          className="flex flex-col gap-1 items-end"
        >
          <span className={`font-label-sm text-label-sm ${item.labelColor}`}>
            {item.label}: {toPct(item.value) / 10}/10
          </span>
          <div className="w-16 h-1 bg-surface-variant rounded-full overflow-hidden">
            <div
              className={`h-full ${item.color}`}
              style={{ width: `${toPct(item.value)}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}