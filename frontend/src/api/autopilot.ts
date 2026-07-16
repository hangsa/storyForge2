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