import { useMemo, useState } from "react";
import type { PromptSummary } from "../../../api/promptPlaza";
import { PROMPT_CATEGORY_LABELS } from "./categoryLabels";

interface Props {
  prompts: PromptSummary[];
  selectedName: string | null;
  onSelect: (name: string) => void;
}

export default function PromptListPanel({ prompts, selectedName, onSelect }: Props) {
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return prompts;
    return prompts.filter(
      (p) => p.name.toLowerCase().includes(q) || p.label.toLowerCase().includes(q),
    );
  }, [prompts, query]);

  const grouped = useMemo(() => {
    const groups = new Map<string, PromptSummary[]>();
    for (const p of filtered) {
      const arr = groups.get(p.category) ?? [];
      arr.push(p);
      groups.set(p.category, arr);
    }
    return groups;
  }, [filtered]);

  if (prompts.length === 0) {
    return (
      <div className="p-4 text-system-log text-sm text-center">
        暂无提示词
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="p-3 border-b border-outline-variant">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索提示词"
          data-testid="plaza-search"
          className="w-full bg-surface-container border border-outline-variant rounded
                     px-3 py-1.5 text-sm text-primary placeholder:text-system-log/50
                     focus:outline-none focus:border-primary-container"
        />
      </div>
      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        {Array.from(grouped.entries()).map(([category, items]) => (
          <div key={category || "_root"}>
            <div className="font-label-mono text-[10px] text-system-log uppercase tracking-wider mb-1.5">
              {PROMPT_CATEGORY_LABELS[category] ?? category}
            </div>
            <div className="space-y-1">
              {items.map((p) => (
                <button
                  key={p.name}
                  type="button"
                  data-testid="plaza-row"
                  data-selected={selectedName === p.name ? "true" : "false"}
                  onClick={() => onSelect(p.name)}
                  className={`w-full flex items-center justify-between gap-2 px-2 py-1.5 rounded text-left text-sm
                              ${selectedName === p.name
                                ? "bg-primary-container/20 text-primary"
                                : "text-primary hover:bg-surface-container"
                              }`}
                >
                  <span className="truncate">{p.label}</span>
                  {p.has_override && (
                    <span
                      data-testid="override-dot"
                      className="shrink-0 w-2 h-2 rounded-full bg-primary-container"
                      title={`已自定义 ${p.modified_at ?? ""}`}
                    />
                  )}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}