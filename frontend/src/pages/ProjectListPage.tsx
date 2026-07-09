import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useProject } from "../hooks/useProject";
import api, { ProjectSummary } from "../api/client";
import GlassPanel from "../components/shared/GlassPanel";

const STAGE_LABELS: Record<string, string> = {
  INIT: "初始化",
  STAGE1: "概念讨论",
  STAGE2: "世界观+角色",
  STAGE3: "情节头脑风暴",
  STAGE4: "写作中心",
  COMPLETED: "已完成",
};

const STAGE_COLORS: Record<string, string> = {
  INIT: "bg-system-log/20 text-system-log",
  STAGE1: "bg-blue-500/20 text-blue-300",
  STAGE2: "bg-purple-500/20 text-purple-300",
  STAGE3: "bg-amber-500/20 text-amber-300",
  STAGE4: "bg-primary-container/20 text-primary-container",
  COMPLETED: "bg-green-500/20 text-green-300",
};

const GENRES: Record<string, string> = {
  cool_novel: "爽文",
  xianxia: "仙侠",
  xuanhuan: "玄幻",
  dushi: "都市",
  kehuan: "科幻",
};

type CreateStep = "intent" | "settings";

export default function ProjectListPage() {
  const navigate = useNavigate();
  const { createProject, loading: creating, error: createError, clearError } = useProject();

  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createStep, setCreateStep] = useState<CreateStep>("intent");
  const [intent, setIntent] = useState("");
  const [title, setTitle] = useState("");
  const [genre, setGenre] = useState("cool_novel");
  const [minWords, setMinWords] = useState(4000);
  const [deleteTarget, setDeleteTarget] = useState<ProjectSummary | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState("");
  const [showBulkDeleteModal, setShowBulkDeleteModal] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);

  useEffect(() => {
    loadProjects();
  }, []);

  const loadProjects = async () => {
    try {
      const p = await api.listProjects();
      setProjects(Array.isArray(p) ? p : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载项目列表失败");
    } finally {
      setLoading(false);
    }
  };

  const visibleProjects = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return projects;
    return projects.filter((p) => p.title.toLowerCase().includes(q));
  }, [projects, searchQuery]);

  const exitSelectMode = () => {
    setSelectMode(false);
    setSelectedIds(new Set());
  };

  const toggleSelected = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const openCreate = () => {
    setCreateStep("intent");
    setIntent("");
    setTitle("");
    setGenre("cool_novel");
    setMinWords(4000);
    clearError();
    setShowCreateModal(true);
  };

  const handleCreateNext = () => {
    if (!intent.trim()) return;
    setCreateStep("settings");
  };

  const handleCreateSubmit = async () => {
    if (!intent.trim()) return;
    try {
      const project = await createProject(intent, genre, minWords, title.trim() || undefined);
      try {
        await api.advance(project.id, "STAGE1");
      } catch {
        // proceed even if advance fails
      }
      setShowCreateModal(false);
      navigate(`/project/${project.id}/stage1`);
    } catch {
      // error handled by hook
    }
  };

  const handleDeleteConfirm = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await api.deleteProject(deleteTarget.id);
      setProjects((prev) => prev.filter((p) => p.id !== deleteTarget.id));
      setDeleteTarget(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "删除失败");
    } finally {
      setDeleting(false);
    }
  };

  const handleBulkDeleteConfirm = async () => {
    if (selectedIds.size === 0) return;
    setBulkDeleting(true);
    try {
      const ids = Array.from(selectedIds);
      const result = await api.bulkDeleteProjects(ids);
      setProjects((prev) => prev.filter((p) => !result.deleted.includes(p.id)));
      setShowBulkDeleteModal(false);
      if (result.failed.length === 0) {
        exitSelectMode();
      } else {
        const failedIds = new Set(result.failed.map((f) => f.id));
        setSelectedIds(failedIds);
        setError(
          `已删除 ${result.deleted_count} 个，${result.failed_count} 个失败：` +
            result.failed.map((f) => `${f.id} (${f.error})`).join("、"),
        );
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "批量删除失败");
    } finally {
      setBulkDeleting(false);
    }
  };

  return (
    <div className="min-h-screen bg-canvas-bg">
      {/* Header */}
      <header className="border-b border-outline-variant bg-surface-container-low/50">
        <div className="max-w-5xl mx-auto px-6 py-6 flex items-center justify-between">
          <div>
            <h1 className="font-display-lg text-primary-container">项目中心</h1>
            <p className="font-body-ui text-system-log mt-1">
              AI 驱动的创意叙事操作系统
            </p>
          </div>
          <div className="flex items-center gap-3">
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
              onClick={() => {
                if (selectMode) exitSelectMode();
                else setSelectMode(true);
              }}
              className={`btn-ghost flex items-center gap-2 ${selectMode ? "border border-primary-container" : ""}`}
              aria-label={selectMode ? "退出多选" : "多选"}
            >
              <span className="material-symbols-outlined text-lg">
                {selectMode ? "check_box" : "check_box_outline_blank"}
              </span>
              {selectMode ? "退出多选" : "多选"}
            </button>
            <button
              onClick={openCreate}
              className="btn-ghost flex items-center gap-2"
            >
              <span className="material-symbols-outlined text-lg">add</span>
              新建项目
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-8">
        {error && (
          <div className="p-4 bg-error/10 border border-error/30 rounded-lg text-error font-body-ui text-sm mb-6">
            {error}
          </div>
        )}

        {selectMode && (
          <div
            data-testid="bulk-action-bar"
            className="sticky top-2 z-10 mb-4 bg-surface-container-low border border-primary-container/40
                       rounded-lg px-4 py-2 flex items-center gap-3 shadow-lg shadow-black/20
                       animate-[slideDown_150ms_ease-out]"
          >
            <button
              onClick={exitSelectMode}
              className="flex items-center gap-1 text-system-log hover:text-primary text-sm"
            >
              <span className="material-symbols-outlined text-lg">close</span>
              取消多选
            </button>
            <span className="text-sm font-label-mono text-primary">
              已选 {selectedIds.size} 项
            </span>
            <div className="flex-1" />
            <button
              onClick={() => setSelectedIds(new Set(visibleProjects.map((p) => p.id)))}
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
              onClick={() => setShowBulkDeleteModal(true)}
              disabled={selectedIds.size === 0}
              className="flex items-center gap-1 px-3 py-1 bg-error text-surface-container-low
                         text-sm rounded hover:opacity-90 disabled:opacity-40"
            >
              <span className="material-symbols-outlined text-base">delete</span>
              批量删除 ({selectedIds.size})
            </button>
          </div>
        )}

        {loading ? (
          <div className="text-center py-24">
            <span className="material-symbols-outlined text-3xl text-system-log/30 animate-spin">
              progress_activity
            </span>
          </div>
        ) : projects.length === 0 ? (
          /* Empty state */
          <div className="text-center py-24">
            <span className="material-symbols-outlined text-6xl text-system-log/20 mb-4 block">
              auto_stories
            </span>
            <h2 className="font-headline-md text-primary mb-2">开始你的第一个故事</h2>
            <p className="font-body-ui text-system-log mb-6 max-w-md mx-auto">
              StoryForge 提供从概念生成到场景写作的端到端 AI 辅助，帮助你完成网文创作。
            </p>
            <button
              onClick={openCreate}
              className="btn-ghost inline-flex items-center gap-2"
            >
              <span className="material-symbols-outlined">rocket_launch</span>
              创建新项目
            </button>
          </div>
        ) : visibleProjects.length === 0 ? (
          /* Zero-match empty state */
          <div className="text-center py-24">
            <span className="material-symbols-outlined text-6xl text-system-log/20 mb-4 block">
              search_off
            </span>
            <h2 className="font-headline-md text-primary mb-2">无匹配项目</h2>
            <p className="font-body-ui text-system-log mb-6 max-w-md mx-auto">
              没有标题包含「{searchQuery}」的项目。
            </p>
            <button
              onClick={() => setSearchQuery("")}
              className="btn-ghost inline-flex items-center gap-2"
              title="清空搜索"
            >
              <span className="material-symbols-outlined" aria-hidden="true">close</span>
              清空搜索
            </button>
          </div>
        ) : (
          <>
            {searchQuery.trim() && (
              <div className="text-right font-label-mono text-xs text-system-log mb-3">
                {visibleProjects.length} 个匹配项 / 共 {projects.length} 个
              </div>
            )}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {visibleProjects.map((p) => (
                <GlassPanel
                  key={p.id}
                  className={`transition-colors group relative ${
                    selectedIds.has(p.id)
                      ? "border-primary-container"
                      : "hover:border-primary-container/30"
                  }`}
                >
                  {selectMode ? (
                    <button
                      type="button"
                      onClick={() => toggleSelected(p.id)}
                      className="w-full text-left cursor-pointer flex items-start gap-3 p-0"
                      aria-label={selectedIds.has(p.id) ? "取消选择" : "选择"}
                    >
                      <span
                        className={`material-symbols-outlined text-xl mt-0.5 shrink-0 ${
                          selectedIds.has(p.id) ? "text-primary-container" : "text-system-log/50"
                        }`}
                      >
                        {selectedIds.has(p.id) ? "check_box" : "check_box_outline_blank"}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between mb-3 pr-2">
                          <h3 className="font-headline-md text-primary group-hover:text-primary-container transition-colors">
                            {p.title}
                          </h3>
                          <span
                            className={`text-xs px-2 py-0.5 rounded font-label-mono shrink-0 ${STAGE_COLORS[p.current_stage] || "bg-system-log/20 text-system-log"}`}
                          >
                            {STAGE_LABELS[p.current_stage] || p.current_stage}
                          </span>
                        </div>
                        <div className="flex items-center gap-3 text-xs font-label-mono text-system-log">
                          <span>{GENRES[p.genre] || p.genre}</span>
                          <span>·</span>
                          <span>{p.min_words.toLocaleString()} 字</span>
                          {p.created_at && (
                            <>
                              <span>·</span>
                              <span>{p.created_at.slice(0, 10)}</span>
                            </>
                          )}
                        </div>
                      </div>
                    </button>
                  ) : (
                    <>
                      <button
                        onClick={() => navigate(`/project/${p.id}/stage1`)}
                        className="w-full text-left cursor-pointer"
                      >
                        <div className="flex items-start justify-between mb-3 pr-8">
                          <h3 className="font-headline-md text-primary group-hover:text-primary-container transition-colors">
                            {p.title}
                          </h3>
                          <span
                            className={`text-xs px-2 py-0.5 rounded font-label-mono shrink-0 ${STAGE_COLORS[p.current_stage] || "bg-system-log/20 text-system-log"}`}
                          >
                            {STAGE_LABELS[p.current_stage] || p.current_stage}
                          </span>
                        </div>
                        <div className="flex items-center gap-3 text-xs font-label-mono text-system-log">
                          <span>{GENRES[p.genre] || p.genre}</span>
                          <span>·</span>
                          <span>{p.min_words.toLocaleString()} 字</span>
                          {p.created_at && (
                            <>
                              <span>·</span>
                              <span>{p.created_at.slice(0, 10)}</span>
                            </>
                          )}
                        </div>
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setDeleteTarget(p);
                        }}
                        className="absolute top-3 right-3 p-1.5 rounded text-system-log/50 hover:text-red-400
                                   hover:bg-red-500/10 transition-colors opacity-0 group-hover:opacity-100"
                        title="删除项目"
                      >
                        <span className="material-symbols-outlined text-base">delete</span>
                      </button>
                    </>
                  )}
                </GlassPanel>
              ))}
            </div>
          </>
        )}
      </main>

      {/* Create Project Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
          <div className="bg-surface-container-low border border-outline-variant rounded-lg max-w-lg w-full mx-4 overflow-hidden">
            {/* Modal header */}
            <div className="px-4 py-3 flex items-center justify-between border-b border-outline-variant">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-primary-container">rocket_launch</span>
                <span className="font-label-mono text-primary">新建项目</span>
              </div>
              <button
                onClick={() => setShowCreateModal(false)}
                className="text-system-log hover:text-primary"
              >
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            {/* Step indicator */}
            <div className="flex items-center gap-3 px-6 pt-4 pb-2">
              {(["intent", "settings"] as CreateStep[]).map((s, i) => (
                <div key={s} className="flex items-center gap-2">
                  <div
                    className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-label-mono
                      ${createStep === s
                        ? "bg-primary-container text-surface-container-low"
                        : "bg-surface-container text-system-log"
                      }`}
                  >
                    {i + 1}
                  </div>
                  <span className={`text-xs ${createStep === s ? "text-primary" : "text-system-log"}`}>
                    {s === "intent" ? "创作意图" : "项目设置"}
                  </span>
                  {i === 0 && <div className="w-8 h-px bg-outline-variant" />}
                </div>
              ))}
            </div>

            <div className="p-6">
              {createStep === "intent" ? (
                <>
                  <label className="block font-label-mono text-system-log mb-2 text-xs">故事构思</label>
                  <textarea
                    value={intent}
                    onChange={(e) => { setIntent(e.target.value); clearError(); }}
                    placeholder="例如：一个被家族抛弃的少年，在异世界觉醒了隐藏的血脉之力..."
                    className="w-full h-32 bg-surface-container border border-outline-variant rounded-lg px-4 py-3
                               text-sm text-primary placeholder:text-system-log/50
                               focus:outline-none focus:border-primary-container resize-none"
                    autoFocus
                  />

                  {createError && (
                    <div className="mt-3 p-2 bg-error-container/20 border border-error rounded text-error text-xs">
                      {createError}
                    </div>
                  )}

                  <div className="mt-4 flex justify-end">
                    <button
                      onClick={handleCreateNext}
                      disabled={!intent.trim()}
                      className="px-5 py-2 bg-primary-container text-surface-container-low text-sm
                                 rounded-lg hover:opacity-90 transition-opacity disabled:opacity-40"
                    >
                      下一步
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div className="space-y-4">
                    <div>
                      <label className="block font-label-mono text-system-log mb-1 text-xs">项目名称</label>
                      <input
                        type="text"
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                        placeholder={intent.slice(0, 30) || "输入项目名称"}
                        className="w-full bg-surface-container border border-outline-variant rounded-lg px-3 py-2
                                   text-sm text-primary focus:outline-none focus:border-primary-container"
                      />
                    </div>

                    <div>
                      <label className="block font-label-mono text-system-log mb-1 text-xs">体裁模板</label>
                      <select
                        value={genre}
                        onChange={(e) => setGenre(e.target.value)}
                        className="w-full bg-surface-container border border-outline-variant rounded-lg px-3 py-2
                                   text-sm text-primary focus:outline-none focus:border-primary-container"
                      >
                        {Object.entries(GENRES).map(([k, v]) => (
                          <option key={k} value={k}>{v}</option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block font-label-mono text-system-log mb-1 text-xs">最低字数（字）</label>
                      <input
                        type="number"
                        value={minWords}
                        onChange={(e) => setMinWords(Number(e.target.value))}
                        min={2000}
                        max={20000}
                        step={1000}
                        className="w-full bg-surface-container border border-outline-variant rounded-lg px-3 py-2
                                   text-sm text-primary focus:outline-none focus:border-primary-container"
                      />
                    </div>

                    <div className="bg-surface-container rounded-lg p-3">
                      <span className="font-label-mono text-system-log text-xs">创作意图</span>
                      <p className="text-sm text-primary mt-1">{intent}</p>
                    </div>
                  </div>

                  {createError && (
                    <div className="mt-3 p-2 bg-error-container/20 border border-error rounded text-error text-xs">
                      {createError}
                    </div>
                  )}

                  <div className="mt-5 flex justify-between">
                    <button
                      onClick={() => setCreateStep("intent")}
                      className="px-4 py-2 bg-surface-container text-system-log text-sm
                                 rounded-lg hover:bg-surface-container-low transition-colors"
                    >
                      返回
                    </button>
                    <button
                      onClick={handleCreateSubmit}
                      disabled={creating}
                      className="px-5 py-2 bg-primary-container text-surface-container-low text-sm
                                 rounded-lg hover:opacity-90 transition-opacity disabled:opacity-40"
                    >
                      {creating ? "创建中..." : "创建项目"}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteTarget && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
          <div className="bg-surface-container-low border border-error/30 rounded-lg max-w-md w-full mx-4 overflow-hidden">
            <div className="px-4 py-3 flex items-center justify-between border-b border-outline-variant">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-error">delete</span>
                <span className="font-label-mono text-error">删除项目</span>
              </div>
              <button
                onClick={() => setDeleteTarget(null)}
                disabled={deleting}
                className="text-system-log hover:text-primary disabled:opacity-30"
              >
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            <div className="p-6 space-y-4">
              <p className="font-body-narrative text-primary text-sm leading-relaxed">
                确定要删除项目 <span className="font-display text-error">{deleteTarget.title}</span> 吗？
              </p>
              <p className="font-body-ui text-system-log text-xs">
                所有概念、大纲、章节、模拟记录将被永久清除，此操作不可撤销。
              </p>
              <div className="flex justify-end gap-3 pt-2">
                <button
                  onClick={() => setDeleteTarget(null)}
                  disabled={deleting}
                  className="px-4 py-2 bg-surface-container text-system-log text-sm
                             rounded-lg hover:bg-surface-container-low transition-colors disabled:opacity-40"
                >
                  取消
                </button>
                <button
                  onClick={handleDeleteConfirm}
                  disabled={deleting}
                  className="px-4 py-2 bg-error text-surface-container-low text-sm
                             rounded-lg hover:opacity-90 transition-opacity disabled:opacity-40"
                >
                  {deleting ? "删除中..." : "确认删除"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Bulk Delete Confirmation Modal */}
      {showBulkDeleteModal && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
          <div className="bg-surface-container-low border border-error/30 rounded-lg max-w-lg w-full mx-4 overflow-hidden relative">
            <button
              onClick={() => setShowBulkDeleteModal(false)}
              disabled={bulkDeleting}
              className="absolute top-3 right-3 text-system-log hover:text-primary disabled:opacity-30 z-10"
            >
              <span className="material-symbols-outlined">close</span>
            </button>
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
                      <span
                        className={`text-xs px-2 py-0.5 rounded font-label-mono shrink-0 ${STAGE_COLORS[p.current_stage] || "bg-system-log/20 text-system-log"}`}
                      >
                        {STAGE_LABELS[p.current_stage] || p.current_stage}
                      </span>
                    </div>
                  ))}
                {projects.filter((p) => selectedIds.has(p.id)).length > 20 && (
                  <div className="px-3 py-2 text-xs text-system-log text-center">
                    + {projects.filter((p) => selectedIds.has(p.id)).length - 20} 项未显示
                  </div>
                )}
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button
                  onClick={() => setShowBulkDeleteModal(false)}
                  disabled={bulkDeleting}
                  className="px-4 py-2 bg-surface-container text-system-log text-sm
                             rounded-lg hover:bg-surface-container-low transition-colors disabled:opacity-40"
                >
                  取消
                </button>
                <button
                  onClick={handleBulkDeleteConfirm}
                  disabled={bulkDeleting}
                  className="px-4 py-2 bg-error text-surface-container-low text-sm
                             rounded-lg hover:opacity-90 transition-opacity disabled:opacity-40"
                >
                  {bulkDeleting ? "删除中..." : "确认删除"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
