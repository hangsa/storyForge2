import { useEffect, useState, useCallback } from "react";
import type { ManagedStartConfig } from "../components/workspace/ManagedStartModal";
import {
  getAutopilotSession,
  startAutopilotSession,
} from "../api/autopilot";

const FALLBACK: ManagedStartConfig = {
  scope: "all_planned",
  cadence: "balanced",
  policy: "auto",
  notify: "milestones",
};

export function useAutopilotConfig(projectId: string) {
  const [config, setConfig] = useState<ManagedStartConfig>(FALLBACK);
  const [loaded, setLoaded] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getAutopilotSession(projectId)
      .then((s) => {
        if (cancelled) return;
        if (s?.config) setConfig(s.config);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
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

  return { config, setConfig, loaded, submitting, submit, defaults: FALLBACK };
}