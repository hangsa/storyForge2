interface CanvasToolbarProps {
  nodeCount: number;
  activeCount: number;
  showDimmedChildren: boolean;
  onToggleDimmedChildren: () => void;
  onRequestReset: () => void;
  onFitView: () => void;
}

export default function CanvasToolbar({
  nodeCount,
  activeCount,
  showDimmedChildren,
  onToggleDimmedChildren,
  onRequestReset,
  onFitView,
}: CanvasToolbarProps) {
  return (
    <div className="absolute top-3 left-3 right-3 z-10 flex items-center justify-between">
      {/* Left: stats */}
      <div className="flex items-center gap-3 bg-surface-container-low/90 backdrop-blur px-3 py-1.5 rounded-lg border border-outline-variant/50">
        <span className="font-label-mono text-xs text-system-log">
          节点 {nodeCount} / 激活 {activeCount}
        </span>
        <button
          onClick={onToggleDimmedChildren}
          className={`px-2 py-1 text-xs rounded font-label-mono transition-colors ${
            showDimmedChildren
              ? "bg-primary-container/20 text-primary-container"
              : "bg-surface-container text-system-log hover:text-primary"
          }`}
        >
          {showDimmedChildren ? "隐藏未选子树" : "显示未选子树"}
        </button>
      </div>

      {/* Right: actions */}
      <div className="flex items-center gap-2">
        <button
          onClick={onFitView}
          className="p-1.5 bg-surface-container-low/90 backdrop-blur rounded-lg border border-outline-variant/50
                     text-system-log hover:text-primary transition-colors"
          title="适应视图"
        >
          <span className="material-symbols-outlined text-lg">fit_screen</span>
        </button>
        <button
          onClick={onRequestReset}
          className="p-1.5 bg-surface-container-low/90 backdrop-blur rounded-lg border border-outline-variant/50
                     text-system-log hover:text-red-400 transition-colors"
          title="重置画布"
        >
          <span className="material-symbols-outlined text-lg">restart_alt</span>
        </button>
      </div>
    </div>
  );
}
