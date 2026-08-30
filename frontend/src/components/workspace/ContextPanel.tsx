import { useWorkspacePanel, type WorkspacePanel } from "../../hooks/useWorkspacePanel";
import DiagnosisSummary from "./DiagnosisSummary";
import ExportSummary from "./ExportSummary";

interface Props {
  projectId: string;
  readOnly?: boolean;
  readOnlyReason?: string;
}

// Only 诊断 + 导出 tabs are surfaced here. The first 5 panels (concept/world/
// character/outline/chapter-outline) moved to the wizard's 项目设定 tab; see
// docs/superpowers/plans/2026-08-30-workspace-wizard.md.
const TAB_LABEL: Partial<Record<WorkspacePanel, string>> = {
  diagnosis: "诊断",
  export: "导出",
};

const TAB_ORDER: WorkspacePanel[] = ["diagnosis", "export"];

export default function ContextPanel({ projectId, readOnly, readOnlyReason }: Props) {
  const { panel, setPanel } = useWorkspacePanel();

  return (
    <div data-testid="context-panel" className="h-full flex flex-col">
      <div className="flex border-b border-outline-variant overflow-x-auto">
        {TAB_ORDER.filter((id) => TAB_LABEL[id]).map((id) => (
          <button
            key={id}
            type="button"
            data-testid={`context-tab-${id}${panel === id ? "-active" : ""}`}
            onClick={() => setPanel(id)}
            className={`px-3 py-2 text-sm font-body-ui whitespace-nowrap transition-colors ${
              panel === id ? "border-b-2 border-primary-container text-primary-container" : "text-system-log hover:text-primary"
            }`}
          >{TAB_LABEL[id]}</button>
        ))}
      </div>
      {readOnly && readOnlyReason && (
        <div
          data-testid="context-readonly-banner"
          className="px-4 py-2 bg-secondary-container/30 border-b border-outline-variant text-xs font-body-ui text-system-log"
        >
          <span className="font-label-mono text-[10px] uppercase tracking-wider mr-2">只读</span>
          {readOnlyReason}
        </div>
      )}
      <div className="flex-1 p-4 overflow-y-auto text-sm font-body-narrative text-system-log space-y-3">
        {panel === "export" ? (
          <ExportSummary projectId={projectId} />
        ) : (
          <DiagnosisSummary projectId={projectId} />
        )}
      </div>
    </div>
  );
}