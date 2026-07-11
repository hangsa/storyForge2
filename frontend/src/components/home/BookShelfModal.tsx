import { useState, useMemo } from "react";
import { ProjectSummary } from "../../api/client";
import { isPreWizardStage } from "./stages";

const STAGE_COLORS: Record<string, string> = {
  INIT: "bg-system-log/20 text-system-log",
  STAGE1: "bg-blue-500/20 text-blue-300",
  STAGE2: "bg-purple-500/20 text-purple-300",
  STAGE3: "bg-amber-500/20 text-amber-300",
  STAGE4: "bg-primary-container/20 text-primary-container",
  STAGE5: "bg-pink-500/20 text-pink-300",
  STAGE6: "bg-emerald-500/20 text-emerald-300",
  COMPLETED: "bg-green-500/20 text-green-300",
};

const STAGE_LABELS: Record<string, string> = {
  INIT: "初始化",
  STAGE1: "概念",
  STAGE2: "世界观",
  STAGE3: "大纲",
  STAGE4: "工作台",
  STAGE5: "诊断",
  STAGE6: "导出",
  COMPLETED: "已完成",
};

const GENRES: Record<string, string> = {
  cool_novel: "爽文",
  xianxia: "仙侠",
  xuanhuan: "玄幻",
  dushi: "都市",
  kehuan: "科幻",
};

interface BookShelfModalProps {
  projects: ProjectSummary[];
  onClose: () => void;
}

export default function BookShelfModal({ projects, onClose }: BookShelfModalProps) {
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return projects;
    return projects.filter((p) => p.title.toLowerCase().includes(q));
  }, [projects, query]);

  return (
    <div
      data-testid="book-shelf-modal"
      className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-8"
    >
      <div className="bg-surface-container-lowest border border-outline-variant rounded-lg w-full max-w-6xl max-h-[90vh] flex flex-col">
        <div className="px-6 py-4 flex items-center justify-between border-b border-outline-variant">
          <div className="flex items-center gap-3">
            <h2 className="font-headline-md text-primary">全部项目</h2>
            <span className="font-label-mono text-xs text-system-log">
              共 {projects.length} 本
            </span>
          </div>
          <div className="flex items-center gap-3">
            <div className="relative">
              <span className="material-symbols-outlined text-base absolute left-3 top-1/2 -translate-y-1/2 text-system-log/60 pointer-events-none">
                search
              </span>
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="搜索"
                className="w-60 bg-surface-container border border-outline-variant rounded-lg
                           pl-9 pr-3 py-1.5 text-sm text-primary placeholder:text-system-log/50
                           focus:outline-none focus:border-primary-container"
              />
            </div>
            <button
              onClick={onClose}
              aria-label="关闭"
              className="text-system-log hover:text-primary"
            >
              <span className="material-symbols-outlined">close</span>
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {filtered.map((p) => {
              const href = isPreWizardStage(p.current_stage)
                ? `/project/${encodeURIComponent(p.id)}/wizard`
                : `/project/${encodeURIComponent(p.id)}/workspace?mode=managed`;
              return (
              <a
                key={p.id}
                href={href}
                className="block bg-surface-container-low border border-outline-variant rounded-lg p-4
                           hover:border-primary-container/40 transition-colors"
              >
                <div className="flex items-start justify-between mb-2 gap-2">
                  <h3 className="font-headline-md text-primary truncate">{p.title}</h3>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded font-label-mono shrink-0 ${STAGE_COLORS[p.current_stage] || "bg-system-log/20 text-system-log"}`}>
                    {STAGE_LABELS[p.current_stage] || p.current_stage}
                  </span>
                </div>
                <div className="flex items-center gap-2 text-xs font-label-mono text-system-log">
                  <span>{GENRES[p.genre] || p.genre}</span>
                  <span>·</span>
                  <span>
                    {p.target_length_category || `${(p.target_total_words / 10000).toFixed(0)}万字`}
                  </span>
                </div>
              </a>
              );
            })}
          </div>
          {filtered.length === 0 && (
            <div className="text-center py-12 text-system-log">未找到匹配项目</div>
          )}
        </div>
      </div>
    </div>
  );
}