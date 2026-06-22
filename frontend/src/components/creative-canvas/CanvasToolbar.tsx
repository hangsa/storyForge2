interface CanvasToolbarProps {
  nodeCount: number;
  onRequestReset: () => void;
  onFitView: () => void;
}

const DIMENSION_LEGEND = [
  { label: "角色动机", color: "#7c3aed" },
  { label: "世界观规则", color: "#0891b2" },
  { label: "情节方向", color: "#ea580c" },
  { label: "读者体验", color: "#059669" },
];

export default function CanvasToolbar({ nodeCount, onRequestReset, onFitView }: CanvasToolbarProps) {
  return (
    <div className="absolute top-3 left-3 right-3 z-10 flex items-center justify-between">
      {/* Left: stats */}
      <div className="flex items-center gap-3 bg-surface-container-low/90 backdrop-blur px-3 py-1.5 rounded-lg border border-outline-variant/50">
        <span className="font-label-mono text-xs text-system-log">
          节点: {nodeCount}
        </span>
        <div className="flex items-center gap-2">
          {DIMENSION_LEGEND.map((d) => (
            <div key={d.label} className="flex items-center gap-1">
              <div
                className="w-2.5 h-2.5 rounded-full"
                style={{ backgroundColor: d.color }}
              />
              <span className="font-label-mono text-xs text-system-log/70">{d.label}</span>
            </div>
          ))}
        </div>
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
