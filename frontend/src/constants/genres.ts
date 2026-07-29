/**
 * @deprecated Hardcoded genre list is replaced by useGenres() hook (Phase 3 of
 * genre catalog unification). This file remains as a stub for one release so
 * any unported imports still resolve. Will be deleted in the next release.
 *
 * Use `import { useGenres } from "../hooks/useGenres"` instead.
 */

export interface GenreOption {
  value: string;
  label: string;
}

/** Empty stub — consumers must migrate to useGenres(). */
export const GENRES: ReadonlyArray<GenreOption> = Object.freeze([]);
export const GENRE_LABELS: Readonly<Record<string, string>> = Object.freeze({});
export const GENRE_TEMPLATE_KEYS: ReadonlyArray<string> = Object.freeze([]);