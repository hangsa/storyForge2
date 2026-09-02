import { useCallback, useState } from "react";
import api, {
  type CanvasV4State,
  type NextStepResponse,
  type RawIntent,
} from "@/api/client";

type Status = "empty" | "active" | "completed" | "committed" | "loading";

interface UseCreativeCanvasV2 {
  // State
  status: Status;
  canvas: CanvasV4State | null;
  error: string | null;
  loadingStep: boolean;
  committedAt: string | null;
  canCommit: boolean;
  // Actions
  loadCanvas: () => Promise<void>;
  initSession: (rawIntent: RawIntent) => Promise<void>;
  nextStep: (currentStep: number) => Promise<NextStepResponse>;
  selectOption: (step: number, optionId: string) => Promise<void>;
  commitCanvas: () => Promise<void>;
}

// TODO(v2-canvas): add a `resetCanvas` action once `deleteCanvasV2State` is
// added to api/client.ts. The v1 hook has one (see useCreativeCanvas.ts:250),
// but the v2 client surface (Task 10) ships only the 5 lifecycle endpoints.
// Out of scope for Task 11 — flagged as a follow-up.

export function useCreativeCanvasV2(projectId: string): UseCreativeCanvasV2 {
  const [status, setStatus] = useState<Status>("empty");
  const [canvas, setCanvas] = useState<CanvasV4State | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingStep, setLoadingStep] = useState(false);
  const [committedAt, setCommittedAt] = useState<string | null>(null);

  const loadCanvas = useCallback(async () => {
    setStatus("loading");
    try {
      const c = await api.getCanvasV2State(projectId);
      setCanvas(c);
      if (c.committed) {
        setStatus("committed");
        setCommittedAt(c.committed_at);
      } else if (c.creative_path?.some((p) => p.state === "completed")) {
        setStatus("active");
      } else {
        setStatus("empty");
      }
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "load failed");
    }
  }, [projectId]);

  const initSession = useCallback(async (rawIntent: RawIntent) => {
    setStatus("loading");
    try {
      await api.postCanvasV2Init(projectId, rawIntent);
      await loadCanvas();
    } catch (e) {
      setError(e instanceof Error ? e.message : "init failed");
    }
  }, [projectId, loadCanvas]);

  const nextStep = useCallback(async (currentStep: number) => {
    setLoadingStep(true);
    try {
      const resp = await api.postCanvasV2NextStep(projectId, { current_step: currentStep });
      return resp;
    } catch (e) {
      setError(e instanceof Error ? e.message : "next step failed");
      throw e;
    } finally {
      setLoadingStep(false);
    }
  }, [projectId]);

  const selectOption = useCallback(async (step: number, optionId: string) => {
    try {
      await api.postCanvasV2Select(projectId, { step, option_id: optionId });
      await loadCanvas();
    } catch (e) {
      setError(e instanceof Error ? e.message : "select failed");
    }
  }, [projectId, loadCanvas]);

  const commitCanvas = useCallback(async () => {
    try {
      const resp = await api.postCanvasV2Commit(projectId);
      setCommittedAt(resp.detail.committed_at);
      setStatus("committed");
      await loadCanvas();
    } catch (e) {
      setError(e instanceof Error ? e.message : "commit failed");
    }
  }, [projectId, loadCanvas]);

  // canCommit: spec §7.5
  const cpath = canvas?.creative_path ?? [];
  const completed = cpath.filter((p) => p.state === "completed");
  const stale = cpath.filter((p) => p.state === "stale");
  const step5 = cpath.find((p) => p.step === 5);
  const canCommit =
    !canvas?.committed &&
    step5?.state === "completed" &&
    stale.length === 0 &&
    completed.length === 5;

  return {
    status, canvas, error, loadingStep, committedAt, canCommit,
    loadCanvas, initSession, nextStep, selectOption, commitCanvas,
  };
}