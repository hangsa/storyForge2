import { useCallback, useEffect, useReducer } from "react";
import api from "@/api/client";
import type {
  Candidate,
  DeepenedCandidate,
  Operator,
  RawIntent,
  SubStage,
} from "./types";

interface State {
  currentSubStage: SubStage;
  completedSubStages: SubStage[];
  rawIntent: RawIntent | null;
  stage1Submitting: boolean;
  stage2Loading: boolean;
  candidates: Candidate[];
  byOperator: Record<Operator, Candidate[]>;
  stage2Error: string | null;
  stage3SelectedIds: string[];
  stage3AppliedOperators: Record<string, Operator>;
  stage3Deepened: DeepenedCandidate[];
  stage3DeepenLoading: boolean;
  committing: boolean;
  committed: boolean;
}

type Action =
  | { type: "HYDRATE"; state: Partial<State> }
  | { type: "STAGE1_SUBMIT" }
  | { type: "STAGE1_SUCCESS"; intent: RawIntent }
  | { type: "STAGE2_LOADING" }
  | {
      type: "STAGE2_SUCCESS";
      candidates: Candidate[];
      byOperator: Record<Operator, Candidate[]>;
    }
  | { type: "STAGE2_ERROR"; message: string }
  | { type: "TOGGLE_SELECT"; candidateId: string }
  | { type: "SET_APPLIED_OPERATOR"; candidateId: string; op: Operator }
  | { type: "DEEPEN_LOADING" }
  | { type: "DEEPEN_SUCCESS"; deepened: DeepenedCandidate }
  | { type: "COMMIT_START" }
  | { type: "COMMIT_SUCCESS" }
  | { type: "RESET" };

const initial: State = {
  currentSubStage: "1",
  completedSubStages: [],
  rawIntent: null,
  stage1Submitting: false,
  stage2Loading: false,
  candidates: [],
  byOperator: { breaking: [], bending: [], blending: [] },
  stage2Error: null,
  stage3SelectedIds: [],
  stage3AppliedOperators: {},
  stage3Deepened: [],
  stage3DeepenLoading: false,
  committing: false,
  committed: false,
};

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "HYDRATE":
      return { ...state, ...action.state };
    case "STAGE1_SUBMIT":
      return { ...state, stage1Submitting: true };
    case "STAGE1_SUCCESS":
      return {
        ...state,
        stage1Submitting: false,
        rawIntent: action.intent,
        completedSubStages: [...new Set<SubStage>([...state.completedSubStages, "1"])],
        currentSubStage: "2",
        stage2Loading: true,
      };
    case "STAGE2_LOADING":
      return { ...state, stage2Loading: true, stage2Error: null };
    case "STAGE2_SUCCESS":
      return {
        ...state,
        stage2Loading: false,
        candidates: action.candidates,
        byOperator: action.byOperator,
        completedSubStages: [...new Set<SubStage>([...state.completedSubStages, "2"])],
      };
    case "STAGE2_ERROR":
      return { ...state, stage2Loading: false, stage2Error: action.message };
    case "TOGGLE_SELECT": {
      const has = state.stage3SelectedIds.includes(action.candidateId);
      const next = has
        ? state.stage3SelectedIds.filter((id) => id !== action.candidateId)
        : [...state.stage3SelectedIds, action.candidateId].slice(0, 3);
      return { ...state, stage3SelectedIds: next };
    }
    case "SET_APPLIED_OPERATOR":
      return {
        ...state,
        stage3AppliedOperators: {
          ...state.stage3AppliedOperators,
          [action.candidateId]: action.op,
        },
        stage3DeepenLoading: true,
      };
    case "DEEPEN_LOADING":
      return { ...state, stage3DeepenLoading: true };
    case "DEEPEN_SUCCESS":
      return {
        ...state,
        stage3DeepenLoading: false,
        stage3Deepened: [...state.stage3Deepened, action.deepened],
      };
    case "COMMIT_START":
      return { ...state, committing: true };
    case "COMMIT_SUCCESS":
      return {
        ...state,
        committing: false,
        committed: true,
        completedSubStages: [...new Set<SubStage>([...state.completedSubStages, "3"])],
      };
    case "RESET":
      return initial;
  }
}

