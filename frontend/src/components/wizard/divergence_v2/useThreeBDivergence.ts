import { useReducer, useEffect, useCallback } from "react";
import api from "@/api/client";
import type {
  ThreeBState,
  DimensionDecomposition,
  Unit,
  CommittedConcept,
  NoveltyScores,
  SubStage,
  RawIntent,
} from "./types";

interface State {
  loading: boolean;
  error: string | null;
  rawIntent: RawIntent | null;
  dimensions: DimensionDecomposition[];
  causalMap: string;
  topLevelSummary: string;
  committedConcept: CommittedConcept | null;
  noveltyScores: NoveltyScores | null;
  followUpLoadingUnitId: string | null;
  currentSubStage: SubStage;
  completedSubStages: SubStage[];
  showUpgradeToast: boolean;
}

type Action =
  | { type: "HYDRATE"; state: ThreeBState | null }
  | { type: "STAGE1_SUCCESS"; intent: RawIntent }
  | { type: "DECOMPOSE_START" }
  | { type: "DECOMPOSE_SUCCESS"; dimensions: DimensionDecomposition[]; causalMap: string; topLevelSummary: string }
  | { type: "DECOMPOSE_ERROR"; message: string }
  | { type: "FOLLOW_UP_START"; unitId: string }
  | { type: "FOLLOW_UP_SUCCESS"; unit: Unit }
  | { type: "FOLLOW_UP_ERROR"; message: string }
  | { type: "DIVERGE_START" }
  | { type: "DIVERGE_SUCCESS"; dimensions: DimensionDecomposition[] }
  | { type: "DIVERGE_ERROR"; message: string }
  | { type: "REGENERATE_UNIT_SUCCESS"; dimension: DimensionDecomposition }
  | { type: "REGENERATE_UNIT_ERROR"; message: string }
  | { type: "SELECT_UNIT_CANDIDATE"; unitId: string; candidateIndex: number; dimension: DimensionDecomposition }
  | { type: "SELECT_UNIT_ERROR"; message: string }
  | { type: "COMMIT_START" }
  | { type: "COMMIT_SUCCESS"; committedConcept: CommittedConcept; noveltyScores: NoveltyScores }
  | { type: "COMMIT_ERROR"; message: string }
  | { type: "EDIT_CONCEPT_START" }
  | { type: "EDIT_CONCEPT_SUCCESS"; committedConcept: CommittedConcept }
  | { type: "ADVANCE_START" }
  | { type: "ADVANCE_SUCCESS"; committedAt: string }
  | { type: "ADVANCE_ERROR"; message: string }
  | { type: "JUMP_TO_STAGE"; stage: SubStage }
  | { type: "RESET" };

