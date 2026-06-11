import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
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

export default function ProjectListPage() {
  const navigate = useNavigate();
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadProjects();
  }, []);

  const loadProjects = async () => {
    try {
      const data = await api.listProjects();
      setProjects(Array.isArray(data?.detail) ? data.detail : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载项目列表失败");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-canvas-bg">
      {/* Header */}
      <header className="border-b border-outline-variant bg-surface-container-low/50">
        <div className="max-w-5xl mx-auto px-6 py-6 flex items-center justify-between">
          <div>
            <h1 className="font-display-lg text-primary-container">StoryForge</h1>
            <p className="font-body-ui text-system-log mt-1">
              AI 驱动的创意叙事操作系统
            </p>
          </div>
          <button
            onClick={() => navigate("/init")}
            className="btn-ghost flex items-center gap-2"
          >
            <span className="material-symbols-outlined text-lg">add</span>
            新建项目
          </button>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-8">
        {error && (
          <div className="p-4 bg-error/10 border border-error/30 rounded-lg text-error font-body-ui text-sm mb-6">
            {error}
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
              onClick={() => navigate("/init")}
              className="btn-ghost inline-flex items-center gap-2"
            >
              <span className="material-symbols-outlined">rocket_launch</span>
              创建新项目
            </button>
          </div>
        ) : (
          /* Project grid */
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {projects.map((p) => (
              <GlassPanel
                key={p.id}
                className="cursor-pointer hover:border-primary-container/30 transition-colors group"
              >
                <button
                  onClick={() => navigate(`/project/${p.id}/stage1`)}
                  className="w-full text-left"
                >
                  <div className="flex items-start justify-between mb-3">
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
                    <span>{p.genre === "cool_novel" ? "爽文" : p.genre}</span>
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
              </GlassPanel>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
