import { useState, useCallback } from "react";
import api, { AdvanceResponse, ApiError } from "../api/client";

interface UseConductorReturn {
  currentStage: string;
  loading: boolean;
  error: string | null;
  advance: (projectId: string) => Promise<AdvanceResponse | null>;
  setCurrentStage: (stage: string) => void;
  clearError: () => void;
}

export function useConductor(): UseConductorReturn {
  const [currentStage, setCurrentStage] = useState("INIT");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const advance = useCallback(
    async (projectId: string): Promise<AdvanceResponse | null> => {
      setLoading(true);
      setError(null);
      try {
        const result = await api.advance(projectId);
        setCurrentStage(result.current_stage);
        return result;
      } catch (e) {
        const msg = e instanceof ApiError ? e.message : "阶段推进失败";
        setError(msg);
        return null;
      } finally {
        setLoading(false);
      }
    },
    []
  );

  const clearError = useCallback(() => setError(null), []);

  return {
    currentStage,
    loading,
    error,
    advance,
    setCurrentStage,
    clearError,
  };
}
