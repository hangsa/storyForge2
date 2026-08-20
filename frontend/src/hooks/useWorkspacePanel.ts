import { useCallback } from "react";
import { useSearchParams } from "react-router-dom";

export type WorkspacePanel =
  | "concept"
  | "world"
  | "character"
  | "outline"
  | "chapter-outline"
  | "diagnosis"
  | "export";

const VALID: WorkspacePanel[] = [
  "concept",
  "world",
  "character",
  "outline",
  "chapter-outline",
  "diagnosis",
  "export",
];

function isValid(v: string | null): v is WorkspacePanel {
  return v !== null && (VALID as string[]).includes(v);
}

export function useWorkspacePanel(): {
  panel: WorkspacePanel;
  setPanel: (p: WorkspacePanel) => void;
} {
  const [params, setParams] = useSearchParams();
  const raw = params.get("panel");
  const panel: WorkspacePanel = isValid(raw) ? raw : "concept";

  const setPanel = useCallback(
    (p: WorkspacePanel) => {
      const next = new URLSearchParams(params);
      next.set("panel", p);
      setParams(next, { replace: true });
    },
    [params, setParams],
  );

  return { panel, setPanel };
}