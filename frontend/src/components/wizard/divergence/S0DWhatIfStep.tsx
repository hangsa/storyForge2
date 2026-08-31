import { useCallback, useMemo, useState } from "react";
import api, { type WhatIfNode } from "@/api/client";

interface TreeNode extends WhatIfNode {
  isLoaded: boolean;
  isLoading: boolean;
  children: TreeNode[];
}

interface Props {
  projectId: string;
  rootNode: WhatIfNode;
  onComplete: (path: string[]) => void;
  onBack: () => void;
}

function buildInitialTree(root: WhatIfNode): TreeNode {
  return {
    ...root,
    isLoaded: false,
    isLoading: false,
    children: [],
  };
}

function insertChildren(
  tree: TreeNode,
  parentId: string,
  newChildren: WhatIfNode[],
): TreeNode {
  if (tree.id === parentId) {
    return {
      ...tree,
      isLoaded: true,
      isLoading: false,
      children_ids: newChildren.map((c) => c.id),
      children: newChildren.map((c) => buildInitialTree(c)),
    };
  }
  return {
    ...tree,
    children: tree.children.map((c) => insertChildren(c, parentId, newChildren)),
  };
}

function findNode(tree: TreeNode, id: string): TreeNode | null {
  if (tree.id === id) return tree;
  for (const c of tree.children) {
    const found = findNode(c, id);
    if (found) return found;
  }
  return null;
}

function computePath(tree: TreeNode, targetId: string): string[] | null {
  if (tree.id === targetId) return [tree.id];
  for (const c of tree.children) {
    const path = computePath(c, targetId);
    if (path) return [tree.id, ...path];
  }
  return null;
}

function setLoading(tree: TreeNode, id: string, value: boolean): TreeNode {
  if (tree.id === id) return { ...tree, isLoading: value };
  return {
    ...tree,
    children: tree.children.map((c) => setLoading(c, id, value)),
  };
}

export default function S0DWhatIfStep({
  projectId,
  rootNode,
  onComplete,
  onBack,
}: Props) {
  const [tree, setTree] = useState<TreeNode>(() => buildInitialTree(rootNode));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const expand = useCallback(
    async (nodeId: string) => {
      const node = findNode(tree, nodeId);
      if (!node || node.isLoaded || node.isLoading) return;
      setTree((t) => setLoading(t, nodeId, true));
      try {
        const result = await api.postDivergeWhatIfExpand(projectId, nodeId);
        const nodesDict =
          (result as { nodes?: Record<string, WhatIfNode> }).nodes ?? {};
        const newChildren = Object.values(nodesDict);
        setTree((t) => insertChildren(t, nodeId, newChildren));
      } catch (e: unknown) {
        setTree((t) => setLoading(t, nodeId, false));
        setError(e instanceof Error ? e.message : "展开失败");
      }
    },
    [projectId, tree],
  );

  const select = useCallback((nodeId: string) => {
    setSelectedId(nodeId);
  }, []);

  const selectedPath = useMemo(() => {
    if (!selectedId) return null;
    return computePath(tree, selectedId);
  }, [tree, selectedId]);

  const renderNode = (node: TreeNode, depth: number): JSX.Element => {
    const isSelected = node.id === selectedId;
    const indent = { paddingLeft: `${depth * 20}px` };
    return (
      <div key={node.id} style={indent} className="py-1">
        <div
          data-testid={`node-${node.id}`}
          className={[
            "flex items-center gap-2 p-2 rounded-lg border",
            isSelected
              ? "border-primary bg-surface-container"
              : "border-outline-variant",
          ].join(" ")}
        >
          <span className="font-medium text-sm">{node.content}</span>
          {node.novelty_score !== null && (
            <span className="text-xs px-2 py-0.5 rounded bg-secondary-container text-on-secondary-container">
              新颖度 {(node.novelty_score * 100).toFixed(0)}%
            </span>
          )}
          <div className="ml-auto flex gap-2">
            {!node.isLoaded && (
              <button
                data-testid={`expand-${node.id}`}
                type="button"
                disabled={node.isLoading}
                onClick={(e) => {
                  e.stopPropagation();
                  expand(node.id);
                }}
                className="text-xs px-2 py-1 text-primary hover:underline disabled:opacity-40"
              >
                {node.isLoading ? "展开中..." : "展开"}
              </button>
            )}
            <button
              data-testid={`select-${node.id}`}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                select(node.id);
              }}
              className="text-xs px-2 py-1 bg-primary text-on-primary rounded disabled:opacity-40"
            >
              选择
            </button>
          </div>
        </div>
        {node.children.map((c) => renderNode(c, depth + 1))}
      </div>
    );
  };

  async function submit() {
    if (!selectedPath || selectedPath.length === 0) return;
    setSubmitting(true);
    setError(null);
    try {
      await api.putDivergeWhatIfSelect(projectId, selectedPath);
      onComplete(selectedPath);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "保存失败");
      setSubmitting(false);
    }
  }

  return (
    <div className="p-6 space-y-4">
      <h2 className="text-xl font-medium">叙事分叉</h2>
      <p className="text-sm text-on-surface-variant">
        展开节点探索叙事分叉路径,选择一条作为正传
      </p>
      {error && <div className="text-error text-sm">{error}</div>}
      <div className="border border-outline-variant rounded-lg p-3 max-h-96 overflow-y-auto">
        {renderNode(tree, 0)}
      </div>
      {selectedPath && (
        <div className="text-xs text-on-surface-variant">
          当前路径: {selectedPath.join(" → ")}
        </div>
      )}
      <div className="flex justify-between">
        <button
          data-testid="s0d-back"
          type="button"
          onClick={onBack}
          className="px-4 py-2 text-sm bg-surface-container rounded-lg"
        >
          上一步
        </button>
        <button
          data-testid="s0d-submit"
          type="button"
          disabled={!selectedPath || submitting}
          onClick={submit}
          className="px-5 py-2 bg-primary text-on-primary rounded-lg disabled:opacity-40"
        >
          {submitting ? "提交中..." : "下一步:新颖度评估"}
        </button>
      </div>
    </div>
  );
}