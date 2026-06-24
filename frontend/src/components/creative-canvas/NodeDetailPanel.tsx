import type { CanvasNode, NoveltyScoreDetail } from "../../api/client";
import NoveltyRadar from "./NoveltyRadar";
import MutationSuggestion from "./MutationSuggestion";

interface NodeDetailPanelProps {
  node: CanvasNode | null;
  noveltyScore: NoveltyScoreDetail | null;
  suggestion: string;
  isPathEndpoint: boolean;
  mutationSuggestion: { nodeId: string; recommendation: string; loading: boolean } | null;
  isOnActivePath: boolean;
  onChooseAsBranch?: (nodeId: string) => void;
  onExpand: () => void;
  onEvaluate: () => void;
  onSelectPath: () => void;
  onGetMutation: () => void;
  onClose: () => void;
}

export default function NodeDetailPanel({
  node,
  noveltyScore,
  suggestion,
  isPathEndpoint,
  mutationSuggestion,
  isOnActivePath,
  onChooseAsBranch,
  onExpand,
  onEvaluate,
  onSelectPath,
  onGetMutation,
  onClose,
}: NodeDetailPanelProps) {
  if (!node) return null;

  const branchStatusLabel = node.branch_status === "active" ? (
    <span className="text-emerald-400">激活</span>
  ) : (
    <span className="text-system-log">未选</span>
  );

  const noveltyLabel = noveltyScore ? (
    <span className={noveltyScore.total >= 80 ? "text-emerald-400" : noveltyScore.total < 40 ? "text-red-400" : ""}>
      {noveltyScore.total.toFixed(0)} ({noveltyScore.grade})
    </span>
  ) : (
    <span className="text-system-log/50">未评估</span>
  );

  return (
    <div className="fixed bottom-0 left-[280px] right-0 h-[34vh] bg-surface-container-low border-t border-outline-variant shadow-2xl z-30 animate-slide-up">
      {/* Drag handle */}
      <div className="flex items-center justify-between px-4 py-1.5 border-b border-outline-variant/50">
        <div className="flex items-center gap-2">
          <div className="w-10 h-1 rounded-full bg-system-log/20 cursor-ns-resize" />
          <span className="font-label-mono text-xs text-system-log">
            {node.id}
          </span>
        </div>
        <button
          onClick={onClose}
          className="text-system-log hover:text-primary transition-colors"
        >
          <span className="material-symbols-outlined">close</span>
        </button>
      </div>

      <div className="flex h-[calc(34vh-30px)]">
        {/* Left: node details */}
        <div className="flex-1 p-3 overflow-y-auto space-y-2.5 border-r border-outline-variant/50">
          {/* Content */}
          <div>
            <p className="font-body-narrative text-primary text-sm leading-snug">
              {node.content}
            </p>
          </div>

          {/* Inline meta strip — single row, dot-separated */}
          <div className="flex items-center flex-wrap gap-x-3 gap-y-1 text-xs">
            <span className="font-label-mono text-system-log">
              深度 <span className="text-primary font-body-ui">L{node.depth}</span>
            </span>
            <span className="text-outline-variant">·</span>
            <span className="font-label-mono text-system-log">
              路径 <span className="font-body-ui">{branchStatusLabel}</span>
            </span>
            <span className="text-outline-variant">·</span>
            <span className="font-label-mono text-system-log">
              子节点 <span className="text-primary font-body-ui">{node.children_ids.length}</span>
            </span>
            {isOnActivePath && (
              <>
                <span className="text-outline-variant">·</span>
                <span className="font-label-mono text-system-log">
                  新颖度 <span className="font-body-ui">{noveltyLabel}</span>
                </span>
              </>
            )}
            {node.trope_tags.length > 0 && (
              <>
                <span className="text-outline-variant">·</span>
                <span className="font-label-mono text-system-log">
                  套话 <span className="text-primary font-body-ui">{node.trope_tags.join("、")}</span>
                </span>
              </>
            )}
            {node.branch_status !== "active" && onChooseAsBranch && (
              <button
                onClick={() => onChooseAsBranch(node.id)}
                className="ml-auto px-2 py-0.5 bg-primary-container/20 text-primary-container rounded hover:bg-primary-container/30 transition-colors"
              >
                选择为分支
              </button>
            )}
          </div>

          {/* Action bar — directly under the meta strip */}
          <div className="flex items-center gap-1.5 pt-2 border-t border-outline-variant/50">
            <button
              onClick={onExpand}
              disabled={node.is_expanded}
              className="flex-1 px-2 py-1.5 bg-primary-container text-surface-container-low font-body-ui
                         rounded hover:opacity-90 transition-opacity disabled:opacity-40 text-xs"
            >
              <span className="material-symbols-outlined text-xs align-middle mr-0.5">
                unfold_more
              </span>
              {node.is_expanded ? "已展开" : "展开"}
            </button>
            <button
              onClick={onEvaluate}
              className="flex-1 px-2 py-1.5 bg-secondary-container text-surface-container-low font-body-ui
                         rounded hover:opacity-90 transition-opacity text-xs"
            >
              <span className="material-symbols-outlined text-xs align-middle mr-0.5">
                analytics
              </span>
              重新评估
            </button>
            <button
              onClick={onGetMutation}
              disabled={mutationSuggestion?.nodeId === node.id && mutationSuggestion.loading}
              className="flex-1 px-2 py-1.5 bg-tertiary-container text-surface-container-low font-body-ui
                         rounded hover:opacity-90 transition-opacity disabled:opacity-40 text-xs"
            >
              <span className="material-symbols-outlined text-xs align-middle mr-0.5">
                transform
              </span>
              {mutationSuggestion?.nodeId === node.id && mutationSuggestion.loading
                ? "分析中..."
                : "变异建议"}
            </button>
            {!isPathEndpoint && node.children_ids.length === 0 && (
              <button
                onClick={onSelectPath}
                className="flex-1 px-2 py-1.5 bg-tertiary-container text-surface-container-low font-body-ui
                           rounded hover:opacity-90 transition-opacity text-xs"
              >
                <span className="material-symbols-outlined text-xs align-middle mr-0.5">
                  flag
                </span>
                路径终点
              </button>
            )}
          </div>

          {/* Saturation warning */}
          {node.saturation_warning && (
            <div className="px-2.5 py-1.5 bg-amber-500/10 border border-amber-500/30 rounded">
              <span className="material-symbols-outlined text-amber-400 text-xs align-middle mr-1">
                warning
              </span>
              <span className="font-body-ui text-amber-300 text-xs">{node.saturation_warning}</span>
            </div>
          )}

          {/* Suggestion */}
          {suggestion && (
            <div className="px-2.5 py-1.5 bg-primary-container/10 border border-primary-container/20 rounded">
              <div className="flex items-center gap-1.5 mb-0.5">
                <span className="material-symbols-outlined text-primary-container text-xs">
                  auto_awesome
                </span>
                <span className="font-label-mono text-xs text-primary-container">
                  创意导演建议
                </span>
              </div>
              <p className="font-body-narrative text-primary text-xs leading-snug">
                {suggestion}
              </p>
            </div>
          )}

          <MutationSuggestion
            loading={mutationSuggestion?.nodeId === node.id && mutationSuggestion.loading}
            recommendation={
              mutationSuggestion?.nodeId === node.id ? mutationSuggestion.recommendation : ""
            }
          />
        </div>

        {/* Right: radar only */}
        <div className="w-[340px] p-3 flex flex-col">
          <div className="flex-1 min-h-0">
            {isOnActivePath ? (
              noveltyScore ? (
                <NoveltyRadar scores={noveltyScore} />
              ) : (
                <div className="flex items-center justify-center h-full">
                  <span className="font-body-ui text-system-log/50 text-xs">
                    点击「重新评估」获取新颖度分析
                  </span>
                </div>
              )
            ) : (
              <div className="flex items-center justify-center h-full">
                <span className="font-body-ui text-system-log/50 text-xs">
                  未选分支暂不评分
                </span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}