export function useThreeBDivergence(projectId: string) {
  const [state, dispatch] = useReducer(reducer, initial);

  // Hydrate from server on mount. A 404 / empty-state response is expected for
  // projects that have never run 3B, so we swallow the error — but we log it so
  // a genuine backend failure is at least visible during development.
  useEffect(() => {
    let cancelled = false;
    api
      .getThreeBState(projectId)
      .then((s) => {
        if (cancelled) return;
        const completed: SubStage[] = ["1"];
        if ((s.stage2_candidates ?? []).length > 0) completed.push("2");
        if (s.committed) completed.push("3");
        dispatch({
          type: "HYDRATE",
          state: {
            rawIntent: s.raw_intent,
            candidates: (s.stage2_candidates ?? []) as Candidate[],
            stage3Deepened: (s.stage3_deepened ?? []) as DeepenedCandidate[],
            completedSubStages: completed,
            currentSubStage: s.committed
              ? "3"
              : (s.stage2_candidates ?? []).length > 0
                ? "2"
                : "1",
            committed: s.committed,
          },
        });
      })
      .catch((err) => {
        // Empty state is normal (no 3B run yet); anything else is worth seeing.
        console.warn("[3B] hydrate failed:", err);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  // Transition-only. The actual `POST .../three-b/diverge` LLM call is issued by
  // S1InputStep itself (it owns the form + its own submitting state and calls
  // `api.postThreeBDiverge` before invoking its `onSubmitted` prop). The Task 19
  // orchestrator wires it up as:
  //
  //   <S1InputStep onSubmitted={(intent, resp) => {
  //      submitStage1(intent);        // -> STAGE1_SUCCESS, moves to sub-stage 2
  //      onDivergeSuccess(resp);      // -> STAGE2_SUCCESS with the candidates
  //   }} />
  //
  // so this hook never duplicates the network call.
  const submitStage1 = useCallback(async (intent: RawIntent) => {
    dispatch({ type: "STAGE1_SUCCESS", intent });
  }, []);

  const onDivergeSuccess = useCallback(
    (resp: {
      candidates: Candidate[];
      by_operator: Record<Operator, Candidate[]>;
    }) => {
      dispatch({
        type: "STAGE2_SUCCESS",
        candidates: resp.candidates,
        byOperator: resp.by_operator,
      });
    },
    [],
  );

  const onDivergeError = useCallback((msg: string) => {
    dispatch({ type: "STAGE2_ERROR", message: msg });
  }, []);

  // The regenerate endpoint already returns the replacement candidate, so we
  // splice it into the existing array instead of re-fetching the whole state.
  // Avoids a round-trip and prevents the card from flickering / losing any
  // selection state attached to that candidate id.
  const regenerateOne = useCallback(
    async (candidateId: string) => {
      const resp = await api.postThreeBRegenerateCandidate(projectId, {
        candidate_id: candidateId,
      });
      const fresh = (resp as { candidate: Candidate }).candidate;
      dispatch({
        type: "HYDRATE",
        state: {
          candidates: state.candidates.map((c) =>
            c.id === candidateId ? fresh : c,
          ),
        },
      });
    },
    [projectId, state.candidates],
  );

  const regenerateAll = useCallback(async () => {
    if (!state.rawIntent) return;
    dispatch({ type: "STAGE2_LOADING" });
    try {
      const resp = await api.postThreeBDiverge(projectId, state.rawIntent);
      onDivergeSuccess(
        resp as {
          candidates: Candidate[];
          by_operator: Record<Operator, Candidate[]>;
        },
      );
    } catch (err) {
      onDivergeError((err as Error).message ?? "重新生成失败");
    }
  }, [projectId, state.rawIntent, onDivergeSuccess, onDivergeError]);

  const deepenOne = useCallback(
    async (candidateId: string, op: Operator) => {
      dispatch({ type: "SET_APPLIED_OPERATOR", candidateId, op });
      try {
        const resp = await api.postThreeBDeepen(projectId, {
          candidate_id: candidateId,
          applied_operator: op,
        });
        dispatch({
          type: "DEEPEN_SUCCESS",
          deepened: (resp as { deepened: DeepenedCandidate }).deepened,
        });
      } catch {
        // Revert: drop the key entirely rather than writing `undefined` into the
        // map — downstream code compares `appliedOperators[id] === op`, and an
        // explicit undefined value would keep the id enumerable in
        // Object.keys()/entries() and read as "operator applied".
        const { [candidateId]: _removed, ...rest } = state.stage3AppliedOperators;
        void _removed;
        dispatch({
          type: "HYDRATE",
          state: { stage3AppliedOperators: rest, stage3DeepenLoading: false },
        });
      }
    },
    [projectId, state.stage3AppliedOperators],
  );

  const commit = useCallback(async () => {
    dispatch({ type: "COMMIT_START" });
    try {
      const deepenedIds = state.stage3Deepened.map((d) => d.id);
      await api.postThreeBCommit(projectId, { deepened_ids: deepenedIds });
      dispatch({ type: "COMMIT_SUCCESS" });
    } catch {
      dispatch({ type: "HYDRATE", state: { committing: false } });
    }
  }, [projectId, state.stage3Deepened]);

  const jumpTo = useCallback((stage: SubStage) => {
    dispatch({ type: "HYDRATE", state: { currentSubStage: stage } });
  }, []);

  const reset = useCallback(async () => {
    await api.deleteThreeBState(projectId);
    dispatch({ type: "RESET" });
  }, [projectId]);

  const toggleSelect = useCallback((candidateId: string) => {
    dispatch({ type: "TOGGLE_SELECT", candidateId });
  }, []);

  return {
    state,
    submitStage1,
    onDivergeSuccess,
    onDivergeError,
    regenerateOne,
    regenerateAll,
    deepenOne,
    commit,
    jumpTo,
    reset,
    toggleSelect,
  };
}
