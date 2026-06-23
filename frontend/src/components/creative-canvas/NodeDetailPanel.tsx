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

  return (
    <div className="fixed bottom-0 left-[280px] right-0 h-[42vh] bg-surface-container-low border-t border-outline-variant shadow-2xl z-30 animate-slide-up">
      {/* Drag handle */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-outline-variant/50">
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

      <div className="flex h-[calc(42vh-40px)]">
        {/* Left: node details */}
        <div className="flex-1 p-4 overflow-y-auto space-y-4 border-r border-outline-variant/50">
          {/* Content */}
          <div>
            <span className="font-label-mono text-xs text-system-log uppercase tracking-wider">
              内容
            </span>
            <p className="font-body-narrative text-primary text-sm mt-1 leading-relaxed">
              {node.content}
            </p>
          </div>

          {/* Meta grid */}
          <div className="grid grid-cols-2 gap-3">
            <div className="p-2 bg-surface-container rounded">
              <span className="font-label-mono text-xs text-system-log">深度</span>
              <p className="font-body-ui text-primary text-sm mt-0.5">L{node.depth}</p>
            </div>
            <div className="p-2 bg-surface-container rounded">
              <span className="font-label-mono text-xs text-system-log">路径状态</span>
              <p className="font-body-ui text-primary text-sm mt-0.5 flex items-center gap-2">
                {node.branch_status === "active" ? (
                  <>
                    <span className="text-emerald-400">激活</span>
                    <span className="material-symbols-outlined text-base">check_circle</span>
                  </>
                ) : (
                  <>
                    <span className="text-system-log">未选</span>
                    <button
                      onClick={() => onChooseAsBranch?.(node.id)}
                      className="ml-auto px-2 py-1 text-xs bg-primary-container/20 text-primary-container rounded hover:bg-primary-container/30 transition-colors"
                    >
                      选择为分支
                    </button>
                  </>
                )}
              </p>
            </div>
            {isOnActivePath && (
              <div className="p-2 bg-surface-container rounded">
                <span className="font-label-mono text-xs text-system-log">新颖度评分</span>
                <p className="font-body-ui text-primary text-sm mt-0.5">
                  {noveltyScore ? (
                    <span className={noveltyScore.total >= 80 ? "text-emerald-400" : noveltyScore.total < 40 ? "text-red-400" : ""}>
                      {noveltyScore.total.toFixed(0)} — {noveltyScore.grade}
                    </span>
                  ) : (
                    <span className="text-system-log/50">未评估</span>
                  )}
                </p>
              </div>
            )}
            <div className="p-2 bg-surface-container rounded">
              <span className="font-label-mono text-xs text-system-log">子节点</span>
              <p className="font-body-ui text-primary text-sm mt-0.5">{node.children_ids.length}</p>
            </div>
          </div>

          {/* Trope tags */}
          {node.trope_tags.length > 0 && (
            <div>
              <span className="font-label-mono text-xs text-system-log uppercase tracking-wider">
                套话标签
              </span>
              <div className="flex flex-wrap gap-1 mt-1">
                {node.trope_tags.map((tag, i) => (
                  <span
                    key={i}
                    className="text-xs px-2 py-0.5 rounded-full bg-surface-container text-system-log font-mono"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Saturation warning */}
          {node.saturation_warning && (
            <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg">
              <span className="material-symbols-outlined text-amber-400 text-sm align-middle mr-1">
                warning
              </span>
              <span className="font-body-ui text-amber-300 text-xs">{node.saturation_warning}</span>
            </div>
          )}

          {/* Suggestion */}
          {suggestion && (
            <div className="p-3 bg-primary-container/10 border border-primary-container/20 rounded-lg">
              <div className="flex items-center gap-1.5 mb-1">
                <span className="material-symbols-outlined text-primary-container text-sm">
                  auto_awesome
                </span>
                <span className="font-label-mono text-xs text-primary-container">
                  创意导演建议
                </span>
              </div>
              <p className="font-body-narrative text-primary text-sm leading-relaxed">
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

        {/* Right: radar + actions */}
        <div className="w-[380px] p-4 flex flex-col">
          {/* Radar */}
          <div className="flex-1">
            {isOnActivePath ? (
              noveltyScore ? (
                <NoveltyRadar scores={noveltyScore} />
              ) : (
                <div className="flex items-center justify-center h-full">
                  <span className="font-body-ui text-system-log/50 text-sm">
                    点击"重新评估"获取新颖度分析
                  </span>
                </div>
              )
            ) : (
              <div className="flex items-center justify-center h-full">
                <span className="font-body-ui text-system-log/50 text-sm">
                  未选分支暂不评分
                </span>
              </div>
            )}
          </div>

          {/* Action bar */}
          <div className="flex items-center gap-2 pt-3 border-t border-outline-variant/50 mt-3">
            <button
              onClick={onExpand}
              disabled={node.is_expanded}
              className="flex-1 px-3 py-2 bg-primary-container text-surface-container-low font-body-ui
                         rounded-lg hover:opacity-90 transition-opacity disabled:opacity-40 text-sm"
            >
              <span className="material-symbols-outlined text-sm align-middle mr-1">
                unfold_more
              </span>
              {node.is_expanded ? "已展开" : "展开"}
            </button>
            <button
              onClick={onEvaluate}
              className="flex-1 px-3 py-2 bg-secondary-container text-surface-container-low font-body-ui
                         rounded-lg hover:opacity-90 transition-opacity text-sm"
            >
              <span className="material-symbols-outlined text-sm align-middle mr-1">
                analytics
              </span>
              重新评估
            </button>
            <button
              onClick={onGetMutation}
              disabled={mutationSuggestion?.nodeId === node.id && mutationSuggestion.loading}
              className="flex-1 px-3 py-2 bg-tertiary-container text-surface-container-low font-body-ui
                         rounded-lg hover:opacity-90 transition-opacity disabled:opacity-40 text-sm"
            >
              <span className="material-symbols-outlined text-sm align-middle mr-1">
                transform
              </span>
              {mutationSuggestion?.nodeId === node.id && mutationSuggestion.loading
                ? "分析中..."
                : "获取变异建议"}
            </button>
            {!isPathEndpoint && node.children_ids.length === 0 && (
              <button
                onClick={onSelectPath}
                className="flex-1 px-3 py-2 bg-tertiary-container text-surface-container-low font-body-ui
                           rounded-lg hover:opacity-90 transition-opacity text-sm"
              >
                <span className="material-symbols-outlined text-sm align-middle mr-1">
                  flag
                </span>
                选为路径终点
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
