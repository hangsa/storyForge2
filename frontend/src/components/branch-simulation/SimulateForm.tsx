import { useCallback } from "react";

interface SimulateFormProps {
  description: string;
  onDescriptionChange: (value: string) => void;
  onExecute: () => void;
  loading: boolean;
}

export default function SimulateForm({
  description,
  onDescriptionChange,
  onExecute,
  loading,
}: SimulateFormProps) {
  const handleExecute = useCallback(() => {
    if (description.trim() && !loading) {
      onExecute();
    }
  }, [description, loading, onExecute]);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <span className="material-symbols-outlined text-system-log text-lg">call_split</span>
        <h2 className="font-label-mono text-system-log uppercase tracking-wider text-sm">
          分支模拟
        </h2>
      </div>

      <textarea
        value={description}
        onChange={(e) => onDescriptionChange(e.target.value)}
        placeholder="描述你想探索的分支场景...&#10;例如：如果把女主角的隐藏身份提前暴露在第5章，剧情会有什么变化？"
        rows={5}
        className="w-full bg-surface-container border border-outline-variant rounded-lg px-3 py-2.5
                   font-body-narrative text-primary text-sm placeholder:text-system-log/40
                   focus:outline-none focus:ring-2 focus:ring-primary-container/50 resize-none"
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            handleExecute();
          }
        }}
      />

      <button
        onClick={handleExecute}
        disabled={!description.trim() || loading}
        className="w-full px-4 py-2.5 bg-primary-container text-surface-container-low font-body-ui
                   rounded-lg hover:opacity-90 transition-opacity disabled:opacity-40"
      >
        {loading ? (
          <>
            <span className="material-symbols-outlined text-sm animate-spin align-middle mr-1.5">
              progress_activity
            </span>
            分析中...
          </>
        ) : (
          <>
            <span className="material-symbols-outlined text-sm align-middle mr-1.5">
              play_arrow
            </span>
            执行模拟
          </>
        )}
      </button>
    </div>
  );
}
