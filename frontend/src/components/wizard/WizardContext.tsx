import { createContext, useContext, useReducer, useEffect, useRef, ReactNode } from "react";
import type { Concept, StoryDNA, World, CharacterSet, NovelOutline, Outline } from "../../api/client";

export function getSessionKey(projectId: string): string {
  return `storyforge.wizard.state.${projectId}`;
}

export type WizardStatus = "idle" | "generating" | "completed" | "error";

export interface WizardData {
  concept: Concept | null;
  story_dna: StoryDNA | null;
  world: World | null;
  characters: CharacterSet | null;
  novel_outline: NovelOutline | null;
  chapter1_outline: Outline | null;
}

export const TOTAL_STEPS = 6;

const EMPTY_DATA: WizardData = {
  concept: null,
  story_dna: null,
  world: null,
  characters: null,
  novel_outline: null,
  chapter1_outline: null,
};

// Maps each wizard data key to the step that owns it. step 4 (Map) owns no
// data. Used by the STEP_COMPLETED reducer to clear downstream keys on resave.
const STEP_DATA_KEY_TO_STEP: Partial<Record<keyof WizardData, number>> = {
  concept: 1,
  story_dna: 1,
  world: 2,
  characters: 3,
  novel_outline: 5,
  chapter1_outline: 6,
};

interface WizardState {
  currentStep: number;
  completedSteps: number[];
  status: WizardStatus;
  data: WizardData;
  errorMessage: string | null;
  /**
   * True once the file-based prefill useEffect has finished running (whether
   * or not it found any files). Steps with an auto-trigger (OutlineStep,
   * ChapterOutlineStep, WorldStep, etc.) must wait for this before deciding
   * to call `generate*` — without it, the auto-trigger fires synchronously
   * on mount before the async prefill can hydrate wizard.data from disk,
   * which manifests as "re-entering the wizard regenerates content the user
   * already paid for" (e.g. proj_cc4ca4ae regression, v1.8.2).
   */
  prefillComplete: boolean;
  /**
   * The current step's "next" action — handled by the modal footer. Each step
   * registers its own handler via useEffect and clears it on unmount.
   */
  nextHandler: (() => void) | null;
  nextDisabled: boolean;
  /**
   * The current step's "regenerate" action — same lifecycle as nextHandler.
   * null when the step doesn't have a regenerate affordance.
   */
  regenerateHandler: (() => void) | null;
  regenerateDisabled: boolean;
}

type WizardAction =
  | { type: "START_STEP"; step: number }
  | { type: "STEP_COMPLETED"; step: number; patch: Partial<WizardData> }
  /**
   * Step generated content via an auto-trigger but did NOT advance the
   * user's position (the user still has to click "下一步" to confirm).
   * Mark it generated: add to completedSteps, write `data`, set
   * status="completed", but DO NOT touch currentStep. This is what keeps
   * the step reachable in the indicator after the user navigates to an
   * earlier step — without it, completedSteps stays stale and the step
   * becomes "pending" (gray) — see PROJ_proj_cc4ca4ae_report.
   */
  | { type: "MARK_STEP_GENERATED"; step: number; patch: Partial<WizardData> }
  | { type: "STEP_SKIPPED"; step: number }
  | { type: "JUMP_TO"; step: number }
  | { type: "STATUS"; status: WizardStatus; errorMessage?: string | null }
  | { type: "RESET" }
  | { type: "HYDRATE"; state: WizardState }
  | {
      type: "HYDRATE_FROM_FILES";
      completedSteps: number[];
      data: Partial<WizardData>;
    }
  | {
      type: "HYDRATE_FROM_FILES_AND_ADVANCE";
      completedSteps: number[];
      data: Partial<WizardData>;
      nextStep: number;
    }
  | { type: "PREFLILL_COMPLETE" }
  | {
      type: "SET_NEXT_HANDLER";
      handler: (() => void) | null;
      disabled: boolean;
    }
  | {
      type: "SET_REGENERATE_HANDLER";
      handler: (() => void) | null;
      disabled: boolean;
    };

const initialState: WizardState = {
  currentStep: 1,
  completedSteps: [],
  status: "idle",
  data: EMPTY_DATA,
  errorMessage: null,
  prefillComplete: false,
  nextHandler: null,
  nextDisabled: false,
  regenerateHandler: null,
  regenerateDisabled: false,
};

