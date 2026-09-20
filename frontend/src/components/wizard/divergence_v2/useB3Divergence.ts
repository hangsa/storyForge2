import { useReducer, useEffect, useCallback, useRef } from "react";
import api from "@/api/client";
import { getPlazaPrompt, putPlazaPrompt } from "@/api/promptPlaza";
import type {
  B3State,
  DimensionDecomposition,
  Unit,
  SubStage,
  RawIntent,
} from "./types";

interface State {
  loading: boolean;
  metaLoading: boolean;       // meta-prompt generation phase (distinct from decompose)
  promptBusy: boolean;        // PUT in-flight (editing specialized prompt)
  error: string | null;
  rawIntent: RawIntent | null;
  dimensions: DimensionDecomposition[];
  causalMap: string;
  topLevelSummary: string;
  decomposePrompt: string;
  followUpLoadingUnitId: string | null;
  currentSubStage: SubStage;
  completedSubStages: SubStage[];
  projectGenre: string;
  // Tracks which sub-stage's primary API call is currently in flight.
  // null = no primary call inflight. Drives the footer loading label so it
  // shows what is actually happening (e.g. "拆解中…" while /decompose is
  // running even if the user navigated back to S1). Cleared on
  // *_SUCCESS / *_ERROR of the matching action.
  inflightStage: SubStage | null;
  // User explicitly clicked "暂停" on the footer loading label. The fetch
  // has been aborted (state.loading=false, inflightStage=null) but the
  // resume() callback can re-fire the same operation from scratch. Cleared
  // on *_SUCCESS / *_ERROR (operation completed normally — pause never
  // happened) or JUMP_TO_STAGE (user navigated away; pause is dropped).
  paused: boolean;
  // /commit 落盘时间戳 — 与 B3State.committed_at 同步。parent (Workspace
  // wizard) 监听其变化后自动 jumpToStep(2) 进世界观。
  committedAt: string | null;
}

type Action =
  | { type: "HYDRATE"; state: B3State | null }
  | { type: "HYDRATE_PROJECT_GENRE"; genre: string }
  | { type: "STAGE1_SUCCESS"; intent: RawIntent }
  | { type: "META_DECOMPOSE_START" }
  | { type: "META_DECOMPOSE_SUCCESS"; generatedPrompt: string }
  | { type: "META_DECOMPOSE_ERROR"; message: string }
  | { type: "SAVE_PROMPT_START" }
  | { type: "SAVE_PROMPT_SUCCESS"; decomposePrompt: string }
  | { type: "SAVE_PROMPT_ERROR"; message: string }
  | { type: "HYDRATE_DECOMPOSE_PROMPT"; decomposePrompt: string }
  | { type: "DECOMPOSE_START" }
  | { type: "DECOMPOSE_SUCCESS"; dimensions: DimensionDecomposition[]; causalMap: string; topLevelSummary: string }
  | { type: "DECOMPOSE_ERROR"; message: string }
  | { type: "FOLLOW_UP_START"; unitId: string }
  | { type: "FOLLOW_UP_SUCCESS"; unit: Unit }
  | { type: "FOLLOW_UP_ERROR"; message: string }
  | { type: "COMMIT_START" }
  | { type: "COMMIT_SUCCESS"; committedAt: string }
  | { type: "COMMIT_ERROR"; message: string }
  | { type: "JUMP_TO_STAGE"; stage: SubStage }
  | { type: "PAUSE" }
  | { type: "RESUME" }
  | { type: "RESET" };

