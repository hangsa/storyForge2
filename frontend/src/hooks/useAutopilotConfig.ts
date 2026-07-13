import { useEffect, useState, useCallback } from "react";
import type { ManagedStartConfig } from "../components/workspace/ManagedStartModal";
import {
  getAutopilotSession,
  startAutopilotSession,
} from "../api/autopilot";

export const MANAGED_START_DEFAULTS: ManagedStartConfig = {
  scope: "all_planned",
  cadence: "balanced",
  policy: "auto",
  notify: "milestones",
};

const FALLBACK = MANAGED_START_DEFAULTS;

export function useAutopilotConfig(projectId: string) {
  const [config, setConfig] = useState<ManagedStartConfig>(FALLBACK);
  const [loaded, setLoaded] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [loadError, setLoadError] = useState<Error | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoadError(null);
    getAutopilotSession(projectId)
      .then((s) => {
        if (cancelled) return;
        if (s?.config) setConfig(s.config);
        setLoaded(true);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setLoadError(err instanceof Error ? err : new Error(String(err)));
        setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const submit = useCallback(async () => {
    setSubmitting(true);
    try {
      await startAutopilotSession(projectId, config);
    } finally {
      setSubmitting(false);
    }
  }, [projectId, config]);

  return {
    config,
    setConfig,
    loaded,
    submitting,
    loadError,
    submit,
    defaults: FALLBACK,
  };
}