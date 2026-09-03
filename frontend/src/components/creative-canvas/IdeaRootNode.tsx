interface Props {
  prompt: string;
}

export function IdeaRootNode({ prompt }: Props) {
  const shortLabel = prompt.length > 8 ? prompt.slice(0, 8) + "…" : prompt;
  return (
    <div
      data-testid="idea-root-node"
      className="relative z-10 flex flex-col items-center bg-surface p-2 rounded-lg"
    >
      <div className="w-12 h-12 rounded-full bg-surface-container border-2 border-primary flex items-center justify-center mb-sm">
        <span className="material-symbols-outlined text-primary text-sm">flag</span>
      </div>
      <span className="font-label-sm text-label-sm text-on-surface text-center">
        原始想法
      </span>
      <span
        className="text-xs text-on-surface-variant text-center max-w-[100px] truncate"
        title={prompt}
      >
        {shortLabel}
      </span>
    </div>
  );
}
