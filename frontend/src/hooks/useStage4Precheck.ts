import { useState, useCallback } from "react";
import type { PrecheckResult } from "../api/client";

export interface UseStage4PrecheckReturn {
  data: PrecheckResult | null;
  loading: boolean;
  error: string | null;
  setData: (data: PrecheckResult) => void;
  clear: () => void;
}

export function useStage4Precheck(): UseStage4PrecheckReturn {
  const [data, setData] = useState<PrecheckResult | null>(null);
  const [loading] = useState(false);  // No async work — populated by Stage4Page from writeScene result.
  const [error] = useState<string | null>(null);
  const clear = useCallback(() => setData(null), []);
  return { data, loading, error, setData, clear };
}
