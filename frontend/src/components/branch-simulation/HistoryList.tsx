import type { SimulationHistoryItem } from "../../api/client";

interface HistoryListProps {
  items: SimulationHistoryItem[];
  onSelect: (item: SimulationHistoryItem) => void;
  loading: boolean;
}

export default function HistoryList({ items, onSelect, loading }: HistoryListProps) {
  if (items.length === 0) {
    return (
      <div className="text-center py-6">
        <span className="material-symbols-outlined text-3xl text-system-log/20 block mb-2">
          history
        </span>
        <p className="font-body-ui text-system-log/50 text-sm">暂无历史记录</p>
      </div>
    );
  }

  return (
    <div className="space-y-1.5 max-h-[300px] overflow-y-auto">
      {items.map((item) => (
        <button
          key={item.id}
          onClick={() => !loading && onSelect(item)}
          disabled={loading}
          className="w-full text-left p-2.5 bg-surface-container rounded-lg
                     hover:bg-surface-container-high transition-colors
                     disabled:opacity-40 group"
        >
          <p className="font-body-ui text-primary text-sm truncate group-hover:text-primary-container transition-colors">
            {item.description}
          </p>
          <div className="flex items-center gap-2 mt-1">
            <span className="material-symbols-outlined text-xs text-system-log/50">
              calendar_today
            </span>
            <span className="font-label-mono text-xs text-system-log/50">
              {new Date(item.created_at).toLocaleDateString("zh-CN")}
            </span>
          </div>
        </button>
      ))}
    </div>
  );
}
