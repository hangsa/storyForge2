import { useCallback, useEffect, useMemo, useState } from "react";
import api, { type WhatIfNode } from "@/api/client";
import { RegenerateModal } from "../../shared/RegenerateModal";

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
  /**
   * Called after /diverge/regenerate/whatif clears non-root nodes and
   * selected_path on canvas. The child rebuilds its tree locally from the
   * response; the parent's re-read is needed so a back-nav to S0D reuses
   * the fresh root + path state.
   */
  onCanvasMutated?: () => void;
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

// Build an "active path" tree by walking selected_path from root. Only
// active descendants are loaded; dimmed siblings are surfaced separately via
// `dimmedSiblingsOf(tree, allNodes)` below so they can render inline under
// their parent with a 弃选 badge + 切换 button. selected_path is the
// canonical linear chain — backend invariant 3 guarantees every node on it
// is branch_status="active" and the rest are dimmed.
function buildActiveTree(
  root: WhatIfNode,
  allNodes: Record<string, WhatIfNode>,
  selectedPath: string[],
): TreeNode {
  const activeChain = new Set(selectedPath);
  function recurse(node: WhatIfNode): TreeNode {
    const childIds = node.children_ids ?? [];
    // Only the next active child is on the chain. children_ids may include
    // dimmed siblings too (invariant 5 says they're present), but we only
    // want the active one as our `children` so the tree walker stays on the
    // chosen path.
    const activeChildId = childIds.find((id) => activeChain.has(id));
    const activeChild = activeChildId ? allNodes[activeChildId] : undefined;
    return {
      ...node,
      isLoaded: true,
      isLoading: false,
      children: activeChild ? [recurse(activeChild)] : [],
    };
  }
  return recurse(root);
}

// Sibling lookup: any node in `allNodes` whose parent_id matches `parent.id`
// that is NOT the parent's active child in the local tree AND NOT on the
// canvas-level selected_path. These are the dimmed alternatives the user
// can switch to via 切换到此分支. We exclude the active child (parent.children)
// so that when the canvas /state load fails (canvasSelectedPath=[]) the
// freshly-expanded active children aren't double-rendered as dimmed
// siblings. selected_path is the canonical linear chain — backend invariant
// 3 guarantees every node on it is branch_status="active" and the rest
// are dimmed.
function dimmedSiblingsOf(
  parent: TreeNode,
  allNodes: Record<string, WhatIfNode>,
  selectedPath: string[],
): WhatIfNode[] {
  if (!parent.id) return [];
  const activeChildIds = new Set(parent.children.map((c) => c.id));
  const activeChain = new Set(selectedPath);
  const siblings = Object.values(allNodes).filter(
    (n) =>
      n.parent_id === parent.id &&
      !activeChildIds.has(n.id) &&
      !activeChain.has(n.id),
  );
  // Stable order by id so the rendered list is deterministic.
  return siblings.sort((a, b) => a.id.localeCompare(b.id));
}

