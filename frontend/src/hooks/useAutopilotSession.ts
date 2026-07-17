import { useEffect, useRef, useState, useCallback } from "react";
import {
  AutopilotEvent,
  AutopilotSession,
  ManagedStartConfig,
  connectAutopilotSSE,
  getAutopilotSession,
  startAutopilotSession,
  stopAutopilotSession,
  pauseAutopilotSession,
  resumeAutopilotSession,
} from "../api/autopilot";
import { useToast } from "./useToast";

export type SSEStatus = "connecting" | "connected" | "reconnecting" | "error";

interface UseAutopilotSessionReturn {
  session: AutopilotSession | null;
  events: AutopilotEvent[];
  status: SSEStatus;
  start: (config: ManagedStartConfig) => Promise<void>;
  stop: () => Promise<void>;
  pause: () => Promise<void>;
  resume: () => Promise<void>;
  refresh: () => Promise<void>;
}

const BACKOFF_DELAYS_MS = [1000, 2000, 4000, 8000, 16000, 30000];

export function useAutopilotSession(
  projectId: string,
): UseAutopilotSessionReturn {
  const [session, setSession] = useState<AutopilotSession | null>(null);
  const [events, setEvents] = useState<AutopilotEvent[]>([]);
  const [status, setStatus] = useState<SSEStatus>("connecting");
  const reconnectAttempts = useRef(0);
  const handleRef = useRef<{ close: () => void } | null>(null);
  const cancelledRef = useRef(false);
  const { show: showToast } = useToast();

  const refresh = useCallback(async () => {
    const s = await getAutopilotSession(projectId);
    if (!cancelledRef.current) setSession(s);
  }, [projectId]);

  const open = useCallback(() => {
    if (cancelledRef.current) return;
    setStatus(reconnectAttempts.current > 0 ? "reconnecting" : "connecting");
    const handle = connectAutopilotSSE(projectId, {
      onEvent: (ev) => {
        // Snapshot events replace session state; non-snapshot events append
        setEvents((prev) => [...prev, ev].slice(-256));
        if (ev.event === "snapshot" && ev.data && typeof ev.data === "object") {
          setSession(ev.data as AutopilotSession);
        }
        setStatus("connected");
        reconnectAttempts.current = 0;
      },
      onOpen: () => setStatus("connected"),
      onError: () => {
        handle.close();
        reconnectAttempts.current += 1;
        if (reconnectAttempts.current >= BACKOFF_DELAYS_MS.length) {
          // Exhausted backoff retries — give up; consumers can call refresh()
          // to manually retry.
          setStatus("error");
          return;
        }
        const delay = BACKOFF_DELAYS_MS[reconnectAttempts.current - 1];
        setStatus("reconnecting");
        setTimeout(() => {
          if (!cancelledRef.current) open();
        }, delay);
      },
    });
    handleRef.current = handle;
  }, [projectId]);

  useEffect(() => {
    cancelledRef.current = false;
    refresh();
    open();
    return () => {
      cancelledRef.current = true;
      handleRef.current?.close();
    };
  }, [refresh, open]);

  const start = useCallback(
    async (config: ManagedStartConfig) => {
      const next = await startAutopilotSession(projectId, config);
      setSession(next);
      // Backend sets `no_work_to_do: true` on the response when seed_queue
      // found zero scenes to enqueue (every chapter already complete). The
      // cockpit's "启动托管" button calls this hook directly (bypassing the
      // ManagedStartModal) so the no-work check has to live here, not just
      // in the modal — otherwise the user sees a running→stopped flash with
      // no explanation. The modal reads the same field for parity.
      //
      // 2026-07-17 fix (proj_cc4ca4ae): prefer the server's `message` field
      // when present — it now distinguishes "all done" from "scope was
      // widened but still nothing left" (the latter used to masquerade as
      // "项目已全部写完（共 33 章）" which was misleading). Falls back to the
      // old client-side template if the server didn't include a message.
      const detail = next as {
        no_work_to_do?: boolean;
        outline_max?: number;
        fallback_applied?: boolean;
        repaired_chapters?: number[];
        message?: string;
      } | null;
      if (detail?.no_work_to_do) {
        const lines: string[] = [];
        if (detail.message) {
          lines.push(detail.message);
        } else {
          lines.push(`项目已全部写完（共 ${detail.outline_max ?? 0} 章），无新任务可推进。`);
        }
        if (detail.repaired_chapters && detail.repaired_chapters.length > 0) {
          lines.push(
            `已自动修复 ${detail.repaired_chapters.length} 个卡死章节：${detail.repaired_chapters.join(", ")}`,
          );
        }
        showToast(lines.join("\n"));
      }
    },
    [projectId, showToast],
  );

  const stop = useCallback(async () => {
    await stopAutopilotSession(projectId);
    await refresh();
  }, [projectId, refresh]);

  const pause = useCallback(async () => {
    await pauseAutopilotSession(projectId);
    await refresh();
  }, [projectId, refresh]);

  const resume = useCallback(async () => {
    await resumeAutopilotSession(projectId);
    await refresh();
  }, [projectId, refresh]);

  return { session, events, status, start, stop, pause, resume, refresh };
}