import { useState, useMemo } from "react";
import api, { ProjectSummary } from "../../api/client";
import BookShelfModal from "./BookShelfModal";
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

const DEFAULT_VISIBLE = 5;

interface BookShelfProps {
  /** Caller owns the fetch — pass the resolved project list here. */
  projects: ProjectSummary[];
  /** True while the caller's fetch is still in flight. */
  loading: boolean;
  /** Called after a successful bulk-delete with the IDs the backend removed,
   *  so the parent can prune its own copy of the project list. */
  onProjectsDeleted: (deletedIds: string[]) => void;
}

export default function BookShelf({ projects, loading, onProjectsDeleted }: BookShelfProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showModal, setShowModal] = useState(false);
  const [showBulkConfirm, setShowBulkConfirm] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);

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

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const exitSelectMode = () => {
    setSelectMode(false);
    setSelectedIds(new Set());
  };

  const handleBulkDeleteConfirm = async () => {
    if (selectedIds.size === 0) return;
    setBulkDeleting(true);
    setBulkError(null);
    try {
      const ids = Array.from(selectedIds);
      const result = await api.bulkDeleteProjects(ids);
      onProjectsDeleted(result.deleted);
      setShowBulkConfirm(false);
      if (result.failed.length === 0) {
        exitSelectMode();
      } else {
        const failedIds = new Set(result.failed.map((f) => f.id));
        setSelectedIds(failedIds);
        setBulkError(
          `已删除 ${result.deleted_count} 个，${result.failed_count} 个失败：` +
            result.failed.map((f) => `${f.id} (${f.error})`).join("、"),
        );
      }
    } catch (e) {
      setBulkError(e instanceof Error ? e.message : "批量删除失败");
    } finally {
      setBulkDeleting(false);
    }
  };

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
        <button
          onClick={() => (selectMode ? exitSelectMode() : setSelectMode(true))}
          data-testid="select-toggle"
          className={`btn-ghost flex items-center gap-2 ${selectMode ? "border border-primary-container" : ""}`}
        >
          <span className="material-symbols-outlined text-lg">
            {selectMode ? "check_box" : "check_box_outline_blank"}
          </span>
          {selectMode ? "退出多选" : "多选"}
        </button>
      </header>

      {selectMode && (
        <div
          data-testid="bulk-action-bar"
          className="sticky top-2 z-10 bg-surface-container-low border border-primary-container/40
                     rounded-lg px-4 py-2 flex items-center gap-3 shadow-lg shadow-black/20"
        >
          <span className="text-sm font-label-mono text-primary">
            已选 {selectedIds.size} 项
          </span>
          <div className="flex-1" />
          <button
            onClick={() => setSelectedIds(new Set(filtered.map((p) => p.id)))}
            className="text-sm text-system-log hover:text-primary"
          >
            全选可见
          </button>
          <button
            onClick={() => setSelectedIds(new Set())}
            disabled={selectedIds.size === 0}
            className="text-sm text-system-log hover:text-primary disabled:opacity-40"
          >
            全不选
          </button>
          <button
            onClick={() => setShowBulkConfirm(true)}
            disabled={selectedIds.size === 0}
            data-testid="bulk-delete-button"
            className="flex items-center gap-1 px-3 py-1 bg-error text-surface-container-low
                       text-sm rounded hover:opacity-90 disabled:opacity-40"
          >
            <span className="material-symbols-outlined text-base">delete</span>
            批量删除 ({selectedIds.size})
          </button>
        </div>
      )}

      {bulkError && (
        <div className="p-3 bg-error/10 border border-error/30 rounded text-error text-xs">
          {bulkError}
        </div>
      )}

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
              <BookCard
                key={p.id}
                project={p}
                selectMode={selectMode}
                selected={selectedIds.has(p.id)}
                onToggle={() => toggleSelect(p.id)}
              />
            ))}
          </div>
          {filtered.length > DEFAULT_VISIBLE && (
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
        />
      )}

      {showBulkConfirm && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
          <div className="bg-surface-container-low border border-error/30 rounded-lg max-w-lg w-full mx-4 overflow-hidden">
            <div className="px-4 py-3 flex items-center gap-2 border-b border-outline-variant">
              <span className="material-symbols-outlined text-error">delete</span>
              <span className="font-label-mono text-error">
                批量删除 {selectedIds.size} 个项目
              </span>
            </div>
            <div className="p-6 space-y-4">
              <p className="font-body-ui text-system-log text-xs">
                将永久删除以下项目及其所有数据（概念、大纲、章节、模拟记录），此操作不可撤销。
              </p>
              <div className="max-h-60 overflow-y-auto border border-outline-variant rounded">
                {projects
                  .filter((p) => selectedIds.has(p.id))
                  .slice(0, 20)
                  .map((p) => (
                    <div
                      key={p.id}
                      className="flex items-center justify-between px-3 py-2 border-b border-outline-variant last:border-b-0"
                    >
                      <span className="font-display text-primary text-sm truncate pr-3">
                        {p.title}
                      </span>
                      <span className={`text-xs px-2 py-0.5 rounded font-label-mono shrink-0 ${STAGE_COLORS[p.current_stage] || "bg-system-log/20 text-system-log"}`}>
                        {STAGE_LABELS[p.current_stage] || p.current_stage}
                      </span>
                    </div>
                  ))}
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button
                  onClick={() => setShowBulkConfirm(false)}
                  disabled={bulkDeleting}
                  className="px-4 py-2 bg-surface-container text-system-log text-sm
                             rounded-lg hover:bg-surface-container-low disabled:opacity-40"
                >
                  取消
                </button>
                <button
                  onClick={handleBulkDeleteConfirm}
                  disabled={bulkDeleting}
                  className="px-4 py-2 bg-error text-surface-container-low text-sm
                             rounded-lg hover:opacity-90 disabled:opacity-40"
                >
                  {bulkDeleting ? "删除中…" : "确认删除"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

interface BookCardProps {
  project: ProjectSummary;
  selectMode: boolean;
  selected: boolean;
  onToggle: () => void;
}

function BookCard({ project, selectMode, selected, onToggle }: BookCardProps) {
  const handleClick = () => {
    if (selectMode) {
      onToggle();
      return;
    }
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
      data-selected={selected ? "true" : "false"}
      onClick={handleClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          handleClick();
        }
      }}
      className={`shrink-0 w-[260px] bg-surface-container-low border rounded-lg p-4 cursor-pointer
                  transition-colors
                  ${selected ? "border-primary-container" : "border-outline-variant hover:border-primary-container/40"}`}
    >
      {selectMode && (
        <div className="mb-2">
          <button
            type="button"
            aria-label="选择"
            onClick={(e) => {
              e.stopPropagation();
              onToggle();
            }}
            className="flex items-center gap-1 text-xs font-label-mono text-system-log hover:text-primary"
          >
            <span className={`material-symbols-outlined text-xl ${selected ? "text-primary-container" : "text-system-log/50"}`}>
              {selected ? "check_box" : "check_box_outline_blank"}
            </span>
            {selected ? "已选" : "选择"}
          </button>
        </div>
      )}
      <div className="flex items-start justify-between mb-2 gap-2">
        <h3 className="font-headline-md text-primary truncate">{project.title}</h3>
        <span className={`text-[10px] px-1.5 py-0.5 rounded font-label-mono shrink-0 ${STAGE_COLORS[project.current_stage] || "bg-system-log/20 text-system-log"}`}>
          {STAGE_LABELS[project.current_stage] || project.current_stage}
        </span>
      </div>
      <div className="flex items-center gap-2 text-xs font-label-mono text-system-log">
        <span>{GENRES[project.genre] || project.genre}</span>
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