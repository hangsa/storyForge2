import type { CreativeStep } from "@/api/client";

interface Props {
  rootIdea: string;
  path: CreativeStep[];
}

const STATE_LABELS: Record<CreativeStep["state"], string> = {
  locked: "○",
  available: "▢",
  active: "●",
  completed: "✓",
  stale: "⚠",
};

export function HorizontalPathCanvas({ rootIdea, path }: Props) {
  const completedCount = path.filter((p) => p.state === "completed").length;
  return (
    <div data-testid="horizontal-path-canvas" className="p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-base font-medium">Creative Canvas</h3>
        <span className="text-sm text-on-surface-variant">
          创意深度 {completedCount} / 5
        </span>
      </div>
      <p className="text-xs text-on-surface-variant mb-4">
        把一个 Idea 逐步推演成独特的剧情创意
      </p>
      <div className="flex items-stretch gap-3 overflow-x-auto pb-2">
        <div
          data-testid="idea-cell"
          className="min-w-[100px] border-2 border-primary rounded-lg p-3 bg-surface-container flex flex-col items-center justify-center"
        >
          <div className="text-xs text-on-surface-variant">IDEA</div>
          <div className="text-sm font-medium line-clamp-2">{rootIdea}</div>
        </div>
        {path.map((s, i) => (
          <div key={s.step} className="flex items-center">
            <div
              data-testid={`step-cell-${s.step}`}
              data-step-state={s.state}
              className={`min-w-[80px] border-2 rounded-lg p-3 flex flex-col items-center ${
                s.state === "completed"
                  ? "border-primary bg-primary/10"
                  : s.state === "active"
                  ? "border-primary bg-surface-container animate-pulse"
                  : s.state === "available"
                  ? "border-outline-variant bg-surface-container"
                  : s.state === "stale"
                  ? "border-error bg-error/10"
                  : "border-outline bg-surface-container-low opacity-50"
              }`}
            >
              <div className="text-xs text-on-surface-variant">STEP {s.step}</div>
              <div className="text-xl my-1">{STATE_LABELS[s.state]}</div>
              <div className="text-[10px] text-on-surface-variant">{s.state}</div>
            </div>
            {i < path.length - 1 && (
              <div className="w-3 h-0.5 bg-outline-variant" />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
