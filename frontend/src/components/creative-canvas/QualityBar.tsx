interface Props {
  novelty: number;
  conflict: number;
  storyPotential: number;
}

// TODO(canvas-v2): backend scores scale is currently undecided. compute_op_hint
// tests pass 0-1, but NoveltyEvaluator has not yet been wired to fill option
// `scores`. If the real evaluator writes 0-100, normalize here before display.
// Until then: clamp to [0, 1] so a 0-100 input can't render as 7000%.
const toPct = (v: number) => Math.min(100, Math.max(0, Math.round(v * 100)));

export function QualityBar({ novelty, conflict, storyPotential }: Props) {
  const items = [
    { label: "新颖度", value: novelty, color: "bg-primary" },
    { label: "冲突", value: conflict, color: "bg-secondary" },
    { label: "故事潜力", value: storyPotential, color: "bg-tertiary" },
  ];
  return (
    <div
      data-testid="quality-bar"
      className="flex gap-6 p-3 bg-surface-container rounded-lg"
    >
      {items.map((item) => (
        <div key={item.label} className="flex items-center gap-2 text-sm">
          <span className="text-on-surface-variant">{item.label}</span>
          <div className="w-24 h-2 bg-surface-container-high rounded overflow-hidden">
            <div
              className={`h-full ${item.color}`}
              style={{ width: `${toPct(item.value)}%` }}
            />
          </div>
          <span className="font-medium">{toPct(item.value)}</span>
        </div>
      ))}
    </div>
  );
}