const initial: State = {
  loading: false,
  metaLoading: false,
  promptBusy: false,
  error: null,
  rawIntent: null,
  dimensions: [],
  causalMap: "",
  topLevelSummary: "",
  decomposePrompt: "",
  followUpLoadingUnitId: null,
  currentSubStage: "1",
  completedSubStages: [],
  projectGenre: "",
  inflightStage: null,
  paused: false,
  committedAt: null,
};

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "HYDRATE": {
      if (action.state === null) {
        return initial;
      }
      const s = action.state;
      // Defend against partial/malformed payloads — `dimensions` may be
      // missing if the response isn't a real B3State (e.g. the request
      // helper mistakenly returns a FastAPI {"detail": "..."} envelope).
      const dimensions = Array.isArray(s.dimensions) ? s.dimensions : [];
      // 2026-09-19:completedSubStages 现在只看「拆解完成」与「提交完成」两步。
      // S3/S4 已砍,不再有 candidates / committed_concept 阶段。committedAt
      // 由 schema v3 新增,代替旧的 committed_concept 判定。
      const completed: SubStage[] = ["1"];
      if (dimensions.length > 0) completed.push("2");
      const committedAt = s.committed_at ?? null;
      const currentSubStage: SubStage = committedAt
        ? "2"
        : dimensions.length > 0
          ? "2"
          : "1";
      return {
        ...state,
        rawIntent: s.raw_intent ?? null,
        dimensions,
        causalMap: s.causal_map ?? "",
        topLevelSummary: s.top_level_summary ?? "",
        committedAt,
        currentSubStage,
        completedSubStages: completed,
      };
    }
    case "HYDRATE_PROJECT_GENRE":
      return { ...state, projectGenre: action.genre };
    case "JUMP_TO_STAGE":
      // Clearing loading/inflightStage/metaLoading here is what makes
      // cancel-on-navigate-away actually shut down the UI when the user
      // jumps away from an in-flight primary-stage call. The abort fires
      // inside jumpToStage (see useB3Divergence below) BEFORE this dispatch,
      // so by the time the awaited callback's catch runs (if at all) the
      // state is already clean — and any *_ERROR dispatch that fires later
      // would re-pollute it with the abort's error message. Pre-clearing
      // here is the right place. followUpLoadingUnitId also gets cleared
      // since per-unit follow_up at S2 doesn't survive a stage jump either.
      // `paused` is cleared too — jumping away drops any resume-on-click
      // affordance the user had queued.
      return {
        ...state,
        currentSubStage: action.stage,
        loading: false,
        inflightStage: null,
        metaLoading: false,
        followUpLoadingUnitId: null,
        paused: false,
        error: null,
      };
    case "PAUSE":
      return {
        ...state,
        paused: true,
        loading: false,
        inflightStage: null,
        metaLoading: false,
        error: null,
      };
    case "RESUME":
      return { ...state, paused: false };
    case "DECOMPOSE_START":
      return { ...state, loading: true, inflightStage: "2", paused: false, error: null };
    case "DECOMPOSE_SUCCESS":
      return {
        ...state,
        loading: false,
        inflightStage: null,
        // Coerce non-array to []: backend /decompose occasionally returns a
        // payload missing `dimensions` (partial LLM output, request-helper
        // envelope leak), and S2's `dimensions.length` would otherwise crash
        // with "Cannot read properties of undefined (reading 'length')".
        dimensions: Array.isArray(action.dimensions) ? action.dimensions : [],
        causalMap: action.causalMap,
        topLevelSummary: action.topLevelSummary,
        completedSubStages: Array.from(new Set([...state.completedSubStages, "2"])),
        currentSubStage: "2",
      };
    case "DECOMPOSE_ERROR":
      return { ...state, loading: false, inflightStage: null, paused: false, error: action.message };
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
    case "FOLLOW_UP_ERROR":
      return { ...state, followUpLoadingUnitId: null, error: action.message };
    case "COMMIT_START":
      // 2026-09-19:/commit 现在等价于「提交拆解 → 写入 concept_and_dna」零 LLM
      // 合成。inflightStage 仍标 "2"(S2 提交阶段),S2 footer 会显示 "提交中…"
      // 直到 SUCCESS。完成后由 parent 监听 committedAt 跳到 wizard step 2。
      return { ...state, loading: true, inflightStage: "2", paused: false, error: null };
    case "COMMIT_SUCCESS":
      return {
        ...state,
        loading: false,
        inflightStage: null,
        committedAt: action.committedAt,
        completedSubStages: Array.from(new Set([...state.completedSubStages, "2"])),
      };
    case "COMMIT_ERROR":
      return { ...state, loading: false, inflightStage: null, paused: false, error: action.message };
    case "STAGE1_SUCCESS":
      return {
        ...state,
        rawIntent: action.intent,
        completedSubStages: Array.from(new Set([...state.completedSubStages, "1"])),
      };
    case "META_DECOMPOSE_START":
      return { ...state, loading: true, metaLoading: true, paused: false, error: null };
    case "META_DECOMPOSE_SUCCESS":
      return {
        ...state,
        metaLoading: false,
        decomposePrompt: action.generatedPrompt,
      };
    case "META_DECOMPOSE_ERROR":
      return { ...state, loading: false, metaLoading: false, paused: false, error: action.message };
    case "SAVE_PROMPT_START":
      return { ...state, promptBusy: true };
    case "SAVE_PROMPT_SUCCESS":
      return { ...state, promptBusy: false, decomposePrompt: action.decomposePrompt };
    case "SAVE_PROMPT_ERROR":
      return { ...state, promptBusy: false, error: action.message };
    case "HYDRATE_DECOMPOSE_PROMPT":
      return { ...state, decomposePrompt: action.decomposePrompt };
    case "RESET":
      return { ...initial };
    default:
      return state;
  }
}

