import { Outlet, useNavigate } from "react-router-dom";
import { useState, useCallback, useEffect } from "react";
import api, { type ProjectSummary } from "../../api/client";
import StatsSidebar from "../home/StatsSidebar";
import CreateProjectModal from "../home/CreateProjectModal";
import { useProjectStats } from "../../hooks/useProjectStats";
import { useToast } from "../../hooks/useToast";
import { BrandHeader } from "../ds";

export interface HomeOutletContext {
  projects: ProjectSummary[];
  projectsLoading: boolean;
  handleProjectsDeleted: (deletedIds: string[]) => void;
  handleResumeWizard: (projectId: string) => void;
  handleOpenCreate: () => void;
  loadProjects: () => Promise<unknown>;
}

export default function HomeLayout() {
  const { stats, loading: statsLoading } = useProjectStats();
  const toast = useToast();
  const navigate = useNavigate();
  const [submitting, setSubmitting] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  // v1.8.2: single source of truth for the project list. BookShelf used to
  // fetch /api/project/list on its own, doubling the round-trip on every
  // home-page mount. Now HomeLayout fetches once and shares via Outlet context.
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(true);

  const loadProjects = useCallback(() => {
    setProjectsLoading(true);
    return api.listProjects()
      .then((list) => setProjects(Array.isArray(list) ? list : []))
      .catch(() => setProjects([]))
      .finally(() => setProjectsLoading(false));
  }, []);

  useEffect(() => {
    let cancelled = false;
    setProjectsLoading(true);
    api.listProjects()
      .then((list) => {
        if (cancelled) return;
        setProjects(Array.isArray(list) ? list : []);
      })
      .catch(() => { if (!cancelled) setProjects([]); })
      .finally(() => { if (!cancelled) setProjectsLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const handleProjectsDeleted = useCallback((deletedIds: string[]) => {
    if (deletedIds.length === 0) return;
    setProjects((prev) => prev.filter((p) => !deletedIds.includes(p.id)));
  }, []);

  const handleCreate = useCallback(
    async (data: {
      title: string;
      genre: string;
      min_words: number;
      target_total_words: number;
      target_length_category: string;
    }) => {
      setSubmitting(true);
      setCreateError(null);
      try {
        const project = await api.createProject({
          title: data.title,
          genre: data.genre,
          min_words: data.min_words,
          target_total_words: data.target_total_words,
          target_length_category: data.target_length_category,
        });
        try {
          await api.advance(project.id, "STAGE1");
        } catch {
          // proceed even if advance fails (mirrors prior behavior)
        }
        setCreateOpen(false);
        navigate(`/project/${encodeURIComponent(project.id)}/workspace?tab=settings`);
      } catch (e) {
        setCreateError(e instanceof Error ? e.message : "创建项目失败");
      } finally {
        setSubmitting(false);
      }
    },
    [navigate]
  );

  const handleResumeWizard = useCallback((projectId: string) => {
    navigate(`/project/${encodeURIComponent(projectId)}/workspace?tab=settings`);
  }, [navigate]);

  const handleOpenCreate = useCallback(() => {
    setCreateError(null);
    setCreateOpen(true);
  }, []);

  const handleCloseCreate = useCallback(() => {
    setCreateOpen(false);
    setCreateError(null);
  }, []);

  // Global settings page is not yet implemented. Surface the button per
  // the design, but route to a toast until a global route exists.
  const handleOpenSettings = useCallback(() => {
    toast.show("设置功能即将上线，请进入具体项目后访问");
  }, [toast]);

  const handleOpenSupport = useCallback(() => {
    toast.show("支持中心即将上线");
  }, [toast]);

  const handleOpenUser = useCallback(() => {
    toast.show("用户中心即将上线");
  }, [toast]);

  const outletContext: HomeOutletContext = {
    projects,
    projectsLoading,
    handleProjectsDeleted,
    handleResumeWizard,
    handleOpenCreate,
    loadProjects,
  };

  return (
    <div className="min-h-screen bg-canvas-bg flex flex-col">
      <header
        data-testid="home-top-bar"
        className="shrink-0 border-b border-outline-variant bg-canvas-bg px-4 py-2 flex items-center"
      >
        <BrandHeader
          brandName="Nebula Forge"
          version="V0.1.0"
          versionLayout="stacked"
          versionTestId="version-chip"
        />
        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            data-testid="header-settings"
            aria-label="设置"
            onClick={handleOpenSettings}
            className="p-2 rounded text-on-surface-variant hover:text-primary hover:bg-surface-container-low transition-colors"
          >
            <span className="material-symbols-outlined text-xl" aria-hidden="true">
              settings
            </span>
          </button>
          <button
            type="button"
            data-testid="header-user"
            aria-label="用户"
            onClick={handleOpenUser}
            className="p-2 rounded text-on-surface-variant hover:text-primary hover:bg-surface-container-low transition-colors"
          >
            <span className="material-symbols-outlined text-xl" aria-hidden="true">
              person
            </span>
          </button>
          <button
            type="button"
            data-testid="header-support"
            aria-label="支持"
            onClick={handleOpenSupport}
            className="p-2 rounded text-on-surface-variant hover:text-primary hover:bg-surface-container-low transition-colors"
          >
            <span className="material-symbols-outlined text-xl" aria-hidden="true">
              help
            </span>
          </button>
        </div>
      </header>
      <div className="flex flex-1 min-h-0">
        <StatsSidebar stats={stats} statsLoading={statsLoading} />
        <main className="flex-1 min-w-0 flex flex-col min-h-0">
          <Outlet context={outletContext} />
        </main>
      </div>
      <CreateProjectModal
        isOpen={createOpen}
        submitting={submitting}
        error={createError}
        onSubmit={handleCreate}
        onClose={handleCloseCreate}
      />
    </div>
  );
}