const initial: State = {
  loading: false,
  error: null,
  rawIntent: null,
  dimensions: [],
  causalMap: "",
  topLevelSummary: "",
  committedConcept: null,
  noveltyScores: null,
  followUpLoadingUnitId: null,
  currentSubStage: "1",
  completedSubStages: [],
  showUpgradeToast: false,
};

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "HYDRATE": {
      if (action.state === null) {
        return { ...initial, showUpgradeToast: true };
      }
      const s = action.state;
      // Defend against partial/malformed payloads — `dimensions` may be
      // missing if the response isn't a real ThreeBState (e.g. the request
      // helper mistakenly returns a FastAPI {"detail": "..."} envelope).
      const dimensions = Array.isArray(s.dimensions) ? s.dimensions : [];
      const completed: SubStage[] = ["1"];
      if (dimensions.length > 0) completed.push("2");
      if (dimensions.some((d) => d.candidates.length > 0)) completed.push("3");
      if (s.committed_concept !== null) completed.push("4");
      const currentSubStage: SubStage = s.committed_concept
        ? "4"
        : dimensions.some((d) => d.candidates.length > 0)
          ? "3"
        : dimensions.length > 0
          ? "2"
          : "1";
      return {
        ...state,
        rawIntent: s.raw_intent ?? null,
        dimensions,
        causalMap: s.causal_map ?? "",
        topLevelSummary: s.top_level_summary ?? "",
        committedConcept: s.committed_concept ?? null,
        noveltyScores: s.novelty_scores ?? null,
        currentSubStage,
        completedSubStages: completed,
      };
    }
    case "JUMP_TO_STAGE":
      return { ...state, currentSubStage: action.stage, error: null };
    case "DECOMPOSE_START":
      return { ...state, loading: true, error: null };
    case "DECOMPOSE_SUCCESS":
      return {
        ...state,
        loading: false,
        dimensions: action.dimensions,
        causalMap: action.causalMap,
        topLevelSummary: action.topLevelSummary,
        completedSubStages: Array.from(new Set([...state.completedSubStages, "2"])),
        currentSubStage: "2",
      };
    case "DECOMPOSE_ERROR":
      return { ...state, loading: false, error: action.message };
    case "FOLLOW_UP_START":
      return { ...state, followUpLoadingUnitId: action.unitId };
    case "FOLLOW_UP_SUCCESS":
      return {
        ...state,
        followUpLoadingUnitId: null,
        dimensions: state.dimensions.map((d) => ({
          ...d,
          units: d.units.map((u) => (u.id === action.unit.id ? action.unit : u)),
        })),
      };
    case "DIVERGE_START":
      return { ...state, loading: true, error: null };
    case "DIVERGE_SUCCESS":
      return {
        ...state,
        loading: false,
        dimensions: action.dimensions,
        committedConcept: null,
        noveltyScores: null,
        completedSubStages: Array.from(new Set([...state.completedSubStages, "3"])),
        currentSubStage: "3",
      };
    case "REGENERATE_UNIT_SUCCESS":
      return {
        ...state,
        dimensions: state.dimensions.map((d) =>
          d.dimension === action.dimension.dimension ? action.dimension : d,
        ),
      };
    case "REGENERATE_UNIT_ERROR":
      return { ...state, error: action.message };
    case "SELECT_UNIT_CANDIDATE": {
      const matchesUnit = state.dimensions.some((d) =>
        d.units.some((u) => u.id === action.unitId),
      );
      if (!matchesUnit) return state;
      const expectedDimension = state.dimensions.find((d) =>
        d.units.some((u) => u.id === action.unitId),
      )?.dimension;
      if (action.dimension.dimension !== expectedDimension) return state;
      return {
        ...state,
        dimensions: state.dimensions.map((d) =>
          d.dimension === action.dimension.dimension ? action.dimension : d,
        ),
      };
    }
    case "SELECT_UNIT_ERROR":
      return { ...state, error: action.message };
    case "COMMIT_SUCCESS":
      return {
        ...state,
        loading: false,
        committedConcept: action.committedConcept,
        noveltyScores: action.noveltyScores,
        completedSubStages: Array.from(new Set([...state.completedSubStages, "4"])),
        currentSubStage: "4",
      };
    case "EDIT_CONCEPT_SUCCESS":
      return { ...state, committedConcept: action.committedConcept };
    case "ADVANCE_SUCCESS":
      return { ...state, loading: false };
    case "ADVANCE_START":
      return { ...state, loading: true };
    case "ADVANCE_ERROR":
      return { ...state, loading: false, error: action.message };
    case "STAGE1_SUCCESS":
      return {
        ...state,
        rawIntent: action.intent,
        completedSubStages: Array.from(new Set([...state.completedSubStages, "1"])),
      };
    case "RESET":
      return { ...initial };
    default:
      return state;
  }
}

export function hasDownstreamData(state: State, targetSubStage: SubStage): boolean {
  if (targetSubStage === "2") {
    return state.dimensions.length > 0 || state.committedConcept !== null;
  }
  if (targetSubStage === "3") {
    return state.dimensions.some((d) => d.candidates.length > 0) || state.committedConcept !== null;
  }
  if (targetSubStage === "4") {
    return state.committedConcept !== null;
  }
  return false;
}

