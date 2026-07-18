import { useState, useEffect } from "react";
import { ProjectStats } from "../../api/client";
import StatCard from "./StatCard";
import StageDistribution from "./StageDistribution";
import QuickActions from "./QuickActions";

const COLLAPSED_KEY = "storyforge.home.sidebar.collapsed";
const EXPANDED_WIDTH = "w-[300px]";
const COLLAPSED_WIDTH = "w-[52px]";

interface StatsSidebarProps {
  stats: ProjectStats | null;
  statsLoading: boolean;
  onRefresh: () => void;
  refreshing: boolean;
}

export default function StatsSidebar({
  stats,
  statsLoading,
  onRefresh,
  refreshing,
}: StatsSidebarProps) {
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem(COLLAPSED_KEY) === "true";
    } catch {
      return false;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(COLLAPSED_KEY, String(collapsed));
    } catch {
      // ignore
    }
  }, [collapsed]);

  const toggle = () => setCollapsed((v) => !v);

  return (
    <aside
      data-testid="stats-sidebar"
      data-collapsed={collapsed ? "true" : "false"}
      className={`${collapsed ? COLLAPSED_WIDTH : EXPANDED_WIDTH} shrink-0 border-r border-outline-variant bg-surface-container-lowest flex flex-col transition-[width] duration-150`}
    >
      <div className="px-4 py-4 border-b border-outline-variant flex items-center justify-between">
        {!collapsed && (
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-primary-container text-2xl">
              auto_stories
            </span>
            <span className="font-display text-primary text-lg">StoryForge</span>
          </div>
        )}
        <button
          onClick={toggle}
          aria-label={collapsed ? "展开侧边栏" : "收起侧边栏"}
          data-testid="sidebar-toggle"
          className="text-system-log hover:text-primary ml-auto"
        >
          <span className="material-symbols-outlined text-xl">
            {collapsed ? "chevron_right" : "chevron_left"}
          </span>
        </button>
      </div>

      {!collapsed && (
        <>
          <section className="p-4 border-b border-outline-variant">
            <div className="font-label-mono text-[10px] text-system-log uppercase tracking-wider mb-2">
              统计
            </div>
            <div className="grid grid-cols-3 gap-2">
              <StatCard label="总书籍" value={stats?.total_books ?? null} />
              <StatCard label="总章节" value={stats?.total_chapters ?? null} />
              <StatCard label="总字数" value={stats?.total_words ?? null} />
            </div>
          </section>

          <section className="p-4 border-b border-outline-variant">
            <div className="font-label-mono text-[10px] text-system-log uppercase tracking-wider mb-2">
              阶段分布
            </div>
            <StageDistribution distribution={stats?.stage_distribution ?? null} />
          </section>

          <section className="p-4">
            <div className="font-label-mono text-[10px] text-system-log uppercase tracking-wider mb-2">
              快捷操作
            </div>
            <QuickActions onRefresh={onRefresh} refreshing={refreshing} />
            {statsLoading && (
              <div className="mt-3 text-[10px] font-label-mono text-system-log/60">
                加载中…
              </div>
            )}
          </section>
        </>
      )}

      {collapsed && (
        <div className="flex-1 flex flex-col items-center pt-3 gap-3">
          <span className="material-symbols-outlined text-primary-container text-2xl">
            auto_stories
          </span>
          <div className="flex-1 w-full px-2">
            <QuickActions onRefresh={onRefresh} refreshing={refreshing} />
          </div>
        </div>
      )}
    </aside>
  );
}
