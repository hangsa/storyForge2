import type { NovelOutline } from "../api/client";

/** "1-30", "1 - 60", "1-5" — strict; whitespace tolerated.
 *  Mirrors backend/api/stage4_writing.py:647-681. */
export const CHAPTER_RANGE_RE = /^\s*(\d+)\s*-\s*(\d+)\s*$/;

/** Returns max end across valid volume chapter_range strings; 0 when
 *  the file is missing or unparseable. Used as the cap on how many
 *  chapters "+ 新章节" can append (workspace), and as a sanity cap on
 *  the wizard's default chapter-outline scope (v2.1). */
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

/** Returns the end of volumes[0].chapter_range (i.e. the chapter count in
 *  Volume 1, the first volume the user works through). 0 if Volume 1 is
 *  missing or its range is unparseable. The init wizard's chapter-outline
 *  auto-generation defaults to this count: the user typically writes one
 *  volume at a time and progresses through later volumes via subsequent
 *  runs from the workspace cockpit (v2.1). */
export function computeFirstVolumeEnd(novelOutline: NovelOutline | null): number {
  if (!novelOutline?.volumes?.length) return 0;
  const first = novelOutline.volumes[0];
  const m = CHAPTER_RANGE_RE.exec(first?.chapter_range ?? "");
  if (!m) return 0;
  const start = +m[1], end = +m[2];
  if (start < 1 || end < start) return 0;
  return end;
}

export interface WorkspaceSceneNode {
  scene_id: string;
  title: string;
  goal?: string;
  conflict?: string;
  emotional_arc?: string;
  narrative_role?: string;
  beat_type?: string;
}

export interface WorkspaceChapterNode {
  chapter_number: number;
  title: string;
  theme?: string;
  scenes: WorkspaceSceneNode[];
}

export interface WorkspaceVolumeGroup {
  name: string;
  chapter_range: string;
  summary?: string;
  chapters: WorkspaceChapterNode[];
}

export interface ParsedVolume {
  name: string;
  chapter_range: string;
  summary?: string;
  start: number;
  end: number;
}

export function parseVolumes(novelOutline: NovelOutline | null): ParsedVolume[] {
  if (!novelOutline?.volumes?.length) return [];
  const out: ParsedVolume[] = [];
  for (const v of novelOutline.volumes) {
    const m = CHAPTER_RANGE_RE.exec(v.chapter_range ?? "");
    if (!m) continue;
    const start = +m[1];
    const end = +m[2];
    if (start < 1 || end < start) continue;
    out.push({ name: v.name, chapter_range: v.chapter_range, summary: v.summary, start, end });
  }
  return out;
}

export function groupChaptersByVolume(
  chapters: WorkspaceChapterNode[],
  novelOutline: NovelOutline | null,
): WorkspaceVolumeGroup[] {
  const parsed = parseVolumes(novelOutline);
  if (parsed.length === 0) {
    return chapters.length === 0
      ? []
      : [{ name: "未分组", chapter_range: "", summary: undefined, chapters }];
  }
  const buckets: WorkspaceVolumeGroup[] = parsed.map((v) => ({
    name: v.name,
    chapter_range: v.chapter_range,
    summary: v.summary,
    chapters: [],
  }));
  const ungrouped: WorkspaceChapterNode[] = [];
  for (const ch of chapters) {
    const idx = parsed.findIndex((v) => ch.chapter_number >= v.start && ch.chapter_number <= v.end);
    if (idx === -1) {
      ungrouped.push(ch);
    } else {
      buckets[idx].chapters.push(ch);
    }
  }
  if (ungrouped.length > 0) {
    buckets.push({ name: "未分组", chapter_range: "", summary: undefined, chapters: ungrouped });
  }
  return buckets.filter((b) => b.chapters.length > 0 || b.name !== "未分组");
}
