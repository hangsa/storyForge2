import { useEffect, useRef, useState } from "react";
import {
  connectChapterStreamSSE,
  ChapterStreamEvent,
  SSEHandle,
} from "../api/autopilot";

export interface ChapterStreamState {
  /** All accumulated scene text, in order. Preserved across reconnects. */
  text: string;
  /** Highest seq we've accepted for the current scene. */
  lastSeq: number;
  /** True while actively streaming. */
  active: boolean;
  /** True if writer failed; partial_text may be present. */
  failed: boolean;
  /** Error message if failed. */
  error: string | null;
  /** Total characters accumulated (resets per scene). */
  charCount: number;
  /** Current chapter/scene, or null if never received scene_start. */
  current: { chapter: number; scene: number } | null;
}

const INITIAL_STATE: ChapterStreamState = {
  text: "",
  lastSeq: 0,
  active: false,
  failed: false,
  error: null,
  charCount: 0,
  current: null,
};

const RECONNECT_DELAY_MS = 2000;

export function useChapterStream(projectId: string): ChapterStreamState {
  const [state, setState] = useState<ChapterStreamState>(INITIAL_STATE);
  const handleRef = useRef<SSEHandle | null>(null);
  const cancelledRef = useRef(false);
  // Refs for cross-render state — closure-stable for async callbacks
  const lastSeqRef = useRef(0);
  const currentSceneRef = useRef<{ chapter: number; scene: number } | null>(null);
  // Reconnect dedup — only one pending timer at a time
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    cancelledRef.current = false;

    const scheduleReopen = (immediate = false) => {
      handleRef.current?.close();
      // On logical end-of-scene, reopen immediately so the hook can pick up
      // the next scene_start without waiting for a hypothetical network error.
      if (immediate) {
        if (cancelledRef.current) return;
        open();
        return;
      }
      // Reconnect dedup — only one pending timer at a time
      if (reconnectTimerRef.current !== null) return;
      reconnectTimerRef.current = setTimeout(() => {
        reconnectTimerRef.current = null;
        if (cancelledRef.current) return;
        open();
      }, RECONNECT_DELAY_MS);
    };

    const open = () => {
      if (cancelledRef.current) return;
      handleRef.current = connectChapterStreamSSE(projectId, {
        onEvent: (ev) => {
          if (ev.event === "scene_start") {
            // New scene: hard reset; don't trust buffered text from prior scene
            lastSeqRef.current = 0;
            currentSceneRef.current = {
              chapter: ev.data.chapter_number,
              scene: ev.data.scene_number,
            };
            setState({
              ...INITIAL_STATE,
              active: true,
              current: currentSceneRef.current,
            });
          } else if (ev.event === "scene_chunk") {
            let cur = currentSceneRef.current;
            // Lazy init on first chunk — covers the SceneChunkStore replay
            // path (backend emits chunks before scene_start when a browser
            // connects mid-stream). SceneChunkStore is constructed only for
            // the active chapter/scene, so any chunk we see here is for
            // the live scene.
            if (!cur) {
              cur = {
                chapter: ev.data.chapter_number,
                scene: ev.data.scene_number,
              };
              currentSceneRef.current = cur;
              setState((prev) => ({
                ...INITIAL_STATE,
                active: true,
                current: cur,
              }));
            } else if (
              ev.data.chapter_number !== cur.chapter ||
              ev.data.scene_number !== cur.scene
            ) {
              // Stale-chunk guard: ch/scene must match current scene
              return;
            }
            // Dedup: same seq we've already seen (reconnect case)
            if (ev.data.seq <= lastSeqRef.current) return;
            lastSeqRef.current = ev.data.seq;
            setState((prev) => ({
              ...prev,
              text: prev.text + ev.data.text,
              lastSeq: lastSeqRef.current,
              charCount: prev.charCount + ev.data.text.length,
              active: true,
              current: cur,
            }));
          } else if (ev.event === "scene_done") {
            setState((prev) => ({ ...prev, active: false }));
            scheduleReopen(true);
          } else if (ev.event === "scene_failed") {
            // partial_text dedup: if we already have chunks, ignore partial_text
            setState((prev) => ({
              ...prev,
              active: false,
              failed: true,
              error: ev.data.error,
              text: prev.text || (ev.data.partial_text ?? ""),
            }));
            scheduleReopen(true);
          } else if (ev.event === "scene_transition") {
            // Runner is between scenes (or doing archival). The backend
            // keeps the SSE stream open so the next scene_start flows
            // through on the SAME connection. Clear text + refs so the
            // cockpit visually transitions to "next scene in progress"
            // instead of stuck on the previous scene's text.
            lastSeqRef.current = 0;
            currentSceneRef.current = null;
            setState({
              ...INITIAL_STATE,
              active: false,
            });
          } else if (ev.event === "idle") {
            setState((prev) => ({ ...prev, active: false }));
          }
        },
        onError: () => {
          scheduleReopen();
        },
      });
    };

    open();
    return () => {
      cancelledRef.current = true;
      if (reconnectTimerRef.current !== null) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      handleRef.current?.close();
    };
  }, [projectId]);

  return state;
}