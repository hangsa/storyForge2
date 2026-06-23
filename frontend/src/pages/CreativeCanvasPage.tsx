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
  } = useCreativeCanvas(projectId);

  // Load existing concept premise for canvas seeding
  const [conceptPremise, setConceptPremise] = useState("");
  const [resetDialogOpen, setResetDialogOpen] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [showDimmedChildren, setShowDimmedChildren] = useState(false);

  useEffect(() => {
    loadCanvas();
    if (!projectId) return;
    api.getConcept(projectId).then((data) => {
      if (data?.concept?.premise) setConceptPremise(data.concept.premise);
    }).catch(() => {});
  }, [loadCanvas, projectId]);

  useEffect(() => {
    if (status !== "initialized") return;
    if (selectedPath.length === 0 || !projectId) return;
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

  return (
    <div className="h-[calc(100vh-112px)] flex flex-col">
      {/* Tab bar — same position as Stage1Page */}
      <div className="pt-1 pb-3">
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
      </div>

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
