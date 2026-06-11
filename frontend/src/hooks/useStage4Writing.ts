import { useState, useCallback } from "react";
import api, {
  WriteSceneResponse,
  CheckResult,
  ParsedLog,
  ApiError,
} from "../api/client";

type PipelineStatus =
  | "idle"
  | "loading"
  | "writing"
  | "reviewing"
  | "retrying"
  | "complete";

interface WritingState {
  status: PipelineStatus;
  sceneNumber: number;
  draftText: string | null;
  factGuardChecks: CheckResult[];
  coherenceScore: number;
  allPassed: boolean;
  parsedLogs: ParsedLog[];
  retryCount: number;
  retryHints: string | null;
  circuitBreakerTriggered: boolean;
  compatibilityNote: string | null;
  error: string | null;
}

const initialState: WritingState = {
  status: "idle",
  sceneNumber: 0,
  draftText: null,
  factGuardChecks: [],
  coherenceScore: 0,
  allPassed: false,
  parsedLogs: [],
  retryCount: 0,
  retryHints: null,
  circuitBreakerTriggered: false,
  compatibilityNote: null,
  error: null,
};

interface UseStage4WritingReturn {
  state: WritingState;
  writeScene: (
    projectId: string,
    chapterNumber: number,
    sceneNumber: number
  ) => Promise<void>;
  forcePass: (projectId: string, sceneNumber: number) => Promise<void>;
  skipScene: (projectId: string, sceneNumber: number) => Promise<void>;
  reset: () => void;
}

export function useStage4Writing(): UseStage4WritingReturn {
  const [state, setState] = useState<WritingState>(initialState);

  const writeScene = useCallback(
    async (
      projectId: string,
      chapterNumber: number,
      sceneNumber: number
    ) => {
      setState((prev) => ({
        ...prev,
        status: "loading",
        sceneNumber,
        error: null,
      }));

      try {
        const resp: WriteSceneResponse = await api.writeScene({
          project_id: projectId,
          chapter_number: chapterNumber,
          scene_number: sceneNumber,
        });

        const newStatus: PipelineStatus =
          resp.status === "passed"
            ? "complete"
            : resp.status === "retry"
              ? "retrying"
              : "complete";

        setState((prev) => ({
          ...prev,
          status: newStatus,
          draftText: resp.draft_text || null,
          factGuardChecks: resp.fact_guard_results?.checks || [],
          coherenceScore: resp.fact_guard_results?.coherence_score || 0,
          allPassed: resp.fact_guard_results?.all_passed || false,
          parsedLogs: resp.parsed_logs || [],
          retryCount: resp.retry_count || 0,
          retryHints: resp.retry_hints?.join("\n") || null,
          circuitBreakerTriggered: resp.status === "circuit_breaker_triggered",
          compatibilityNote: resp.compatibility_note || null,
        }));
      } catch (e) {
        setState((prev) => ({
          ...prev,
          status: "idle",
          error: e instanceof ApiError ? e.message : "写作失败",
        }));
      }
    },
    []
  );

  const forcePass = useCallback(
    async (projectId: string, sceneNumber: number) => {
      try {
        await api.forcePass({ project_id: projectId, scene_number: sceneNumber });
        setState((prev) => ({
          ...prev,
          status: "complete",
          circuitBreakerTriggered: true,
        }));
      } catch (e) {
        setState((prev) => ({
          ...prev,
          error: e instanceof ApiError ? e.message : "强制通过失败",
        }));
      }
    },
    []
  );

  const skipScene = useCallback(
    async (projectId: string, sceneNumber: number) => {
      try {
        await api.skipScene({ project_id: projectId, scene_number: sceneNumber });
        setState((prev) => ({
          ...prev,
          status: "complete",
          sceneNumber,
        }));
      } catch (e) {
        setState((prev) => ({
          ...prev,
          error: e instanceof ApiError ? e.message : "跳过失败",
        }));
      }
    },
    []
  );

  const reset = useCallback(() => {
    setState(initialState);
  }, []);

  return { state, writeScene, forcePass, skipScene, reset };
}
