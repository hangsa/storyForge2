// Per-chapter progress status, shared between manual and managed rendering.
// "completed"  — chapter is finished (all scenes written + saved).
// "writing"    — a writer-side agent is currently working on this chapter.
// "planned"    — chapter is on the outline with scenes planned, not started.
// "pending"    — chapter exists in progress.json but has no real outline / scenes yet.
export type ChapterStatus = "completed" | "writing" | "planned" | "pending";