import { useState, useEffect, useCallback } from "react";
import { listPlazaPrompts, type PromptSummary } from "../api/promptPlaza";

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