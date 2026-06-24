import { useCallback, useEffect, useMemo, useRef } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
  useReactFlow,
  type Node,
  type Edge,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import CanvasNodeComponent from "./CanvasNode";
import type { CanvasNodeData } from "./CanvasNode";
import type { CanvasNode, CanvasEdge as CanvasEdgeData } from "../../api/client";

interface WhatIfTreeProps {
  nodes: Record<string, CanvasNode>;
  edges: CanvasEdgeData[];
  selectedNodeId: string | null;
  selectedPath: string[];
  positions: Record<string, { x: number; y: number }>;
  failedNodes: Record<string, { nodeId: string; message: string; attemptedAt: string }>;
  loadingNodes?: Record<string, true>;
  showDimmedChildren?: boolean;
  onNodeClick: (nodeId: string) => void;
  onNodeExpand?: (nodeId: string) => void;
  onPositionChange?: (nodeId: string, x: number, y: number) => void;
  onRetry?: (nodeId: string) => void;
  onFitViewReady?: (fitView: () => void) => void;
}

const nodeTypes = { canvasNode: CanvasNodeComponent };

function WhatIfTreeInner({
  nodes,
  edges,
  selectedNodeId,
  selectedPath,
  positions,
  failedNodes,
  loadingNodes = {},
  showDimmedChildren = false,
  onNodeClick,
  onNodeExpand,
  onPositionChange,
  onRetry,
  onFitViewReady,
}: WhatIfTreeProps) {
  const rootId = Object.values(nodes).find((n) => n.depth === 0)?.id || "";
  const { fitView } = useReactFlow();
  const nodeCountRef = useRef(Object.keys(nodes).length);

  // Expose fitView to parent for toolbar button
  useEffect(() => {
    onFitViewReady?.(() => fitView({ padding: 0.1 }));
  }, [fitView, onFitViewReady]);

  // Auto-fit when nodes are added (expand operation)
  useEffect(() => {
    const currentCount = Object.keys(nodes).length;
    if (currentCount > nodeCountRef.current && currentCount > 1) {
      setTimeout(() => fitView({ padding: 0.1 }), 100);
    }
    nodeCountRef.current = currentCount;
  }, [nodes, fitView]);

  // Build tree layout with positions using level-order grouping
  const initialNodes: Node[] = useMemo(() => {
    const byDepth: Record<number, CanvasNode[]> = {};
    for (const node of Object.values(nodes)) {
      const d = node.depth;
      if (!byDepth[d]) byDepth[d] = [];
      byDepth[d].push(node);
    }

    const H_GAP = 200;
    const V_GAP = 120;
    const result: Node[] = [];

    for (const [depthStr, levelNodes] of Object.entries(byDepth)) {
      const depth = parseInt(depthStr);
      const visibleNodes = levelNodes.filter((cn) => {
        if (cn.branch_status === "active") return true;
        if (!showDimmedChildren) return false;
        // dimmed: only show if parent is active (not also dimmed)
        const parent = cn.parent_id ? nodes[cn.parent_id] : null;
        return parent?.branch_status === "active";
      });
      const totalHeight = (visibleNodes.length - 1) * V_GAP;
      const startY = -totalHeight / 2;
      visibleNodes.forEach((cn, i) => {
        const isRoot = cn.id === rootId;
        const savedPosition = positions[cn.id];
        const computedPosition = {
          x: depth * H_GAP,
          y: startY + i * V_GAP,
        };
        result.push({
          id: cn.id,
          type: "canvasNode",
          position: savedPosition ?? computedPosition,
          data: {
            label: cn.id,
            content: cn.content,
            branchStatus: cn.branch_status,
            depth: cn.depth,
            noveltyScore: cn.novelty_score,
            isRoot,
            isSelected: cn.id === selectedNodeId,
            isPath: selectedPath.includes(cn.id),
            isLeaf: cn.children_ids.length === 0,
            isExpanded: cn.is_expanded,
            onExpand: () => onNodeExpand?.(cn.id),
          } satisfies CanvasNodeData,
        });
      });
    }

    return result;
  }, [nodes, selectedNodeId, selectedPath, rootId, positions, showDimmedChildren]);

  const initialEdges: Edge[] = useMemo(() => {
    return edges.map((e) => ({
      id: `${e.from}-${e.to}`,
      source: e.from,
      target: e.to,
      animated: selectedPath.includes(e.from) && selectedPath.includes(e.to),
      style: {
        stroke: selectedPath.includes(e.from) && selectedPath.includes(e.to)
          ? "#0891b2"
          : "rgba(255,255,255,0.15)",
        strokeWidth: selectedPath.includes(e.from) && selectedPath.includes(e.to) ? 2 : 1,
      },
    }));
  }, [edges, selectedPath]);

  const handleNodeClick = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      onNodeClick(node.id);
    },
    [onNodeClick]
  );

  const handleNodeDoubleClick = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      const nodeData = nodes[node.id];
      if (nodeData?.branch_status !== "active") return;
      onNodeExpand?.(node.id);
    },
    [nodes, onNodeExpand],
  );

  const handleNodeDragStop = useCallback(
    (_event: React.MouseEvent | React.TouchEvent | MouseEvent | TouchEvent, node: Node) => {
      onPositionChange?.(node.id, node.position.x, node.position.y);
    },
    [onPositionChange]
  );

  return (
    <div className="w-full h-full">
      <ReactFlow
        nodes={initialNodes}
        edges={initialEdges}
        onNodeClick={handleNodeClick}
        onNodeDoubleClick={handleNodeDoubleClick}
        onNodeDragStop={handleNodeDragStop}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.1 }}
        minZoom={0.2}
        maxZoom={2}
        proOptions={{ hideAttribution: true }}
        defaultEdgeOptions={{
          type: "smoothstep",
          style: { stroke: "rgba(255,255,255,0.15)", strokeWidth: 1 },
        }}
      >
        <Background color="rgba(255,255,255,0.04)" gap={20} />
        <Controls
          className="!bg-surface-container-low !border-outline-variant !rounded-lg"
        />
        <MiniMap
          nodeColor={(node) => {
            const d = (node.data as unknown as CanvasNodeData).branchStatus;
            return d === "dimmed" ? "#4b5563" : "#6b7280";
          }}
          maskColor="rgba(0,0,0,0.5)"
          className="!bg-surface-container-low !border-outline-variant !rounded-lg"
        />
      </ReactFlow>
      {(() => {
        const failedCount = Object.keys(failedNodes).length;
        const isLoading = Object.keys(loadingNodes).length > 0;
        return (
          failedCount > 0 && (
            <div
              role="status"
              aria-live="polite"
              className="absolute top-3 left-1/2 -translate-x-1/2 z-20 bg-error/20 border border-error rounded-lg px-3 py-2 flex items-center gap-2"
            >
              <span className="material-symbols-outlined text-error text-base">error</span>
              <span className="font-body-ui text-error text-xs">
                {failedCount} 个节点扩展失败
              </span>
              <button
                onClick={() => {
                  Object.keys(failedNodes).forEach((id) => onRetry?.(id));
                }}
                disabled={isLoading}
                className="text-xs px-2 py-0.5 rounded bg-error text-surface-container-low hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isLoading ? "重试中..." : "重试全部"}
              </button>
            </div>
          )
        );
      })()}
    </div>
  );
}

export default function WhatIfTree(props: WhatIfTreeProps) {
  return (
    <ReactFlowProvider>
      <WhatIfTreeInner {...props} />
    </ReactFlowProvider>
  );
}
