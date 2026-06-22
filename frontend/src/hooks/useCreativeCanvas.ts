import { useState, useCallback, useRef, useEffect } from "react";
import api, {
  CanvasNode,
  CanvasEdge,
  CanvasStateData,
  CanvasExpandResponse,
  NoveltyScoreDetail,
  CanvasSelectResponse,
} from "../api/client";

type CanvasStatus = "empty" | "initialized" | "loading";

interface PositionMap {
  [nodeId: string]: { x: number; y: number };
}

interface FailedNode {
  nodeId: string;
  message: string;
  attemptedAt: string;
}

type LoadingNodes = Record<string, true>;

interface MutationSuggestionState {
  nodeId: string;
  recommendation: string;
  loading: boolean;
}

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
  positions: PositionMap;
  failedNodes: Record<string, FailedNode>;
  loadingNodes: LoadingNodes;
  mutationSuggestion: MutationSuggestionState | null;
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
  positions: {},
  failedNodes: {},
  loadingNodes: {},
  mutationSuggestion: null,
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
          positions: {},
          failedNodes: {},
          loadingNodes: {},
          mutationSuggestion: null,
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
        positions: {},
        failedNodes: {},
        loadingNodes: {},
        mutationSuggestion: null,
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
    setState((s) => ({
      ...s,
      status: "loading",
      error: null,
      loadingNodes: { ...s.loadingNodes, [nodeId]: true },
    }));
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
        const remainingFailed = { ...s.failedNodes };
        delete remainingFailed[nodeId];
        const remainingLoading = { ...s.loadingNodes };
        delete remainingLoading[nodeId];
        return {
          ...s,
          status: "initialized",
          nodes: updatedNodes,
          edges: mergedEdges,
          noveltyScores: { ...s.noveltyScores, ...result.scores },
          suggestion: result.suggestion || s.suggestion,
          failedNodes: remainingFailed,
          loadingNodes: remainingLoading,
        };
      });
    } catch (e) {
      setState((s) => {
        const remainingLoading = { ...s.loadingNodes };
        delete remainingLoading[nodeId];
        return {
          ...s,
          status: "initialized",
          loadingNodes: remainingLoading,
          failedNodes: {
            ...s.failedNodes,
            [nodeId]: {
              nodeId,
              message: e instanceof Error ? e.message : "节点扩展失败",
              attemptedAt: new Date().toISOString(),
            },
          },
        };
      });
    }
  }, [projectId]);

  const selectNode = useCallback((nodeId: string | null) => {
    setState((s) => ({
      ...s,
      selectedNodeId: nodeId,
      mutationSuggestion: null,
    }));
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

  const nodesRef = useRef(state.nodes);
  useEffect(() => { nodesRef.current = state.nodes; }, [state.nodes]);

  const selectPath = useCallback(async (leafNodeId: string) => {
    if (!projectId) return;
    const pathIds: string[] = [];
    let current: string | null = leafNodeId;
    const nodes = nodesRef.current;
    while (current && nodes[current]) {
      pathIds.unshift(current);
      current = nodes[current].parent_id;
    }
    if (pathIds.length === 0) return;
    try {
      const result: CanvasSelectResponse = await api.selectPath(projectId, pathIds);
      setState((s) => ({
        ...s,
        selectedPath: result.selected_path,
        suggestion: result.evaluation || s.suggestion,
        selectedNodeId: null,
      }));
    } catch (e) {
      setState((s) => ({
        ...s,
        error: e instanceof Error ? e.message : "路径选择失败",
      }));
    }
  }, [projectId]);

  const resetCanvas = useCallback(async () => {
    if (!projectId) return;
    setState(initialState);
    try {
      await api.resetCanvas(projectId);
    } catch (e) {
      // Local state cleared, but server still has stale data — surface error so UI can show
      setState((s) => ({
        ...s,
        error: e instanceof Error ? e.message : "重置画布失败（本地已清空，服务器仍有数据）",
      }));
    }
  }, [projectId]);

  const retryExpand = useCallback((nodeId: string) => {
    expandNode(nodeId);
  }, [expandNode]);

  const updatePosition = useCallback((nodeId: string, x: number, y: number) => {
    setState((s) => ({
      ...s,
      positions: { ...s.positions, [nodeId]: { x, y } },
    }));
  }, []);

  const getMutationSuggestion = useCallback(async (nodeId: string) => {
    if (!projectId) return;
    setState((s) => ({
      ...s,
      mutationSuggestion: { nodeId, recommendation: "", loading: true },
    }));
    try {
      const result = await api.getMutationSuggestion(projectId, nodeId);
      setState((s) => {
        // Guard against stale responses: if user already moved on, drop this update
        if (s.mutationSuggestion?.nodeId !== nodeId) return s;
        return {
          ...s,
          mutationSuggestion: {
            nodeId,
            recommendation: result.recommendation || "暂无变异建议",
            loading: false,
          },
        };
      });
    } catch (e) {
      setState((s) => {
        if (s.mutationSuggestion?.nodeId !== nodeId) return s;
        return {
          ...s,
          mutationSuggestion: {
            nodeId,
            recommendation: e instanceof Error ? e.message : "获取变异建议失败",
            loading: false,
          },
        };
      });
    }
  }, [projectId]);

  return {
    ...state,
    loadCanvas,
    initCanvas,
    expandNode,
    selectNode,
    evaluateNode,
    selectPath,
    resetCanvas,
    retryExpand,
    updatePosition,
    getMutationSuggestion,
  };
}
