import type { ProjectSummary } from "../../api/client";
import { useGenres } from "../../hooks/useGenres";
import { STAGE_COLORS, STAGE_LABELS } from "./stages";

export interface ProjectTableRowProps {
  project: ProjectSummary;
  selected?: boolean;
  onClick?: () => void;
  onSelectChange?: (selected: boolean) => void;
}

function formatWordCount(n: number): string {
  if (n >= 10000) return `${(n / 10000).toFixed(1)}w`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

function formatDate(unixSeconds: number | string): string {
  const ts = typeof unixSeconds === "string" ? Date.parse(unixSeconds) / 1000 : unixSeconds;
  const d = new Date(ts * 1000);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export default function ProjectTableRow({
  project,
  selected = false,
  onClick,
  onSelectChange,
}: ProjectTableRowProps) {
  const genres = useGenres(false);
  const genreLabel = genres.find((g) => g.id === project.genre)?.label_zh ?? project.genre;
  const stage = project.current_stage;
  const chipClass = STAGE_COLORS[stage] ?? STAGE_COLORS.INIT;
  const stageLabel = STAGE_LABELS[stage] ?? stage;

  const selectedClass = selected ? "border-l-4 border-primary" : "border-l-4 border-transparent";

  return (
    <div
      role="row"
      onClick={onClick}
      className={`grid grid-cols-[40px_2fr_1fr_1fr_1fr_1fr_1fr_1fr] items-center px-3 py-2 border-b border-outline-variant hover:bg-surface-container-low cursor-pointer ${selectedClass}`}
    >
      <div className="flex items-center justify-center">
        <input
          type="checkbox"
          checked={selected}
          onChange={(e) => onSelectChange?.(e.target.checked)}
          onClick={(e) => e.stopPropagation()}
          className="w-4 h-4 accent-primary"
          aria-label="select row"
        />
      </div>
      <div className="flex items-center gap-2 min-w-0">
        <span className="material-symbols-outlined text-primary-container shrink-0" aria-hidden="true">
          auto_stories
        </span>
        <span className="font-display text-on-surface truncate">{project.title}</span>
      </div>
      <div className="text-center font-mono text-label-sm text-on-surface-variant">
        {genreLabel}
      </div>
      <div className="flex justify-center">
        <span className={`text-label-sm px-1.5 py-0.5 rounded font-mono ${chipClass}`}>
          {stageLabel}
        </span>
      </div>
      <div className="text-center font-mono text-label-sm text-on-surface">{project.chapter_count}</div>
      <div className="text-center font-mono text-label-sm text-on-surface">
        {formatWordCount(project.word_count)}
      </div>
      <div className="text-center font-mono text-label-sm text-on-surface-variant">
        {project.target_length_category}
      </div>
      <div className="text-right font-mono text-label-sm text-on-surface-variant">
        {formatDate(project.updated_at)}
      </div>
    </div>
  );
}
