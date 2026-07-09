import { useState, useCallback } from "react";
import api, { ApiError, ImpactReport } from "../api/client";

// Re-export so consumers can keep importing ImpactReport from the hook.
export type { ImpactReport } from "../api/client";

export interface UseStage4ImpactReturn {
  report: ImpactReport | null;
  loading: boolean;
  error: string | null;
  run: () => Promise<void>;
  clear: () => void;
}

export function useStage4Impact(projectId: string): UseStage4ImpactReturn {
  const [report, setReport] = useState<ImpactReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await api.analyzeImpact(projectId);
      setReport(r);
    } catch (e) {
      setError(e instanceof ApiError || e instanceof Error ? e.message : "分析失败");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  const clear = useCallback(() => setReport(null), []);
  return { report, loading, error, run, clear };
}
