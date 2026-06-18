import { useState, useCallback } from "react";
import api, {
  CanvasNode,
  CanvasEdge,
  CanvasStateData,
  CanvasExpandResponse,
  NoveltyScoreDetail,
  CanvasSelectResponse,
} from "../api/client";

type CanvasStatus = "empty" | "initialized" | "loading";

interface CanvasState {
  status: CanvasStatus;
  rootNodeId: string | null;
  nodes: Record<string, CanvasNode>;
  edges: CanvasEdge[];
  selectedNodeId: string | null;
  selectedPath: string[];
  noveltyScores: Record<string, NoveltyScoreDetail>;
  suggestion: string;
  error: string | null;
}

const initialState: CanvasState = {
  status: "empty",
  rootNodeId: null,
  nodes: {},
  edges: [],
  selectedNodeId: null,
  selectedPath: [],
  noveltyScores: {},
  suggestion: "",
  error: null,
};

export default function useCreativeCanvas(projectId: string | undefined) {
  const [state, setState] = useState<CanvasState>(initialState);

  const loadCanvas = useCallback(async () => {
    if (!projectId) return;
    try {
      const data = await api.getCanvasState(projectId);
      if (data.root_node_id) {
        setState({
          status: "initialized",
          rootNodeId: data.root_node_id,
          nodes: data.nodes,
          edges: data.edges,
          selectedNodeId: null,
          selectedPath: data.selected_path || [],
          noveltyScores: {},
          suggestion: "",
          error: null,
        });
      }
    } catch {
      // Canvas not initialized yet — stay empty
    }
  }, [projectId]);

  const initCanvas = useCallback(async (premise: string) => {
    if (!projectId) return;
    setState((s) => ({ ...s, status: "loading", error: null }));
    try {
      const data = await api.initCanvas(projectId, premise);
      setState({
        status: "initialized",
        rootNodeId: data.root_node_id,
        nodes: data.nodes,
        edges: data.edges,
        selectedNodeId: null,
        selectedPath: data.selected_path || [],
        noveltyScores: {},
        suggestion: "",
        error: null,
      });
    } catch (e) {
      setState((s) => ({
        ...s,
        status: "empty",
        error: e instanceof Error ? e.message : "初始化画布失败",
      }));
    }
  }, [projectId]);

  const expandNode = useCallback(async (nodeId: string) => {
    if (!projectId) return;
    setState((s) => ({ ...s, status: "loading", error: null }));
    try {
      const result: CanvasExpandResponse = await api.expandNode(projectId, nodeId);
      setState((s) => {
        const updatedNodes = { ...s.nodes, ...result.nodes };
        const childIds = Object.keys(result.nodes);
        if (updatedNodes[nodeId]) {
          updatedNodes[nodeId] = {
            ...updatedNodes[nodeId],
            children_ids: [...new Set([...updatedNodes[nodeId].children_ids, ...childIds])],
            is_expanded: true,
          };
        }
        const newEdges: CanvasEdge[] = childIds.map((cid) => ({
          from: nodeId,
          to: cid,
        }));
        const mergedEdges = [...s.edges];
        for (const ne of newEdges) {
          if (!mergedEdges.find((e) => e.from === ne.from && e.to === ne.to)) {
            mergedEdges.push(ne);
          }
        }
        return {
          ...s,
          status: "initialized",
          nodes: updatedNodes,
          edges: mergedEdges,
          noveltyScores: { ...s.noveltyScores, ...result.scores },
          suggestion: result.suggestion || "",
        };
      });
    } catch (e) {
      setState((s) => ({
        ...s,
        status: "initialized",
        error: e instanceof Error ? e.message : "节点扩展失败",
      }));
    }
  }, [projectId]);

  const selectNode = useCallback((nodeId: string | null) => {
    setState((s) => ({ ...s, selectedNodeId: nodeId }));
  }, []);

  const evaluateNode = useCallback(async (nodeId: string) => {
    if (!projectId) return;
    try {
      const score = await api.evaluateNode(projectId, nodeId);
      setState((s) => ({
        ...s,
        noveltyScores: { ...s.noveltyScores, [nodeId]: score },
      }));
    } catch {
      // Silently fail — evaluation is non-critical
    }
  }, [projectId]);

  const selectPath = useCallback(async (leafNodeId: string) => {
    if (!projectId) return;
    const pathIds: string[] = [];
    let current: string | null = leafNodeId;
    setState((s) => {
      const nodes = s.nodes;
      while (current && nodes[current]) {
        pathIds.unshift(current);
        current = nodes[current].parent_id;
      }
      return s;
    });
    if (pathIds.length === 0) return;
    try {
      const result: CanvasSelectResponse = await api.selectPath(projectId, pathIds);
      setState((s) => ({
        ...s,
        selectedPath: result.selected_path,
        suggestion: result.evaluation || s.suggestion,
      }));
    } catch (e) {
      setState((s) => ({
        ...s,
        error: e instanceof Error ? e.message : "路径选择失败",
      }));
    }
  }, [projectId]);

  const resetCanvas = useCallback(() => {
    setState(initialState);
  }, []);

  return {
    ...state,
    loadCanvas,
    initCanvas,
    expandNode,
    selectNode,
    evaluateNode,
    selectPath,
    resetCanvas,
  };
}
