interface CanvasEmptyStateProps {
  onInit: (premise: string) => void;
  loading: boolean;
  error: string | null;
  defaultPremise?: string;
}

export default function CanvasEmptyState({ onInit, loading, error, defaultPremise }: CanvasEmptyStateProps) {
  return (
    <div className="flex items-center justify-center h-full">
      <div className="max-w-lg w-full mx-auto text-center px-6">
        <span className="material-symbols-outlined text-6xl text-system-log/20 mb-4 block">
          account_tree
        </span>
        <h2 className="font-display text-2xl text-primary-container mb-2">创意画布</h2>
        <p className="font-body-ui text-system-log mb-6 leading-relaxed">
          通过 WhatIf 树形结构可视化探索故事的不同发展方向。输入故事前提，开始构建创意分支。
        </p>

        <div className="space-y-3">
          <div className="flex gap-2">
            <input
              id="premise-input"
              type="text"
              defaultValue={defaultPremise || ""}
              placeholder="输入故事前提，例如：一个关于永生者寻找死亡方法的故事"
              className="flex-1 bg-surface-container border border-outline-variant rounded-lg px-3 py-2.5
                         font-body-ui text-primary text-sm placeholder:text-system-log/40
                         focus:outline-none focus:ring-2 focus:ring-primary-container/50"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  const input = e.currentTarget.value.trim();
                  if (input) onInit(input);
                }
              }}
            />
            <button
              onClick={() => {
                const input = (document.getElementById("premise-input") as HTMLInputElement)?.value.trim();
                if (input) onInit(input);
              }}
              disabled={loading}
              className="px-5 py-2.5 bg-primary-container text-surface-container-low font-body-ui
                         rounded-lg hover:opacity-90 transition-opacity disabled:opacity-40 whitespace-nowrap"
            >
              {loading ? (
                <>
                  <span className="material-symbols-outlined text-sm animate-spin align-middle mr-1">
                    progress_activity
                  </span>
                  初始化中...
                </>
              ) : (
                "开始探索"
              )}
            </button>
          </div>

          {error && (
            <div className="p-3 bg-error-container/20 border border-error rounded-lg text-error font-body-ui text-sm">
              {error}
            </div>
          )}

          {/* Quick start suggestions */}
          <div className="grid grid-cols-2 gap-2 mt-4">
            {[
              "虚拟现实中寻找真爱",
              "末日世界的最后一座城市",
              "时间旅行者的伦理困境",
              "人工智能获得自我意识",
            ].map((suggestion) => (
              <button
                key={suggestion}
                onClick={() => onInit(suggestion)}
                disabled={loading}
                className="text-left px-3 py-2 bg-surface-container rounded-lg
                           text-system-log font-body-ui text-xs hover:text-primary
                           hover:bg-surface-container-high transition-colors
                           disabled:opacity-40 truncate"
              >
                {suggestion}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
