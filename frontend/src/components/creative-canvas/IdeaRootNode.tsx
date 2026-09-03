interface Props {
  prompt: string;
  /**
   * Genre ID (e.g., "xianxia"). Surfaced as a small badge below the
   * prompt so users see "this is my 仙侠 idea" at a glance after init.
   * Mirrors PRD §11.2's empty-state contract (Idea + 类型). Hidden when
   * empty/undefined to avoid rendering an empty chip.
   */
  genre?: string;
}

// Map of backend genre IDs → user-visible zh labels. Kept short and
// aligned with EmptyState's GENRES list so users don't see a Chinese
// label in the empty form and a raw ID ("xianxia") in the root node.
const GENRE_LABELS: Record<string, string> = {
  xianxia: "仙侠",
  scifi: "科幻",
  urban: "都市",
  mystery: "悬疑",
  history: "历史",
  fantasy: "玄幻",
};

export function IdeaRootNode({ prompt, genre }: Props) {
  const hasPrompt = prompt.trim().length > 0;
  const genreLabel = genre ? GENRE_LABELS[genre] ?? genre : null;

  return (
    <div
      data-testid="idea-root-node"
      className="relative z-10 flex flex-col items-center bg-surface p-3 rounded-lg w-[180px]"
    >
      <div className="w-12 h-12 rounded-full bg-surface-container border-2 border-primary flex items-center justify-center mb-sm shrink-0">
        <span className="material-symbols-outlined text-primary text-sm">flag</span>
      </div>
      <span className="font-label-sm text-label-sm text-on-surface-variant text-center uppercase tracking-wider mb-xs">
        原始想法
      </span>
      <p
        data-testid="idea-root-prompt"
        className="text-sm text-on-surface text-center break-words leading-snug max-h-[120px] overflow-y-auto"
        title={hasPrompt ? prompt : ""}
      >
        {hasPrompt ? prompt : <span className="text-on-surface-variant/60">（暂无内容）</span>}
      </p>
      {genreLabel && (
        <span
          data-testid="idea-root-genre"
          className="mt-sm px-2 py-0.5 rounded-full bg-surface-container text-xs text-primary border border-primary/30"
        >
          {genreLabel}
        </span>
      )}
    </div>
  );
}