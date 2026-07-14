import type { NovelOutline } from "../api/client";

/** "1-30", "1 - 60", "1-5" — strict; whitespace tolerated.
 *  Mirrors backend/api/stage4_writing.py:647-681. */
export const CHAPTER_RANGE_RE = /^\s*(\d+)\s*-\s*(\d+)\s*$/;

/** Returns max end across valid volume chapter_range strings; 0 when
 *  the file is missing or unparseable. Used as the cap on how many
 *  chapters "+ 新章节" can append, and as the basis for the wizard's
 *  default chapter-outline scope (v1.8.3). */
export function computePlannedTotal(novelOutline: NovelOutline | null): number {
  if (!novelOutline?.volumes?.length) return 0;
  let maxEnd = 0;
  for (const v of novelOutline.volumes) {
    const m = CHAPTER_RANGE_RE.exec(v.chapter_range ?? "");
    if (!m) continue;
    const start = +m[1], end = +m[2];
    if (start < 1 || end < start) continue;
    if (end > maxEnd) maxEnd = end;
  }
  return maxEnd;
}
