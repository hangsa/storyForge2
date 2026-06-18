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
  onNodeClick: (nodeId: string) => void;
  onNodeExpand?: (nodeId: string) => void;
  onFitViewReady?: (fitView: () => void) => void;
}

const DIMENSION_COLORS: Record<string, string> = {
  "角色动机": "#7c3aed",
  "世界观规则": "#0891b2",
  "情节方向": "#ea580c",
  "读者体验": "#059669",
};

const nodeTypes = { canvasNode: CanvasNodeComponent };

function WhatIfTreeInner({
  nodes,
  edges,
  selectedNodeId,
  selectedPath,
  onNodeClick,
  onNodeExpand,
  onFitViewReady,
}: WhatIfTreeProps) {
  const rootId = Object.values(nodes).find((n) => n.depth === 0)?.id || "";
  const { fitView } = useReactFlow();
  const nodeCountRef = useRef(Object.keys(nodes).length);

  // Expose fitView to parent for toolbar button
  useEffect(() => {
    onFitViewReady?.(() => fitView({ padding: 0.3 }));
  }, [fitView, onFitViewReady]);

  // Auto-fit when nodes are added (expand operation)
  useEffect(() => {
    const currentCount = Object.keys(nodes).length;
    if (currentCount > nodeCountRef.current && currentCount > 1) {
      setTimeout(() => fitView({ padding: 0.3 }), 100);
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

    const H_GAP = 260;
    const V_GAP = 160;
    const result: Node[] = [];

    for (const [depthStr, levelNodes] of Object.entries(byDepth)) {
      const depth = parseInt(depthStr);
      const totalWidth = (levelNodes.length - 1) * H_GAP;
      const startX = -totalWidth / 2;
      levelNodes.forEach((cn, i) => {
        const isRoot = cn.id === rootId;
        result.push({
          id: cn.id,
          type: "canvasNode",
          position: {
            x: startX + i * H_GAP,
            y: depth * V_GAP,
          },
          data: {
            label: cn.id,
            content: cn.content,
            dimension: cn.dimension,
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
  }, [nodes, selectedNodeId, selectedPath, rootId]);

  const initialEdges: Edge[] = useMemo(() => {
    return edges.map((e) => ({
      id: `${e.from}-${e.to}`,
      source: e.from,
      target: e.to,
      animated: selectedPath.includes(e.from) && selectedPath.includes(e.to),
      style: {
        stroke: selectedPath.includes(e.from) && selectedPath.includes(e.to)
          ? DIMENSION_COLORS[nodes[e.to]?.dimension] || "#6b7280"
          : "rgba(255,255,255,0.15)",
        strokeWidth: selectedPath.includes(e.from) && selectedPath.includes(e.to) ? 2 : 1,
      },
    }));
  }, [edges, nodes, selectedPath]);

  const handleNodeClick = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      onNodeClick(node.id);
    },
    [onNodeClick]
  );

  const handleNodeDoubleClick = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      onNodeExpand?.(node.id);
    },
    [onNodeExpand]
  );

  return (
    <div className="w-full h-full">
      <ReactFlow
        nodes={initialNodes}
        edges={initialEdges}
        onNodeClick={handleNodeClick}
        onNodeDoubleClick={handleNodeDoubleClick}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.3 }}
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
            const d = (node.data as unknown as CanvasNodeData).dimension;
            return DIMENSION_COLORS[d] || "#6b7280";
          }}
          maskColor="rgba(0,0,0,0.5)"
          className="!bg-surface-container-low !border-outline-variant !rounded-lg"
        />
      </ReactFlow>
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
