import { useState, useCallback } from "react";
import api, { ApiError, ExemptionRequest, ExemptionAntipattern } from "../api/client";
import { EXEMPTION_STATUS } from "../types/stage4";

export interface UseStage4ExemptionsReturn {
  items: ExemptionRequest[];
  loading: boolean;
  error: string | null;
  approve: (id: string, approvedBy: string) => Promise<void>;
  reject: (id: string, reason: string) => Promise<void>;
  refresh: () => Promise<void>;
  getAntipatterns: (id: string) => Promise<ExemptionAntipattern[]>;
}

export function useStage4Exemptions(projectId: string): UseStage4ExemptionsReturn {
  const [items, setItems] = useState<ExemptionRequest[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await api.listExemptions(projectId, EXEMPTION_STATUS.PENDING);
      setItems(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  const approve = useCallback(async (id: string, approvedBy: string) => {
    await api.approveExemption(projectId, id, approvedBy);
    await refresh();
  }, [projectId, refresh]);

  const reject = useCallback(async (id: string, reason: string) => {
    await api.rejectExemption(projectId, id, reason);
    await refresh();
  }, [projectId, refresh]);

  const getAntipatterns = useCallback(async (id: string): Promise<ExemptionAntipattern[]> => {
    try {
      return await api.getExemptionAntipatterns(projectId, id);
    } catch {
      return [];
    }
  }, [projectId]);

  return { items, loading, error, approve, reject, refresh, getAntipatterns };
}
