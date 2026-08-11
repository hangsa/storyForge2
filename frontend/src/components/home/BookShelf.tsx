import { useMemo, useState } from "react";
import { ProjectSummary } from "../../api/client";
import BookShelfModal from "./BookShelfModal";
import { isPreWizardStage } from "./stages";
import { useGenres } from "../../hooks/useGenres";

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

const DEFAULT_VISIBLE = 5;

interface BookShelfProps {
  /** Caller owns the fetch — pass the resolved project list here. */
  projects: ProjectSummary[];
  /** True while the caller's fetch is still in flight. */
  loading: boolean;
  /** Forwarded to BookShelfModal — the modal owns the bulk-delete UI now,
   *  so it needs the same pruning callback the parent used to give us. */
  onProjectsDeleted: (deletedIds: string[]) => void;
}

export default function BookShelf({ projects, loading, onProjectsDeleted }: BookShelfProps) {
  const [searchQuery, setSearchQuery] = useState("");

  const sorted = useMemo(() => {
    return [...projects].sort((a, b) => {
      // Primary: updated_at DESC (most recently updated first).
      if (a.updated_at !== b.updated_at) return b.updated_at - a.updated_at;
      // Fallback: created_at DESC (most recently created first).
      return (b.created_at || "").localeCompare(a.created_at || "");
    });
  }, [projects]);

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return sorted;
    return sorted.filter((p) => p.title.toLowerCase().includes(q));
  }, [sorted, searchQuery]);

  const visible = filtered.slice(0, DEFAULT_VISIBLE);
  const [showModal, setShowModal] = useState(false);

  return (
    <section data-testid="book-shelf" className="space-y-3">
      <header className="flex items-center gap-3 flex-wrap">
        <h2 className="font-headline-md text-primary">书架</h2>
        <span className="font-label-mono text-xs text-system-log">
          {loading ? "加载中…" : `共 ${projects.length} 本`}
        </span>
        <div className="flex-1" />
        <div className="relative">
          <span className="material-symbols-outlined text-base absolute left-3 top-1/2 -translate-y-1/2 text-system-log/60 pointer-events-none">
            search
          </span>
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="搜索项目名称"
            className="w-60 bg-surface-container border border-outline-variant rounded-lg
                       pl-9 pr-3 py-1.5 text-sm text-primary placeholder:text-system-log/50
                       focus:outline-none focus:border-primary-container"
          />
        </div>
      </header>

      {loading ? (
        <div className="text-center py-16 text-system-log/60">
          <span className="material-symbols-outlined text-3xl animate-spin">progress_activity</span>
        </div>
      ) : projects.length === 0 ? (
        <div className="text-center py-16">
          <span className="material-symbols-outlined text-5xl text-system-log/20 mb-3 block">
            auto_stories
          </span>
          <p className="font-body-ui text-system-log">还没有项目，点击新建按钮开始</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16">
          <span className="material-symbols-outlined text-5xl text-system-log/20 mb-3 block">
            search_off
          </span>
          <p className="font-body-ui text-system-log">未找到匹配项目</p>
          <button
            onClick={() => setSearchQuery("")}
            className="mt-3 text-sm font-label-mono text-system-log hover:text-primary"
          >
            清空搜索
          </button>
        </div>
      ) : (
        <>
          <div
            data-testid="book-row"
            className="flex gap-4 overflow-x-auto pb-2"
          >
            {visible.map((p) => (
              <BookCard key={p.id} project={p} />
            ))}
          </div>
          {filtered.length > 1 && (
            <div className="text-center">
              <button
                onClick={() => setShowModal(true)}
                className="text-sm font-label-mono text-system-log hover:text-primary"
              >
                查看全部 ({filtered.length}) →
              </button>
            </div>
          )}
        </>
      )}

      {showModal && (
        <BookShelfModal
          projects={filtered}
          onClose={() => setShowModal(false)}
          onProjectsDeleted={onProjectsDeleted}
        />
      )}
    </section>
  );
}

function BookCard({ project }: { project: ProjectSummary }) {
  const genres = useGenres(false); // include all so labels render for any project genre
  const labelByGenre = Object.fromEntries(genres.map((g) => [g.id, g.label_zh]));

  const handleClick = () => {
    // Pre-wizard stages (INIT, STAGE1, STAGE2, STAGE3) are mid-initialization —
    // open the wizard so the user can continue from the latest step they
    // reached. Only STAGE4+ means the wizard finished and we should drop the
    // user into the workspace (v1.8: /workspace is the project's day-to-day
    // hub — /stage1 only exists for the inline concept editor).
    const href = isPreWizardStage(project.current_stage)
      ? `/project/${encodeURIComponent(project.id)}/wizard`
      : `/project/${encodeURIComponent(project.id)}/workspace`;
    window.location.assign(href);
  };

  return (
    <div
      data-testid="book-card"
      onClick={handleClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          handleClick();
        }
      }}
      className="shrink-0 w-[260px] bg-surface-container-low border rounded-lg p-4 cursor-pointer
                  transition-colors border-outline-variant hover:border-primary-container/40"
    >
      <div className="flex items-start justify-between mb-2 gap-2">
        <h3 className="font-headline-md text-primary truncate">{project.title}</h3>
        <span className={`text-[10px] px-1.5 py-0.5 rounded font-label-mono shrink-0 ${STAGE_COLORS[project.current_stage] || "bg-system-log/20 text-system-log"}`}>
          {STAGE_LABELS[project.current_stage] || project.current_stage}
        </span>
      </div>
      <div className="flex items-center gap-2 text-xs font-label-mono text-system-log">
        <span>{labelByGenre[project.genre] || project.genre}</span>
        <span>·</span>
        <span>
          {project.target_length_category || `${(project.target_total_words / 10000).toFixed(0)}万字`}
        </span>
        {project.created_at && (
          <>
            <span>·</span>
            <span>{project.created_at.slice(0, 10)}</span>
          </>
        )}
      </div>
    </div>
  );
}