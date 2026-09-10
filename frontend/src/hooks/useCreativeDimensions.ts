import { useCallback, useEffect, useState } from "react";
import api from "../api/client";
import type { ActiveDimensions, DimensionEntry } from "../api/types";

const EMPTY: ActiveDimensions = { subject: [], tone: [], style: [] };

let cache: ActiveDimensions | null = null;
let inflight: Promise<ActiveDimensions> | null = null;

export function useCreativeDimensions() {
  const [data, setData] = useState<ActiveDimensions>(cache ?? EMPTY);
  const [loading, setLoading] = useState(!cache);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (cache) {
      setData(cache);
      setLoading(false);
      return;
    }
    if (!inflight) {
      inflight = api.listActiveCreativeDimensions().then((d) => {
        cache = d;
        return d;
      });
    }
    inflight
      .then((d) => setData(d))
      .catch((e) => setError(e instanceof Error ? e.message : "unknown"))
      .finally(() => {
        setLoading(false);
        inflight = null;
      });
  }, []);

  const refresh = useCallback(async () => {
    cache = null;
    inflight = api.listActiveCreativeDimensions().then((d) => {
      cache = d;
      return d;
    });
    setLoading(true);
    try {
      const fresh = await inflight;
      setData(fresh);
    } catch (e) {
      setError(e instanceof Error ? e.message : "unknown");
    } finally {
      setLoading(false);
      inflight = null;
    }
  }, []);

  return { ...data, loading, error, refresh };
}

// 仅供测试用：重置模块缓存
export function __resetCacheForTests() {
  cache = null;
  inflight = null;
}
