interface ConceptScores {
  novelty: number;
  conflict: number;
  story_potential: number;
  uniqueness: number;
}

interface Props {
  scores: ConceptScores;
  /**
   * When true (wizard-embedded mode), omit the panel chrome (border /
   * background) so the bar blends into the wizard main area. The page
   * already supplies the wizard's outer chrome.
   */
  embedded?: boolean;
}

// PRD §16.1 lists the 4 quality dimensions surfaced to the user. The
// value-to-color mapping matches the existing QualityBar palette
// (primary = novelty, error = conflict) so users see consistent
// semantics between the OptionCard scores and the top-level concept
// scores.
const DIMENSIONS: Array<{
  key: keyof ConceptScores;
  label: string;
  color: string;
}> = [
  { key: "novelty", label: "新颖度", color: "bg-primary" },
  { key: "conflict", label: "冲突强度", color: "bg-error" },
  { key: "story_potential", label: "故事潜力", color: "bg-secondary" },
  { key: "uniqueness", label: "独特性", color: "bg-tertiary" },
];

const toPct = (v: number) => Math.min(100, Math.max(0, Math.round(v * 100)));

export function ScoresBar({ scores, embedded = false }: Props) {
  // PRD §16.3: backend currently populates novelty + conflict only
  // (see _refresh_top_level_scores:725-728). story_potential +
  // uniqueness are 0.0 until the LLM-driven scoring task lands. Show
  // an em-dash placeholder for those two so users can distinguish
  // "not yet computed" from a real 0% rather than being misled by a
  // rendered 0.
  const isPending = (v: number) => v <= 0;

  return (
    <div
      data-testid="scores-bar"
      className={`flex items-center gap-4 px-4 py-2 ${
        embedded ? "" : "border border-outline-variant rounded-lg bg-surface-container"
      }`}
    >
      <span className="font-label-sm text-label-sm text-on-surface-variant uppercase tracking-wider shrink-0">
        创意质量
      </span>
      <div className="flex flex-1 gap-4">
        {DIMENSIONS.map((dim) => {
          const value = scores[dim.key];
          const pending = isPending(value);
          const pct = pending ? 0 : toPct(value);
          return (
            <div
              key={dim.key}
              data-testid={`score-${dim.key}`}
              data-pending={pending}
              className="flex flex-col gap-1 min-w-0 flex-1"
            >
              <div className="flex justify-between items-baseline gap-2">
                <span className="text-xs text-on-surface-variant truncate">
                  {dim.label}
                </span>
                <span
                  className={`font-label-sm text-label-sm tabular-nums ${
                    pending ? "text-on-surface-variant/40" : "text-on-surface"
                  }`}
                >
                  {pending ? "—" : `${pct}%`}
                </span>
              </div>
              <div className="h-1 bg-surface-variant rounded-full overflow-hidden">
                <div
                  className={`h-full ${dim.color} transition-all`}
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}