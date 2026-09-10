import type { DimensionKind } from "@/api/types";

interface Props {
  active: DimensionKind;
  onChange: (kind: DimensionKind) => void;
  counts: Record<DimensionKind, { active: number; total: number }>;
}

const LABELS: Record<DimensionKind, string> = {
  subject: "题材",
  tone: "基调",
  style: "风格",
};

export default function DimensionTabs({ active, onChange, counts }: Props) {
  return (
    <nav className="flex flex-col gap-1" data-testid="dimension-tabs">
      {(Object.keys(LABELS) as DimensionKind[]).map((kind) => {
        const c = counts[kind];
        return (
          <button
            key={kind}
            type="button"
            onClick={() => onChange(kind)}
            className={`text-left px-3 py-2 rounded-lg text-sm font-display ${
              active === kind
                ? "bg-primary-container text-on-primary-container"
                : "text-primary hover:bg-surface-container-high"
            }`}
            data-testid={`tab-${kind}`}
          >
            <span>{LABELS[kind]}</span>
            <span className="ml-2 font-mono text-xs text-on-surface-variant">
              {c.active}/{c.total}
            </span>
          </button>
        );
      })}
    </nav>
  );
}
