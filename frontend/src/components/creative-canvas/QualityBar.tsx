interface Props {
  novelty: number;
  conflict: number;
  storyPotential: number;
}

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
              style={{ width: `${Math.round(item.value * 100)}%` }}
            />
          </div>
          <span className="font-medium">{Math.round(item.value * 100)}</span>
        </div>
      ))}
    </div>
  );
}
