/** Typed wrapper around the browser-native EventSource for the
 * AutopilotSession event stream.
 *
 * NOTE: EventSource does not allow setting the Last-Event-ID header
 * manually — browsers send it automatically on reconnect when the server
 * set `id:` lines. We surface an `onError` so callers can decide whether to
 * manually re-open (the hook in useAutopilotSession.ts implements
 * exponential backoff and re-opens).
 */
export interface AutopilotEvent {
  event: string;
  data: unknown;
  id?: number;
}

export interface SSEHandle {
  close: () => void;
}

export interface SSEHandlers {
  onEvent: (ev: AutopilotEvent) => void;
  onOpen?: () => void;
  onError?: () => void;
}

const TYPED_EVENTS = [
  "snapshot",
  "session_start",
  "task_start",
  "task_complete",
  "task_fail",
  "decision",
  "circuit_open",
  "circuit_close",
  "queue_add",
  "queue_remove",
];

export function connectAutopilotSSE(
  projectId: string,
  handlers: SSEHandlers,
): SSEHandle {
  const url = `/api/v1/projects/${encodeURIComponent(projectId)}/autopilot/session/events`;
  const source = new EventSource(url);

  source.addEventListener("open", () => handlers.onOpen?.());
  source.addEventListener("error", () => handlers.onError?.());

  for (const ev of TYPED_EVENTS) {
    source.addEventListener(ev, (raw) => {
      const me = raw as MessageEvent;
      let data: unknown = me.data;
      try {
        data = JSON.parse(me.data);
      } catch {
        // not JSON — leave as string
      }
      let id: number | undefined;
      if (me.lastEventId) {
        const n = Number(me.lastEventId);
        if (Number.isFinite(n)) id = n;
      }
      handlers.onEvent({ event: ev, data, id });
    });
  }

  return {
    close() {
      source.close();
    },
  };
}

/* -------------------------------------------------------------------------- */
/* REST wrappers — used by the start/stop/pause/resume mutation hooks.        */
/* -------------------------------------------------------------------------- */

import api from "./client";
import type { ManagedStartConfig } from "../components/workspace/ManagedStartModal";

export interface AutopilotSession {
  project_id: string;
  state: "stopped" | "running" | "paused";
  current_task: {
    description: string;
    kind?: string;
    chapter?: number;
    chapter_number?: number;
    scene_id?: string | null;
    progress_pct?: number;
    started_at?: string | null;
  } | null;
  queue: Array<{
    id: string;
    kind?: string;
    chapter_number?: number;
    description: string;
    priority?: number;
    payload?: { scene_number?: number };
  }>;
  history: unknown[];
  config: ManagedStartConfig | null;
  /** Short tag like "outline_exhausted" set when the runner stops the session
   * via mgr.stop(reason=...). Only meaningful when state === "stopped". */
  stop_reason?: string | null;
  /** Short tag set when the runner pauses the session via mgr.pause(reason=...),
   * e.g. "scene_write_failed:write-5-2:peer closed connection". Only meaningful
   * when state === "paused"; cleared on resume(). The cockpit surfaces this as
   * a banner with retry/continue/stop actions. */
  pause_reason?: string | null;
  /** Set on /session/start responses when seed_queue found zero work to do
   * (every chapter already complete). Frontend uses this to surface a
   * "project all done" toast instead of leaving the user staring at a
   * session that flipped running→stopped in ~50ms. */
  no_work_to_do?: boolean;
  /** Outline's maximum chapter_number. Sent alongside no_work_to_do so the
   * UI can render "项目已全部写完 (共 N 章)". */
  outline_max?: number;
  /** current_chapter from progress.json at the time seed_queue returned 0. */
  current_chapter?: number;
  /** Scope the user originally requested (e.g. "next_chapter"). */
  requested_scope?: "all_planned" | "next_chapter";
  /** Scope that actually produced the (empty) queue — may differ from
   * requested_scope when seed_queue auto-widened next_chapter → all_planned.
   * Used to render an honest message distinguishing "your scope was too
   * narrow" from "the project really is finished". */
  scope_used?: "all_planned" | "next_chapter";
  /** True when seed_queue widened the scope because next_chapter yielded
   * zero but later chapters had unfinished scenes (proj_cc4ca4ae 2026-07-17). */
  fallback_applied?: boolean;
  /** Chapter numbers that repair_stuck_chapters flipped from
   * in_progress → completed before seeding (mid-run crashes that left
   * chapters half-finalized). UI surfaces these so users see what was
   * auto-recovered. */
  repaired_chapters?: number[];
  /** Server-provided human message. When present, prefer this over a
   * client-side template — it now distinguishes the fallback case from
   * the all-done case. */
  message?: string;
}