function reducer(state: WizardState, action: WizardAction): WizardState {
  switch (action.type) {
    case "START_STEP":
      return { ...state, currentStep: action.step, status: "generating", errorMessage: null };
    case "STEP_COMPLETED": {
      const { step, patch } = action;
      const isResave = state.completedSteps.includes(step);
      let nextCompleted: number[];
      let nextData: WizardData;
      if (isResave) {
        // Resave of an already-completed step: drop everything past `step`
        // from completedSteps and clear their data keys. The current step's
        // data is replaced by the new patch.
        nextCompleted = state.completedSteps.filter((s) => s <= step);
        const cleared: WizardData = { ...EMPTY_DATA };
        for (const [key, value] of Object.entries(state.data)) {
          const ownerStep = STEP_DATA_KEY_TO_STEP[key as keyof WizardData];
          if (ownerStep === undefined || ownerStep <= step) {
            (cleared as unknown as Record<string, unknown>)[key] = value;
          }
        }
        nextData = { ...cleared, ...patch };
      } else {
        nextCompleted = [...state.completedSteps, step].sort((a, b) => a - b);
        nextData = { ...state.data, ...patch };
      }
      return {
        ...state,
        status: "completed",
        completedSteps: nextCompleted,
        currentStep: Math.min(step + 1, TOTAL_STEPS),
        data: nextData,
      };
    }
    case "STEP_SKIPPED":
      return {
        ...state,
        status: "completed",
        completedSteps: state.completedSteps.includes(action.step)
          ? state.completedSteps
          : [...state.completedSteps, action.step].sort((a, b) => a - b),
        currentStep: Math.min(action.step + 1, TOTAL_STEPS),
      };
    case "MARK_STEP_GENERATED": {
      const { step, patch } = action;
      const nextCompleted = state.completedSteps.includes(step)
        ? state.completedSteps
        : [...state.completedSteps, step].sort((a, b) => a - b);
      return {
        ...state,
        status: "completed",
        completedSteps: nextCompleted,
        data: { ...state.data, ...patch },
        // currentStep intentionally unchanged — user has not clicked "下一步" yet.
      };
    }
    case "JUMP_TO":
      return {
        ...state,
        currentStep: action.step,
        status: state.completedSteps.includes(action.step) ? "completed" : "idle",
        errorMessage: null,
      };
    case "STATUS":
      return { ...state, status: action.status, errorMessage: action.errorMessage ?? null };
    case "RESET":
      return initialState;
    case "HYDRATE":
      return action.state;
    case "HYDRATE_FROM_FILES": {
      const mergedCompleted = Array.from(
        new Set([...state.completedSteps, ...action.completedSteps]),
      ).sort((a, b) => a - b);
      return {
        ...state,
        completedSteps: mergedCompleted,
        data: { ...state.data, ...action.data },
        prefillComplete: true,
      };
    }
    case "HYDRATE_FROM_FILES_AND_ADVANCE": {
      const mergedCompleted = Array.from(
        new Set([...state.completedSteps, ...action.completedSteps]),
      ).sort((a, b) => a - b);
      return {
        ...state,
        completedSteps: mergedCompleted,
        data: { ...state.data, ...action.data },
        currentStep: action.nextStep,
        prefillComplete: true,
      };
    }
    case "PREFLILL_COMPLETE":
      return { ...state, prefillComplete: true };
    case "SET_NEXT_HANDLER":
      return { ...state, nextHandler: action.handler, nextDisabled: action.disabled };
    case "SET_REGENERATE_HANDLER":
      return { ...state, regenerateHandler: action.handler, regenerateDisabled: action.disabled };
    default:
      return state;
  }
}

