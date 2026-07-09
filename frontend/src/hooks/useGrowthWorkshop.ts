import { useCallback, useState } from "react";
import api, { ApiError } from "../api/client";
import type {
  ConsistencyWarning, GrowthStage,
  WorkshopAdjustRequest, WorkshopCheckResult,
  WorkshopDiscussRequest, WorkshopDiscussResponse,
} from "../api/client";

export interface UseGrowthWorkshopReturn {
  checkResult: WorkshopCheckResult | null;
  checkError: string | null;
  checking: boolean;
  check: (characterId: string) => Promise<void>;
  clearCheck: () => void;
  adjust: (characterId: string, stages: GrowthStage[]) => Promise<ConsistencyWarning[]>;
  discuss: (characterId: string, question: string) => Promise<WorkshopDiscussResponse>;
}

export function useGrowthWorkshop(projectId: string): UseGrowthWorkshopReturn {
  const [checkResult, setCheckResult] = useState<WorkshopCheckResult | null>(null);
  const [checkError, setCheckError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  const check = useCallback(async (characterId: string) => {
    setChecking(true);
    setCheckError(null);
    try {
      const r = await api.growthWorkshopCheck(projectId, characterId);
      setCheckResult(r);
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : (e as Error).message;
      setCheckError(msg);
      setCheckResult(null);
    } finally {
      setChecking(false);
    }
  }, [projectId]);

  const clearCheck = useCallback(() => {
    setCheckResult(null);
    setCheckError(null);
  }, []);

  const adjust = useCallback(async (characterId: string, stages: GrowthStage[]) => {
    const req: WorkshopAdjustRequest = { stages };
    const r = await api.growthWorkshopAdjust(projectId, characterId, req);
    return r.warnings;
  }, [projectId]);

  const discuss = useCallback(async (characterId: string, question: string) => {
    const req: WorkshopDiscussRequest = { question };
    return await api.growthWorkshopDiscuss(projectId, characterId, req);
  }, [projectId]);

  return {
    checkResult, checkError, checking,
    check, clearCheck, adjust, discuss,
  };
}