export async function getAutopilotSession(projectId: string): Promise<AutopilotSession> {
  return api.getAutopilotSession(projectId) as Promise<AutopilotSession>;
}

export async function startAutopilotSession(
  projectId: string,
  config: ManagedStartConfig,
): Promise<AutopilotSession> {
  return api.startAutopilotSession(projectId, config as unknown as Record<string, unknown>) as Promise<AutopilotSession>;
}

export async function stopAutopilotSession(projectId: string): Promise<unknown> {
  return api.stopAutopilotSession(projectId);
}

export async function pauseAutopilotSession(projectId: string): Promise<unknown> {
  return api.pauseAutopilotSession(projectId);
}

export async function resumeAutopilotSession(projectId: string): Promise<unknown> {
  return api.resumeAutopilotSession(projectId);
}

export async function interveneAutopilotSession(projectId: string, action: string): Promise<unknown> {
  return api.interveneAutopilotSession(projectId, action);
}

export async function getAutopilotHistory(projectId: string, cursor?: string): Promise<unknown> {
  return api.getAutopilotHistory(projectId, cursor);
}

export interface ManagedRangePreview {
  outline_max: number;
  valid: boolean;
  error: string | null;
  regenerate_chapters: number[];
  defaults: { start_chapter: number; end_chapter: number } | null;
}

export async function rangePreview(
  projectId: string,
  start: number,
  end: number,
  scope?: "all_planned" | "range",
): Promise<ManagedRangePreview> {
  return api.rangePreview(projectId, start, end, scope) as Promise<ManagedRangePreview>;
}

/* -------------------------------------------------------------------------- */
/* Chapter stream — v1.10 Direction B (real-time writing stream)              */
/* -------------------------------------------------------------------------- */

export type ChapterStreamSceneStart = {
  event: "scene_start";
  data: { chapter_number: number; scene_number: number };
};

export type ChapterStreamChunk = {
  event: "scene_chunk";
  data: {
    seq: number;
    chapter_number: number;
    scene_number: number;
    text: string;
  };
};

export type ChapterStreamDone = {
  event: "scene_done";
  data: {
    chapter_number: number;
    scene_number: number;
    status: string;
    total_chars: number;
  };
};

export type ChapterStreamFailed = {
  event: "scene_failed";
  data: {
    chapter_number: number;
    scene_number: number;
    error: string;
    partial_text: string;
  };
};

export type ChapterStreamIdle = {
  event: "idle";
  data: { reason: string };
};

export type ChapterStreamSceneTransition = {
  event: "scene_transition";
  data: { reason: string; chapter_number: number | null };
};

export type ChapterStreamEvent =
  | ChapterStreamSceneStart
  | ChapterStreamChunk
  | ChapterStreamDone
  | ChapterStreamFailed
  | ChapterStreamIdle
  | ChapterStreamSceneTransition;

const CHAPTER_STREAM_EVENTS = [
  "scene_start",
  "scene_chunk",
  "scene_done",
  "scene_failed",
  "idle",
  "scene_transition",
] as const;

/**
 * Open an EventSource for /api/v1/projects/{id}/autopilot/chapter-stream.
 *
 * Reconnect补发 is browser-managed: when the server sets an `id:` field on
 * scene_chunk SSE messages, the browser stores it and re-sends it as the
 * `Last-Event-ID` HTTP header on every automatic reconnect. The server
 * reads that header and replays the missing chunks from SceneChunkStore.
 *
 * Do NOT expose a `?since_seq=` URL parameter — it would conflict with
 * the header mechanism and split reconnect behavior across two channels.
 */
export interface ChapterStreamHandlers {
  onEvent: (ev: ChapterStreamEvent) => void;
  onError?: () => void;
}

export function connectChapterStreamSSE(
  projectId: string,
  handlers: ChapterStreamHandlers,
): SSEHandle {
  const url = `/api/v1/projects/${encodeURIComponent(projectId)}/autopilot/chapter-stream`;
  const source = new EventSource(url);

  for (const ev of CHAPTER_STREAM_EVENTS) {
    source.addEventListener(ev, (raw) => {
      const me = raw as MessageEvent;
      let data: unknown = me.data;
      try {
        data = JSON.parse(me.data as string);
      } catch {
        // not JSON — leave as string
      }
      handlers.onEvent({ event: ev, data } as ChapterStreamEvent);
    });
  }

  source.addEventListener("error", () => handlers.onError?.());

  return {
    close() {
      source.close();
    },
  };
}