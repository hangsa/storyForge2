/**
 * Length categories — single source of truth shared between
 * CreateProjectModal (writer-facing picker when starting a project)
 * and BookShelf (read-side filter).
 *
 * The `label` is what gets written into `project.target_length_category`
 * and what shows in the project row + dropdown. Keep these in sync with
 * any change to `CreateProjectModal` or `backend/api/project.py`'s
 * default.
 *
 * Per-chapter target is uniform across all options — see CLAUDE.md.
 * Total word count is what differentiates the three.
 */
export interface LengthCategory {
  value: number;
  label: string;
  totalLabel: string;
}

export const LENGTH_CATEGORIES: readonly LengthCategory[] = [
  { value: 300_000, label: "短篇快穿", totalLabel: "约30万字" },
  { value: 1_000_000, label: "标准商业连载", totalLabel: "约100万字" },
  { value: 3_000_000, label: "宏大史诗巨著", totalLabel: "约300万字" },
];

export const DEFAULT_LENGTH_INDEX = 1;