function loadPersisted(projectId: string): WizardState | null {
  try {
    const raw = sessionStorage.getItem(getSessionKey(projectId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (
      typeof parsed.currentStep === "number" &&
      Array.isArray(parsed.completedSteps) &&
      parsed.data
    ) {
      return {
        currentStep: parsed.currentStep,
        completedSteps: parsed.completedSteps,
        status: parsed.status || "idle",
        data: { ...EMPTY_DATA, ...parsed.data },
        errorMessage: parsed.errorMessage || null,
        // SessionStorage can be stale (e.g., user closed on step 5 without
        // saving, leaving data.novel_outline=null even though the file exists
        // on disk). Force prefill to run again by setting prefillComplete=false
        // regardless of what sessionStorage held.
        prefillComplete: false,
        nextHandler: null,
        nextDisabled: false,
        regenerateHandler: null,
        regenerateDisabled: false,
      };
    }
    return null;
  } catch {
    return null;
  }
}

interface WizardContextValue extends WizardState {
  startStep: (step: number) => void;
  saveStep: (step: number, patch: Partial<WizardData>) => void;
  /**
   * Mark a step as having generated content (auto-trigger completed). Adds
   * the step to completedSteps, writes the patch to data, and sets
   * status="completed" — but DOES NOT advance currentStep. Use this when
   * the LLM call wrote content directly to disk and the user still has to
   * click "下一步" to confirm (i.e., generated = data on disk, completed =
   * user reviewed & acknowledged).
   */
  markStepGenerated: (step: number, patch: Partial<WizardData>) => void;
  skipStep: (step: number) => void;
  jumpToStep: (step: number) => void;
  setStatus: (status: WizardStatus, errorMessage?: string | null) => void;
  hydrateFromFiles: (completedSteps: number[], data: Partial<WizardData>) => void;
  hydrateFromFilesAndAdvance: (
    completedSteps: number[],
    data: Partial<WizardData>,
    nextStep: number,
  ) => void;
  /**
   * Signal that the prefill useEffect has finished running. Use this when
   * prefill found no files to hydrate (the hydrate* actions above already
   * mark prefillComplete=true as a side effect).
   */
  markPrefillComplete: () => void;
  reset: () => void;
  /**
   * Each step registers its "next" and "regenerate" handlers here so the
   * modal footer can render them. Pass null on unmount to clear.
   */
  setNextHandler: (handler: (() => void) | null, disabled?: boolean) => void;
  setRegenerateHandler: (handler: (() => void) | null, disabled?: boolean) => void;
}

const WizardContext = createContext<WizardContextValue | null>(null);

interface WizardProviderProps {
  projectId: string;
  children: ReactNode;
}

export function WizardProvider({ projectId, children }: WizardProviderProps) {
  const [state, dispatch] = useReducer(
    reducer,
    initialState,
    (init) => loadPersisted(projectId) || init
  );
  // Track whether the provider has ever written a non-empty state. Used to
  // tell apart "first mount, nothing happened" (we DO save the empty state
  // so the close button preserves it) from "post-reset" (we DON'T save —
  // reset already cleared sessionStorage, and writing it back undoes the
  // reset). Empty state = initialState shape; non-empty = anything else.
  const hasProgressedRef = useRef(false);

  useEffect(() => {
    const isEmpty =
      state.currentStep === 1 &&
      state.completedSteps.length === 0 &&
      state.status === "idle" &&
      state.errorMessage === null;

    if (isEmpty && hasProgressedRef.current) {
      // Post-reset: the reset() handler cleared sessionStorage synchronously.
      // Don't write the empty state back — that's the bug.
      return;
    }

    if (!isEmpty) {
      hasProgressedRef.current = true;
    }

    try {
      sessionStorage.setItem(
        getSessionKey(projectId),
        JSON.stringify({
          currentStep: state.currentStep,
          completedSteps: state.completedSteps,
          status: state.status,
          data: state.data,
          errorMessage: state.errorMessage,
        })
      );
    } catch {
      // sessionStorage unavailable; ignore.
    }
  }, [projectId, state]);

  const value: WizardContextValue = {
    ...state,
    startStep: (step) => dispatch({ type: "START_STEP", step }),
    saveStep: (step, patch) => dispatch({ type: "STEP_COMPLETED", step, patch }),
    markStepGenerated: (step, patch) => dispatch({ type: "MARK_STEP_GENERATED", step, patch }),
    skipStep: (step) => dispatch({ type: "STEP_SKIPPED", step }),
    jumpToStep: (step) => dispatch({ type: "JUMP_TO", step }),
    setStatus: (status, errorMessage) => dispatch({ type: "STATUS", status, errorMessage }),
    hydrateFromFiles: (completedSteps, data) =>
      dispatch({ type: "HYDRATE_FROM_FILES", completedSteps, data }),
    hydrateFromFilesAndAdvance: (completedSteps, data, nextStep) =>
      dispatch({ type: "HYDRATE_FROM_FILES_AND_ADVANCE", completedSteps, data, nextStep }),
    markPrefillComplete: () => dispatch({ type: "PREFLILL_COMPLETE" }),
    setNextHandler: (handler, disabled = false) =>
      dispatch({ type: "SET_NEXT_HANDLER", handler, disabled }),
    setRegenerateHandler: (handler, disabled = false) =>
      dispatch({ type: "SET_REGENERATE_HANDLER", handler, disabled }),
    reset: () => {
      try {
        sessionStorage.removeItem(getSessionKey(projectId));
      } catch {
        // ignore
      }
      dispatch({ type: "RESET" });
    },
  };

  return <WizardContext.Provider value={value}>{children}</WizardContext.Provider>;
}

export function useWizard(): WizardContextValue {
  const ctx = useContext(WizardContext);
  if (!ctx) throw new Error("useWizard must be used within WizardProvider");
  return ctx;
}
