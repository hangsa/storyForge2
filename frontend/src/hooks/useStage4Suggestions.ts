import { useState, useCallback, useRef, useEffect } from "react";
import api, { SFLogDiffReport, SFLogSuggestion } from "../api/client";

export interface UseStage4SuggestionsReturn {
  report: SFLogDiffReport | null;
  loading: boolean;
  error: string | null;
  analyze: (original: string, modified: string, charNames: string[]) => Promise<void>;
  apply: (suggestions: SFLogSuggestion[], currentText: string) => Promise<{ updated_text: string }>;
  clear: () => void;
}

export function useStage4Suggestions(projectId: string, sceneId: string): UseStage4SuggestionsReturn {
  const [report, setReport] = useState<SFLogDiffReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  // sceneIdRef tracks the "current" scene for this hook instance — if analyze() resolves
  // after a scene change, we discard the response.
  const sceneIdRef = useRef(sceneId);
  useEffect(() => { sceneIdRef.current = sceneId; }, [sceneId]);

  const clear = useCallback(() => {
    setReport(null);
    setError(null);
  }, []);

  const analyze = useCallback(async (original: string, modified: string, charNames: string[]) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    setError(null);
    try {
      const r = await api.suggestSFLogChanges(projectId, sceneIdRef.current, original, modified);
      // Drop the result if scene changed mid-flight or caller aborted.
      if (controller.signal.aborted) return;
      setReport(r);
    } catch (e) {
      if (controller.signal.aborted) return;
      setError(e instanceof Error ? e.message : "分析失败");
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [projectId]);

  const apply = useCallback(async (suggestions: SFLogSuggestion[], currentText: string) => {
    setLoading(true);
    setError(null);
    try {
      const r = await api.applySFLogSuggestions(projectId, sceneIdRef.current, currentText, suggestions);
      return r;
    } catch (e) {
      setError(e instanceof Error ? e.message : "应用失败");
      throw e;
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  // Abort any in-flight request when the scene changes (stale-response guard)
  // or when the hook unmounts.
  useEffect(() => {
    return () => { abortRef.current?.abort(); };
  }, [sceneId]);

  return { report, loading, error, analyze, apply, clear };
}
