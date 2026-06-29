import { useState, useCallback } from "react";
import api, { ApiError } from "../api/client";

export interface ImpactReport {
  items: Array<{ priority: "P0" | "P1" | "P2"; file: string; description: string }>;
  // Other fields exist; the drawer only reads `items` for badge counts.
  [key: string]: unknown;
}

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
      setReport(r as ImpactReport);
    } catch (e) {
      setError(e instanceof ApiError || e instanceof Error ? e.message : "分析失败");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  const clear = useCallback(() => setReport(null), []);
  return { report, loading, error, run, clear };
}