export default function S0DWhatIfStep({
  projectId,
  rootNode,
  onComplete,
  onBack,
  onCanvasMutated,
}: Props) {
  const [tree, setTree] = useState<TreeNode>(() => buildInitialTree(rootNode));
  // `allNodes` mirrors canvas.nodes — the full set including dimmed
  // siblings. Populated on mount from /state, then merged on expand and
  // choose-branch. We don't mutate `tree` to include dimmed siblings; they
  // render as a separate list under their parent via dimmedSiblingsOf().
  const [allNodes, setAllNodes] = useState<Record<string, WhatIfNode>>({});
  // Canvas-level selected_path (the canonical linear chain). Distinct from
  // the user-clicked `selectedPath` (which may be a subtree branch not yet
  // submitted). canvasSelectedPath seeds buildActiveTree + dimmedSiblingsOf
  // so dimmed siblings render correctly on first mount. Refreshed on
  // /choose-branch so the tree rebuilds around the new active.
  const [canvasSelectedPath, setCanvasSelectedPath] = useState<string[]>([]);
  const [loadingCanvas, setLoadingCanvas] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [regenerating, setRegenerating] = useState(false);
  const [showRegenerateModal, setShowRegenerateModal] = useState(false);

  // Load the full canvas on mount so dimmed siblings from previous
  // expansions are visible alongside the active tree. Without this, the
  // tree only contains nodes the user has actively expanded in *this*
  // session — losing the alternatives the backend persisted.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const state = await api.getDivergeState(projectId);
        const canvasNodes = (state?.nodes ?? {}) as Record<string, WhatIfNode>;
        const path = (state?.selected_path ?? []) as string[];
        if (cancelled) return;
        setAllNodes(canvasNodes);
        setCanvasSelectedPath(path);
        if (canvasNodes[rootNode.id]) {
          setTree(buildActiveTree(canvasNodes[rootNode.id], canvasNodes, path));
        }
      } catch {
        // Non-fatal — S0D still works without dimmed siblings if /state
        // fails. The expand path populates allNodes incrementally below.
      } finally {
        if (!cancelled) setLoadingCanvas(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, rootNode.id]);

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
        setAllNodes((prev) => ({ ...prev, ...nodesDict }));
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

  // Switch the active child under a parent to a previously-dimmed sibling.
  // Backend cascade-dims the old active's descendants; we rebuild the active
  // tree from the returned branch_choices and merge returned nodes into
  // allNodes. /choose-branch returns the updated `chosen_node` plus the new
  // `selected_path`, but not the full canvas — so we re-read /state to keep
  // allNodes consistent for siblings that became dimmed off-path.
  const switchBranch = useCallback(
    async (parentNodeId: string, chosenChildId: string) => {
      try {
        await api.postDivergeChooseBranch(
          projectId,
          parentNodeId,
          chosenChildId,
        );
        // Re-read canvas so allNodes reflects the cascade-dim updates
        // (previous active + its descendants) plus any subtree state.
        const state = await api.getDivergeState(projectId);
        const canvasNodes = (state?.nodes ?? {}) as Record<string, WhatIfNode>;
        const path = (state?.selected_path ?? []) as string[];
        setAllNodes(canvasNodes);
        setCanvasSelectedPath(path);
        if (canvasNodes[rootNode.id]) {
          setTree(buildActiveTree(canvasNodes[rootNode.id], canvasNodes, path));
        }
        // Re-anchor selected on the new active child.
        setSelectedId(chosenChildId);
        // selectedPath is recomputed by the useMemo below from the new tree.
        onCanvasMutated?.();
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : "切换分支失败");
      }
    },
    [projectId, rootNode.id, onCanvasMutated],
  );

  const selectedPath = useMemo(() => {
    if (!selectedId) return null;
    return computePath(tree, selectedId);
  }, [tree, selectedId]);

  const renderDimmedSibling = (
    parent: TreeNode,
    sibling: WhatIfNode,
  ): JSX.Element => (
    <div
      key={sibling.id}
      data-testid={`dimmed-${sibling.id}`}
      data-parent-id={parent.id}
      style={{ paddingLeft: `${20}px` }}
      className="py-1"
    >
      <div className="flex items-center gap-2 p-2 rounded-lg border border-outline-variant bg-surface-container/40 opacity-70">
        <span className="font-medium text-sm text-on-surface-variant">
          {sibling.content}
        </span>
        {sibling.novelty_score !== null && (
          <span className="text-xs px-2 py-0.5 rounded bg-secondary-container text-on-secondary-container">
            新颖度 {(sibling.novelty_score * 100).toFixed(0)}%
          </span>
        )}
        <span
          data-testid={`badge-dimmed-${sibling.id}`}
          className="text-xs px-2 py-0.5 rounded bg-outline-variant text-on-surface-variant"
        >
          弃选
        </span>
        <div className="ml-auto flex gap-2">
          <button
            data-testid={`switch-${sibling.id}`}
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              switchBranch(parent.id, sibling.id);
            }}
            className="text-xs px-2 py-1 text-primary hover:underline"
          >
            切换到此分支
          </button>
        </div>
      </div>
    </div>
  );

  const renderNode = (node: TreeNode, depth: number): JSX.Element => {
    const isSelected = node.id === selectedId;
    const indent = { paddingLeft: `${depth * 20}px` };
    const dimmed = dimmedSiblingsOf(node, allNodes, canvasSelectedPath);
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
        {dimmed.map((d) => renderDimmedSibling(node, d))}
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

  async function handleRegenerate(userModifications: string) {
    setShowRegenerateModal(false);
    setRegenerating(true);
    setError(null);
    try {
      // /regenerate/whatif clears all non-root nodes, resets the root's
      // is_expanded/children_ids, and re-runs expand_node. Response shape:
      // { nodes: { [id]: WhatIfNode, ... } } where the only pre-existing
      // entry is the root itself (the engine mints fresh child IDs).
      const result = await api.postDivergeRegenerateWhatif(projectId, {
        user_modifications: userModifications,
      });
      const nodesDict =
        (result as { nodes?: Record<string, WhatIfNode> }).nodes ?? {};
      const childList = Object.values(nodesDict).filter(
        (n) => n.id !== rootNode.id,
      );
      // Rebuild the local tree from the fresh children. The root is
      // carried in via `rootNode` prop (still represents the contradiction);
      // regen only mutates descendants.
      const freshRoot: TreeNode = {
        ...rootNode,
        isLoaded: childList.length > 0,
        isLoading: false,
        children_ids: childList.map((c) => c.id),
        children: childList.map((c) => buildInitialTree(c)),
      };
      // Regen drops every previous node, including dimmed siblings. Drop
      // them from allNodes too so the old 弃选 badges don't linger.
      setAllNodes({ [rootNode.id]: rootNode, ...nodesDict });
      setCanvasSelectedPath([rootNode.id]);
      setTree(freshRoot);
      setSelectedId(null);
      onCanvasMutated?.();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "重新生成失败");
    } finally {
      setRegenerating(false);
    }
  }

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-medium">叙事分叉</h2>
        <button
          type="button"
          data-testid="s0d-regenerate"
          onClick={() => setShowRegenerateModal(true)}
          disabled={regenerating}
          aria-label="重新生成 — 叙事分叉"
          className="inline-flex items-center gap-1.5 h-8 px-3 rounded border border-outline-variant text-on-surface text-sm hover:bg-surface-container hover:border-primary disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          <span
            className={`material-symbols-outlined text-[16px]${regenerating ? " animate-spin" : ""}`}
            data-testid={regenerating ? "s0d-regenerate-spinner" : undefined}
          >
            {regenerating ? "progress_activity" : "refresh"}
          </span>
          重新生成
        </button>
      </div>
      <p className="text-sm text-on-surface-variant">
        展开节点探索叙事分叉路径,选择一条作为正传
      </p>
      {error && <div className="text-error text-sm">{error}</div>}
      {loadingCanvas && (
        <div className="text-on-surface-variant text-sm">加载画布中...</div>
      )}
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
      <RegenerateModal
        open={showRegenerateModal}
        target="叙事分叉"
        placeholder="例如:换个分支方向 / 让子分支更激进 / 加入反英雄路线……"
        busy={regenerating}
        onConfirm={handleRegenerate}
        onCancel={() => setShowRegenerateModal(false)}
      />
    </div>
  );
}