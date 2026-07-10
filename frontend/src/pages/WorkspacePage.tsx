import { useSearchParams } from "react-router-dom";

export default function WorkspacePage({ projectId: _projectId }: { projectId?: string } = {}) {
  const [params] = useSearchParams();
  const mode = params.get("mode") ?? "managed";
  const panel = params.get("panel");
  return (
    <div data-testid="workspace-page" className="p-6 space-y-2 font-body-ui">
      <div className="font-display text-primary text-lg">Workspace (placeholder)</div>
      <div className="text-system-log text-sm">
        mode: <span data-testid="workspace-mode">{mode}</span>
        {panel && (
          <>
            {" · "}panel: <span data-testid="workspace-panel">{panel}</span>
          </>
        )}
      </div>
    </div>
  );
}