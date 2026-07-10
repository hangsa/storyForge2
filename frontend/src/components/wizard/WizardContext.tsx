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

interface WizardState {
  currentStep: number;
  completedSteps: number[];
  status: WizardStatus;
  data: WizardData;
  errorMessage: string | null;
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
  nextHandler: null,
  nextDisabled: false,
  regenerateHandler: null,
  regenerateDisabled: false,
};

function reducer(state: WizardState, action: WizardAction): WizardState {
  switch (action.type) {
    case "START_STEP":
      return { ...state, currentStep: action.step, status: "generating", errorMessage: null };
    case "STEP_COMPLETED":
      return {
        ...state,
        status: "completed",
        completedSteps: state.completedSteps.includes(action.step)
          ? state.completedSteps
          : [...state.completedSteps, action.step].sort((a, b) => a - b),
        currentStep: Math.min(action.step + 1, TOTAL_STEPS),
        data: { ...state.data, ...action.patch },
      };
    case "STEP_SKIPPED":
      return {
        ...state,
        status: "completed",
        completedSteps: state.completedSteps.includes(action.step)
          ? state.completedSteps
          : [...state.completedSteps, action.step].sort((a, b) => a - b),
        currentStep: Math.min(action.step + 1, TOTAL_STEPS),
      };
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
      };
    }
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
  skipStep: (step: number) => void;
  jumpToStep: (step: number) => void;
  setStatus: (status: WizardStatus, errorMessage?: string | null) => void;
  hydrateFromFiles: (completedSteps: number[], data: Partial<WizardData>) => void;
  hydrateFromFilesAndAdvance: (
    completedSteps: number[],
    data: Partial<WizardData>,
    nextStep: number,
  ) => void;
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
    skipStep: (step) => dispatch({ type: "STEP_SKIPPED", step }),
    jumpToStep: (step) => dispatch({ type: "JUMP_TO", step }),
    setStatus: (status, errorMessage) => dispatch({ type: "STATUS", status, errorMessage }),
    hydrateFromFiles: (completedSteps, data) =>
      dispatch({ type: "HYDRATE_FROM_FILES", completedSteps, data }),
    hydrateFromFilesAndAdvance: (completedSteps, data, nextStep) =>
      dispatch({ type: "HYDRATE_FROM_FILES_AND_ADVANCE", completedSteps, data, nextStep }),
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
