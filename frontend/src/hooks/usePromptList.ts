import { useState, useEffect, useCallback } from "react";
import { listPlazaPrompts, listDefaultPrompts, type PromptSummary } from "../api/promptPlaza";

interface UsePromptListReturn {
  prompts: PromptSummary[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function usePromptList(projectId: string | null): UsePromptListReturn {
  const [prompts, setPrompts] = useState<PromptSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await listPlazaPrompts(projectId);
      setPrompts(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载提示词列表失败");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { prompts, loading, error, refresh };
}

/** Fetches /api/prompts/defaults/list when enabled=true. Used by the home-page
 *  QuickActions entry, which has no project context. */
export function useDefaultPromptList(enabled: boolean = true): UsePromptListReturn {
  const [prompts, setPrompts] = useState<PromptSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    setError(null);
    try {
      const data = await listDefaultPrompts();
      setPrompts(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载提示词列表失败");
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { prompts, loading, error, refresh };
}