export function useThreeBDivergence(projectId: string) {
  const [state, dispatch] = useReducer(reducer, initial);

  useEffect(() => {
    let cancelled = false;
    api
      .getThreeBState(projectId)
      .then((s) => {
        if (!cancelled) dispatch({ type: "HYDRATE", state: s });
      })
      .catch(() => {
        // 404 / network: treat as no-state. The reducer's HYDRATE-null
        // branch restores initial state and shows the upgrade toast.
        if (!cancelled) dispatch({ type: "HYDRATE", state: null });
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const decompose = useCallback(async (intent: RawIntent) => {
    dispatch({ type: "DECOMPOSE_START" });
    try {
      const r = await api.postThreeBDecompose(projectId, intent);
      dispatch({
        type: "DECOMPOSE_SUCCESS",
        dimensions: r.dimensions,
        causalMap: r.causal_map,
        topLevelSummary: r.top_level_summary,
      });
    } catch (e: any) {
      dispatch({ type: "DECOMPOSE_ERROR", message: e.message });
    }
  }, [projectId]);

  const followUp = useCallback(
    async (unitId: string, userQuestion: string | null) => {
      dispatch({ type: "FOLLOW_UP_START", unitId });
      try {
        const r = await api.postThreeBFollowUp(projectId, { unit_id: unitId, user_question: userQuestion });
        dispatch({ type: "FOLLOW_UP_SUCCESS", unit: r.unit });
      } catch (e: any) {
        dispatch({ type: "FOLLOW_UP_ERROR", message: e.message });
      }
    },
    [projectId],
  );

  const diverge = useCallback(async () => {
    dispatch({ type: "DIVERGE_START" });
    try {
      const r = await api.postThreeBDiverge(projectId);
      dispatch({ type: "DIVERGE_SUCCESS", dimensions: r.dimensions });
    } catch (e: any) {
      dispatch({ type: "DIVERGE_ERROR", message: e.message });
    }
  }, [projectId]);

  const regenerateUnit = useCallback(
    async (unitId: string) => {
      try {
        const r = await api.postThreeBRegenerateUnit(projectId, { unit_id: unitId });
        const dim = state.dimensions.find((d) => d.units.some((u) => u.id === unitId));
        if (dim) {
          const updatedDim = {
            ...dim,
            candidates: [
              ...dim.candidates.filter((c) => c.unit_id !== unitId),
              ...r.candidates,
            ],
          };
          dispatch({ type: "REGENERATE_UNIT_SUCCESS", dimension: updatedDim });
        }
      } catch (e: any) {
        dispatch({ type: "REGENERATE_UNIT_ERROR", message: e.message });
      }
    },
    [projectId, state.dimensions],
  );

  const selectCandidate = useCallback(
    async (unitId: string, candidateIndex: number) => {
      try {
        const r = await api.postThreeBSelectUnit(projectId, { unit_id: unitId, candidate_index: candidateIndex });
        dispatch({
          type: "SELECT_UNIT_CANDIDATE",
          unitId,
          candidateIndex,
          dimension: r.dimension,
        });
      } catch (e: any) {
        dispatch({ type: "SELECT_UNIT_ERROR", message: e.message });
      }
    },
    [projectId],
  );

  const commit = useCallback(async () => {
    dispatch({ type: "COMMIT_START" });
    try {
      const r = await api.postThreeBCommit(projectId);
      dispatch({
        type: "COMMIT_SUCCESS",
        committedConcept: r.committed_concept,
        noveltyScores: r.novelty_scores,
      });
    } catch (e: any) {
      dispatch({ type: "COMMIT_ERROR", message: e.message });
    }
  }, [projectId]);

  const editConcept = useCallback(
    async (fields: Partial<CommittedConcept>) => {
      dispatch({ type: "EDIT_CONCEPT_START" });
      try {
        const r = await api.postThreeBEditConcept(projectId, fields);
        dispatch({ type: "EDIT_CONCEPT_SUCCESS", committedConcept: r.committed_concept });
      } catch (e: any) {
        dispatch({ type: "COMMIT_ERROR", message: e.message });
      }
    },
    [projectId],
  );

  const advance = useCallback(async () => {
    dispatch({ type: "ADVANCE_START" });
    try {
      const r = await api.postThreeBAdvance(projectId);
      dispatch({ type: "ADVANCE_SUCCESS", committedAt: r.committed_at });
    } catch (e: any) {
      dispatch({ type: "ADVANCE_ERROR", message: e.message });
    }
  }, [projectId]);

  const jumpToStage = useCallback((stage: SubStage) => {
    dispatch({ type: "JUMP_TO_STAGE", stage });
  }, []);

  const reset = useCallback(() => {
    dispatch({ type: "RESET" });
  }, []);

  return {
    state,
    decompose,
    followUp,
    diverge,
    regenerateUnit,
    selectCandidate,
    commit,
    editConcept,
    advance,
    jumpToStage,
    reset,
  };
}