export function hasDownstreamData(state: State, targetSubStage: SubStage): boolean {
  // 2026-09-19 砍 S3/S4 后,hasDownstreamData 仅判断 S2 与下游是否仍有数据。
  // 下游是 wizard step 2 世界观,由 S2 committedAt 触发跳转;这里只对
  // SubStage="2" 给出有意义的判断,S3/S4 永不命中。
  if (targetSubStage === "2") {
    return state.dimensions.length > 0 || state.committedAt !== null;
  }
  return false;
}

export function useB3Divergence(projectId: string) {
  const [state, dispatch] = useReducer(reducer, initial);

  // Per-stage AbortController registry for the 2 primary-stage API calls
  // (decompose + commit). Keyed by SubStage string ("2") or "2_meta" for
  // the meta-prompt phase of runS1ToS2 (two sequential inflight phases).
  // jumpToStage(target) aborts any controller whose key doesn't match target
  // (or `${target}_meta`). Each *_START callback registers a fresh controller,
  // and the catch path skips *_ERROR dispatch when `controller.signal.aborted`
  // is true so users don't see an "拆解失败" toast after they navigated away
  // on purpose.
  const inflightControllersRef = useRef<Map<string, AbortController>>(new Map());

  // Callback ref pointing at the most-recent primary-stage action. The
  // public wrappers of decompose / runS1ToS2 / commit each set this BEFORE
  // awaiting their inner impl, then call the impl. The hook's resume()
  // invokes whatever it currently points at — so the user can "暂停 → 继续"
  // by re-firing the exact same operation (same args, same API path). We use
  // a ref (not state) because it must not trigger re-renders; only state.paused
  // needs to drive UI.
  //
  // runS1ToS2 is the interesting case: its wrapper sets ref → _runS1ToS2Impl,
  // but the inner impl's second phase calls the public `decompose` wrapper,
  // which overwrites the ref → _decomposeImpl. So pausing DURING meta re-fires
  // runS1ToS2 (redoes meta + decompose) while pausing DURING decompose
  // re-fires _decomposeImpl only (skips meta — saves tokens).
  const resumeActionRef = useRef<(() => Promise<void>) | null>(null);

  useEffect(
    () => () => {
      inflightControllersRef.current.forEach((ctrl) => ctrl.abort());
      inflightControllersRef.current.clear();
    },
    [],
  );

  const pause = useCallback(() => {
    inflightControllersRef.current.forEach((ctrl) => ctrl.abort());
    inflightControllersRef.current.clear();
    dispatch({ type: "PAUSE" });
  }, []);

  const resume = useCallback(async () => {
    const fn = resumeActionRef.current;
    if (fn) await fn();
    else dispatch({ type: "RESUME" });
  }, []);

  useEffect(() => {
    let cancelled = false;
    api
      .getB3State(projectId)
      .then((s) => {
        if (!cancelled) dispatch({ type: "HYDRATE", state: s });
      })
      .catch(() => {
        // 404 / network: treat as no-state.
        if (!cancelled) dispatch({ type: "HYDRATE", state: null });
      });
    api
      .getProjectStatus(projectId)
      .then((status) => {
        if (cancelled) return;
        const genre = status && typeof status.genre === "string" ? status.genre : "";
        dispatch({ type: "HYDRATE_PROJECT_GENRE", genre });
      })
      .catch(() => {
        // leave projectGenre as ""; S1InputStep's fallback chain still
        // resolves to subject[0]?.id or DEFAULT_GENRE_FALLBACK
      });
    getPlazaPrompt(projectId, "firstness_decompose")
      .then((detail) => {
        if (cancelled) return;
        const text =
          (detail.effective &&
            typeof detail.effective.system_prompt === "string" &&
            detail.effective.system_prompt) ||
          "";
        dispatch({ type: "HYDRATE_DECOMPOSE_PROMPT", decomposePrompt: text });
      })
      .catch(() => {
        // 404 / network — leave decomposePrompt as "". Icon modal opens
        // empty; user can still edit and save.
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const _decomposeImpl = useCallback(async (intent: RawIntent, userModifications = "") => {
    dispatch({ type: "STAGE1_SUCCESS", intent });
    const controller = new AbortController();
    inflightControllersRef.current.set("2", controller);
    dispatch({ type: "DECOMPOSE_START" });
    try {
      const r = await api.postB3Decompose(projectId, {
        ...intent,
        user_modifications: userModifications || undefined,
      }, { signal: controller.signal });
      dispatch({
        type: "DECOMPOSE_SUCCESS",
        dimensions: r.dimensions,
        causalMap: r.causal_map,
        topLevelSummary: r.top_level_summary,
      });
    } catch (e: any) {
      if (controller.signal.aborted) return;
      dispatch({ type: "DECOMPOSE_ERROR", message: e.message });
    } finally {
      if (inflightControllersRef.current.get("2") === controller) {
        inflightControllersRef.current.delete("2");
      }
    }
  }, [projectId]);

  const decompose = useCallback(async (intent: RawIntent, userModifications = "") => {
    resumeActionRef.current = () => _decomposeImpl(intent, userModifications);
    await _decomposeImpl(intent, userModifications);
  }, [_decomposeImpl]);

  const _runS1ToS2Impl = useCallback(async (intent: RawIntent) => {
    dispatch({ type: "STAGE1_SUCCESS", intent });
    const metaController = new AbortController();
    inflightControllersRef.current.set("2_meta", metaController);
    dispatch({ type: "META_DECOMPOSE_START" });
    try {
      const r = await api.postB3MetaDecompose(projectId, intent, { signal: metaController.signal });
      dispatch({ type: "META_DECOMPOSE_SUCCESS", generatedPrompt: r.generated_prompt });
    } catch (e: any) {
      if (metaController.signal.aborted) return;
      dispatch({ type: "META_DECOMPOSE_ERROR", message: e.message });
      return;
    } finally {
      if (inflightControllersRef.current.get("2_meta") === metaController) {
        inflightControllersRef.current.delete("2_meta");
      }
    }
    await decompose(intent, undefined);
  }, [projectId, decompose]);

  const runS1ToS2 = useCallback(async (intent: RawIntent) => {
    resumeActionRef.current = () => _runS1ToS2Impl(intent);
    await _runS1ToS2Impl(intent);
  }, [_runS1ToS2Impl]);

  const savePrompt = useCallback(async (newText: string) => {
    dispatch({ type: "SAVE_PROMPT_START" });
    try {
      await putPlazaPrompt(projectId, "firstness_decompose", { system_prompt: newText });
      dispatch({ type: "SAVE_PROMPT_SUCCESS", decomposePrompt: newText });
    } catch (e: any) {
      dispatch({ type: "SAVE_PROMPT_ERROR", message: e.message });
    }
  }, [projectId]);

  const followUp = useCallback(
    async (unitId: string, userQuestion: string | null, operator: string = "none") => {
      dispatch({ type: "FOLLOW_UP_START", unitId });
      try {
        const r = await api.postB3FollowUp(projectId, { unit_id: unitId, user_question: userQuestion, operator });
        dispatch({ type: "FOLLOW_UP_SUCCESS", unit: r.unit });
      } catch (e: any) {
        dispatch({ type: "FOLLOW_UP_ERROR", message: e.message });
      }
    },
    [projectId],
  );

  // /commit 现在是零 LLM 合成端点(写盘 concept_and_dna.json + creative_divergence.json)。
  // 完成后 parent 通过 committedAt 跳到 wizard step 2 世界观。本 hook 仅
  // 负责 dispatch 状态并写盘 B3State.committed_at。
  const _commitImpl = useCallback(async () => {
    const controller = new AbortController();
    inflightControllersRef.current.set("2", controller);
    dispatch({ type: "COMMIT_START" });
    try {
      const r = await api.postB3Commit(projectId, { signal: controller.signal });
      dispatch({
        type: "COMMIT_SUCCESS",
        committedAt: r.committed_at,
      });
    } catch (e: any) {
      if (controller.signal.aborted) return;
      dispatch({ type: "COMMIT_ERROR", message: e.message });
    } finally {
      if (inflightControllersRef.current.get("2") === controller) {
        inflightControllersRef.current.delete("2");
      }
    }
  }, [projectId]);

  const commit = useCallback(async () => {
    resumeActionRef.current = () => _commitImpl();
    await _commitImpl();
  }, [_commitImpl]);

  const jumpToStage = useCallback((stage: SubStage) => {
    inflightControllersRef.current.forEach((ctrl, key) => {
      if (key !== stage && key !== `${stage}_meta`) ctrl.abort();
    });
    dispatch({ type: "JUMP_TO_STAGE", stage });
  }, []);

  const reset = useCallback(() => {
    dispatch({ type: "RESET" });
  }, []);

  return {
    state,
    projectGenre: state.projectGenre,
    decompose,
    runS1ToS2,
    savePrompt,
    followUp,
    commit,
    jumpToStage,
    reset,
    pause,
    resume,
  };
}