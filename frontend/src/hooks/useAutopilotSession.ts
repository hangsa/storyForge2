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
    },
    [projectId],
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