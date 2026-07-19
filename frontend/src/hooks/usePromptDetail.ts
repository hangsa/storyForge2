import { useState, useEffect, useCallback } from "react";
import { getPlazaPrompt, type PromptDetail } from "../api/promptPlaza";

interface UsePromptDetailReturn {
  detail: PromptDetail | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function usePromptDetail(projectId: string | null, name: string | null): UsePromptDetailReturn {
  const [detail, setDetail] = useState<PromptDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!projectId || !name) return;
    setLoading(true);
    setError(null);
    try {
      const data = await getPlazaPrompt(projectId, name);
      setDetail(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载提示词详情失败");
    } finally {
      setLoading(false);
    }
  }, [projectId, name]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { detail, loading, error, refresh };
}