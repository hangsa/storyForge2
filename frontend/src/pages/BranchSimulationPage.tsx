import { useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import useBranchSimulation from "../hooks/useBranchSimulation";
import SimulateForm from "../components/branch-simulation/SimulateForm";
import HistoryList from "../components/branch-simulation/HistoryList";
import ResultViewer from "../components/branch-simulation/ResultViewer";

export default function BranchSimulationPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();

  const {
    status,
    description,
    currentReport,
    history,
    error,
    loadHistory,
    setDescription,
    runSimulation,
    selectHistoryItem,
  } = useBranchSimulation(projectId);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  return (
    <div className="h-[calc(100vh-112px)] flex flex-col">
      {/* Two-column layout — full-width via negative horizontal+bottom margins */}
      <div className="flex-1 flex gap-0 overflow-hidden -mx-6 -mb-6 min-h-0">
        {/* Left column: input + history */}
        <div className="w-[380px] shrink-0 border-r border-outline-variant/30 pr-4 flex flex-col gap-4 overflow-y-auto">
          <SimulateForm
            description={description}
            onDescriptionChange={setDescription}
            onExecute={runSimulation}
            loading={status === "loading"}
          />

          {error && (
            <div className="p-3 bg-error-container/20 border border-error rounded-lg text-error font-body-ui text-sm">
              {error}
            </div>
          )}

          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className="material-symbols-outlined text-system-log text-lg">history</span>
              <h2 className="font-label-mono text-system-log uppercase tracking-wider text-sm">
                历史记录
              </h2>
            </div>
            <HistoryList
              items={history}
              onSelect={selectHistoryItem}
              loading={status === "loading"}
            />
          </div>
        </div>

        {/* Right column: results */}
        <div className="flex-1 pl-4 overflow-y-auto">
          {status === "loading" && !currentReport ? (
            <div className="flex items-center justify-center h-full">
              <div className="text-center">
                <span className="material-symbols-outlined text-4xl text-primary-container animate-spin block mb-3">
                  progress_activity
                </span>
                <p className="font-body-ui text-system-log">正在分析分支影响...</p>
              </div>
            </div>
          ) : (
            <ResultViewer report={currentReport} />
          )}
        </div>
      </div>
    </div>
  );
}
