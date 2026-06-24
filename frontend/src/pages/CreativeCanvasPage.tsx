import { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import api from "../api/client";
import useCreativeCanvas from "../hooks/useCreativeCanvas";
import WhatIfTree from "../components/creative-canvas/WhatIfTree";
import CanvasToolbar from "../components/creative-canvas/CanvasToolbar";
import CanvasEmptyState from "../components/creative-canvas/CanvasEmptyState";
import NodeDetailPanel from "../components/creative-canvas/NodeDetailPanel";
import ResetConfirmDialog from "../components/creative-canvas/ResetConfirmDialog";

export default function CreativeCanvasPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();

  const {
    status,
    nodes,
    edges,
    selectedNodeId,
    selectedPath,
    noveltyScores,
    suggestion,
    error,
    positions,
    failedNodes,
    mutationSuggestion,
    committedAt,
    loadCanvas,
    initCanvas,
    expandNode,
    selectNode,
    evaluateNode,
    selectPath,
    resetCanvas,
    chooseBranch,
    retryExpand,
    updatePosition,
    getMutationSuggestion,
    applyMutation,
    commitCanvas,
  } = useCreativeCanvas(projectId);

  // Load existing concept premise for canvas seeding
  const [conceptPremise, setConceptPremise] = useState("");
  const [resetDialogOpen, setResetDialogOpen] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [showDimmedChildren, setShowDimmedChildren] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [commitError, setCommitError] = useState<string | null>(null);

  useEffect(() => {
    loadCanvas();
    if (!projectId) return;
    api.getConcept(projectId).then((data) => {
      if (data?.concept?.premise) setConceptPremise(data.concept.premise);
    }).catch(() => {});
  }, [loadCanvas, projectId]);

  // B2 fix: skip the initial mount-time selectPath sync. loadCanvas already
  // pulled the server's current selectedPath — re-syncing it would write to
  // canvas_state.json and pop the committed_at marker (the "已提交" chip
  // would vanish the moment the user navigated back from /stage1). Only
  // sync when the client-side path actually changes from what we last sent.
  const lastSyncedPathRef = useRef<string[] | null>(null);
  useEffect(() => {
    if (status !== "initialized") return;
    if (selectedPath.length === 0 || !projectId) return;
    if (lastSyncedPathRef.current === null) {
      lastSyncedPathRef.current = selectedPath;
      return;
    }
    const prev = lastSyncedPathRef.current;
    if (prev.length === selectedPath.length &&
        prev.every((id, i) => id === selectedPath[i])) {
      return;
    }
    lastSyncedPathRef.current = selectedPath;
    api.selectPath(projectId, selectedPath).catch(() => {});
  }, [selectedPath, status, projectId]);

  const selectedNode = selectedNodeId ? nodes[selectedNodeId] : null;
  const selectedNodeScore = selectedNodeId ? noveltyScores[selectedNodeId] || null : null;
  const isPathEndpoint = selectedNodeId
    ? selectedPath.length > 0 && selectedPath[selectedPath.length - 1] === selectedNodeId
    : false;

  const activeCount = Object.values(nodes).filter(
    (n) => n.branch_status === "active"
  ).length;

  const isOnActivePath = selectedNodeId
    ? selectedPath.includes(selectedNodeId)
    : false;

  const isCanvasEmpty = Object.keys(nodes).length === 0;

  const canCommit = status === "initialized" && selectedPath.length >= 2 && !committing;

  const displayError = error || commitError;

  const fitViewRef = useRef<(() => void) | null>(null);
  const handleFitView = useCallback(() => {
    fitViewRef.current?.();
  }, []);

  const handleResetConfirm = async () => {
    setResetting(true);
    try {
      await resetCanvas();
      setResetDialogOpen(false);
    } finally {
      setResetting(false);
    }
  };

  const handleCommit = async () => {
    if (!canCommit || !projectId) return;
    setCommitting(true);
    setCommitError(null);
    try {
      await commitCanvas();
      // Land on Stage1Page so the user can review/edit the generated concept
      navigate(`/project/${projectId}/stage1`);
    } catch (e) {
      setCommitError(e instanceof Error ? e.message : "提交到概念讨论失败");
    } finally {
      setCommitting(false);
    }
  };

  return (
    <div className="h-[calc(100vh-112px)] flex flex-col">
      {/* Tab bar — same position as Stage1Page */}
      <div className="pt-1 pb-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-1">
            <button
              onClick={() => navigate(`/project/${projectId}/stage1`)}
              className="px-4 py-2 font-body-ui text-sm rounded-lg text-system-log
                         hover:text-primary hover:bg-surface-container transition-colors"
            >
              <span className="material-symbols-outlined text-sm align-middle mr-1">bolt</span>
              快速生成
            </button>
            <button
              className="px-4 py-2 font-body-ui text-sm rounded-lg
                         bg-primary-container/10 text-primary-container border-b-2 border-primary-container"
            >
              <span className="material-symbols-outlined text-sm align-middle mr-1">account_tree</span>
              创意画布
            </button>
          </div>
          <div className="flex items-center gap-3">
            {committedAt && (
              <span
                className="px-2.5 py-1 text-xs font-label-mono rounded-full
                           bg-tertiary-container/20 text-tertiary-container
                           border border-tertiary-container/40"
                title={committedAt}
              >
                <span className="material-symbols-outlined text-xs align-middle mr-1">check_circle</span>
                已提交 · 编辑后将失效
              </span>
            )}
            <button
              onClick={handleCommit}
              disabled={!canCommit}
              className="px-4 py-2 font-body-ui text-sm rounded-lg
                         bg-primary-container text-surface-container-low
                         hover:opacity-90 transition-opacity
                         disabled:opacity-40 disabled:cursor-not-allowed"
              title={
                status !== "initialized"
                  ? "画布尚未初始化"
                  : selectedPath.length < 2
                    ? "selected_path 至少需要根节点 + 一次细化/变异"
                    : "把画布上的选中路径翻译成故事概念"
              }
            >
              <span className="material-symbols-outlined text-sm align-middle mr-1">forward_to_inbox</span>
              {committing ? "提交中..." : "提交到概念讨论 →"}
            </button>
          </div>
        </div>
        {commitError && (
          <div className="mt-2 p-3 bg-error-container/20 border border-error rounded-lg text-error font-body-ui text-xs">
            {commitError}
          </div>
        )}
      </div>

      {/* W6: unified canvas-page error banner. Shows whichever error is
          most recent (commit error overrides hook error when both are set,
          since the commit attempt is what the user just initiated).
          Suppress the hook error here when the canvas is empty — the empty
          state has its own inline error display. */}
      {(commitError || (error && status === "initialized")) && (
        <div className="mb-2 p-3 bg-error-container/20 border border-error rounded-lg text-error font-body-ui text-xs">
          {displayError}
        </div>
      )}

      {/* Canvas area — full-width via negative horizontal+bottom margins */}
      <div className="flex-1 -mx-6 -mb-6 min-h-0">
        <div className="relative h-full bg-surface-container-low/30 rounded-lg border border-outline-variant/30 overflow-hidden">
          {status === "empty" || (isCanvasEmpty && status !== "initialized") ? (
            <CanvasEmptyState
              onInit={initCanvas}
              loading={status === "loading"}
              error={error}
              defaultPremise={conceptPremise}
            />
          ) : (
            <>
              <CanvasToolbar
                nodeCount={Object.keys(nodes).length}
                activeCount={activeCount}
                showDimmedChildren={showDimmedChildren}
                onToggleDimmedChildren={() => setShowDimmedChildren((v) => !v)}
                onRequestReset={() => setResetDialogOpen(true)}
                onFitView={handleFitView}
              />
              <WhatIfTree
                nodes={nodes}
                edges={edges}
                selectedNodeId={selectedNodeId}
                selectedPath={selectedPath}
                positions={positions}
                failedNodes={failedNodes}
                showDimmedChildren={showDimmedChildren}
                onNodeClick={(nodeId) => {
                  selectNode(nodeId);
                  if (!noveltyScores[nodeId]) evaluateNode(nodeId);
                }}
                onNodeExpand={(nodeId) => {
                  selectNode(nodeId);
                  expandNode(nodeId);
                }}
                onPositionChange={updatePosition}
                onRetry={retryExpand}
                onFitViewReady={(fn) => { fitViewRef.current = fn; }}
              />
            </>
          )}

          {/* Loading overlay */}
          {status === "loading" && !isCanvasEmpty && (
            <div className="absolute inset-0 bg-canvas-bg/60 flex items-center justify-center z-20">
              <span className="material-symbols-outlined text-3xl text-primary-container animate-spin">
                progress_activity
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Bottom drawer */}
      {selectedNode && (
        <NodeDetailPanel
          node={selectedNode}
          noveltyScore={selectedNodeScore}
          suggestion={suggestion}
          isPathEndpoint={isPathEndpoint}
          mutationSuggestion={mutationSuggestion}
          isOnActivePath={isOnActivePath}
          onChooseAsBranch={(nodeId) => {
            const parent = Object.values(nodes).find((n) =>
              n.children_ids.includes(nodeId)
            );
            if (parent) {
              chooseBranch(parent.id, nodeId).catch(() => {});
            }
          }}
          onExpand={() => expandNode(selectedNode.id)}
          onEvaluate={() => evaluateNode(selectedNode.id)}
          onSelectPath={() => selectPath(selectedNode.id)}
          onGetMutation={() => getMutationSuggestion(selectedNode.id)}
          onApplyMutation={(op) => applyMutation(selectedNode.id, op)}
          onClose={() => selectNode(null)}
        />
      )}

      <ResetConfirmDialog
        open={resetDialogOpen}
        nodeCount={Object.keys(nodes).length}
        loading={resetting}
        onConfirm={handleResetConfirm}
        onCancel={() => {
          setResetDialogOpen(false);
          setResetting(false);
        }}
      />
    </div>
  );
}
