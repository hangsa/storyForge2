import { useState, useCallback } from "react";
import api, {
  BranchSimulationReport,
  SimulationHistoryItem,
} from "../api/client";

interface SimState {
  status: "idle" | "loading" | "loaded";
  description: string;
  currentReport: BranchSimulationReport | null;
  history: SimulationHistoryItem[];
  error: string | null;
}

const initialState: SimState = {
  status: "idle",
  description: "",
  currentReport: null,
  history: [],
  error: null,
};

export default function useBranchSimulation(projectId: string | undefined) {
  const [state, setState] = useState<SimState>(initialState);

  const loadHistory = useCallback(async () => {
    if (!projectId) return;
    try {
      const items = await api.getSimulationHistory(projectId);
      setState((s) => ({ ...s, history: items }));
    } catch {
      // History load is non-blocking
    }
  }, [projectId]);

  const setDescription = useCallback((description: string) => {
    setState((s) => ({ ...s, description, error: null }));
  }, []);

  const runSimulation = useCallback(async () => {
    if (!projectId || !state.description.trim()) return;
    setState((s) => ({ ...s, status: "loading", error: null }));
    try {
      const report = await api.runSimulation(projectId, state.description);
      setState((s) => ({
        ...s,
        status: "loaded",
        currentReport: report,
      }));
      // Refresh history after successful simulation
      const items = await api.getSimulationHistory(projectId);
      setState((s) => ({ ...s, history: items }));
    } catch (e) {
      setState((s) => ({
        ...s,
        status: "idle",
        error: e instanceof Error ? e.message : "分支模拟失败",
      }));
    }
  }, [projectId, state.description]);

  const selectHistoryItem = useCallback(async (item: SimulationHistoryItem) => {
    if (!projectId) return;
    setState((s) => ({ ...s, description: item.description, status: "loading" }));
    try {
      const report = await api.runSimulation(projectId, item.description);
      setState((s) => ({
        ...s,
        status: "loaded",
        currentReport: report,
      }));
    } catch (e) {
      setState((s) => ({
        ...s,
        status: "idle",
        error: e instanceof Error ? e.message : "加载历史模拟失败",
      }));
    }
  }, [projectId]);

  return {
    ...state,
    loadHistory,
    setDescription,
    runSimulation,
    selectHistoryItem,
  };
}
