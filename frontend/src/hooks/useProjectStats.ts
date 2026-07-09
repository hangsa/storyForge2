import { useState, useEffect, useCallback } from "react";
import api, { ProjectStats } from "../api/client";

interface UseProjectStatsReturn {
  stats: ProjectStats | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function useProjectStats(): UseProjectStatsReturn {
  const [stats, setStats] = useState<ProjectStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.getProjectStats();
      setStats(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载统计失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { stats, loading, error, refresh };
}