import { useState, useCallback, useEffect } from "react";
import api, { type ProjectSummary } from "../api/client";
import StatsSidebar from "../components/home/StatsSidebar";
import CreateProjectModal from "../components/home/CreateProjectModal";
import BookShelf from "../components/home/BookShelf";
import InitWizardModal from "../components/wizard/InitWizardModal";
import PromptPlazaModal from "../components/home/promptPlaza/PromptPlazaModal";
import AIConsoleModal from "../components/aiConsole/AIConsoleModal";
import { useProjectStats } from "../hooks/useProjectStats";
import { useToast } from "../hooks/useToast";
import { BrandHeader } from "../components/ds";

export default function HomePage() {
  const { stats, loading: statsLoading } = useProjectStats();
  const toast = useToast();
  const [submitting, setSubmitting] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [wizardProjectId, setWizardProjectId] = useState<string | null>(null);
  const [plazaOpen, setPlazaOpen] = useState(false);
  const [consoleOpen, setConsoleOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);

  // v1.8.2: single source of truth for the project list. BookShelf used to
  // fetch /api/project/list on its own, doubling the round-trip on every
  // home-page mount. Now HomePage fetches once and passes the result down.
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(true);

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
      intent: string;
      title?: string;
      genre: string;
      min_words: number;
      target_total_words: number;
      target_length_category: string;
    }) => {
      setSubmitting(true);
      setCreateError(null);
      try {
        const project = await api.createProject({
          intent: data.intent,
          genre: data.genre,
          min_words: data.min_words,
          target_total_words: data.target_total_words,
          target_length_category: data.target_length_category,
          title: data.title,
        });
        try {
          await api.advance(project.id, "STAGE1");
        } catch {
          // proceed even if advance fails (mirrors prior behavior)
        }
        setWizardProjectId(project.id);
        setCreateOpen(false);
      } catch (e) {
        setCreateError(e instanceof Error ? e.message : "创建项目失败");
      } finally {
        setSubmitting(false);
      }
    },
    []
  );

  const handleResumeWizard = useCallback((projectId: string) => {
    setWizardProjectId(projectId);
  }, []);

  const handleOpenPlaza = useCallback(() => {
    setPlazaOpen(true);
  }, []);

  const handleOpenConsole = useCallback(() => {
    setConsoleOpen(true);
  }, []);

  const handleOpenCreate = useCallback(() => {
    setCreateError(null);
    setCreateOpen(true);
  }, []);

  const handleCloseCreate = useCallback(() => {
    setCreateOpen(false);
    setCreateError(null);
  }, []);

  // Global settings page is not yet implemented (existing settings route is
  // project-scoped at /project/:projectId/settings). Surface the button per
  // the design, but route to a toast until a global route exists.
  const handleOpenSettings = useCallback(() => {
    toast.show("设置功能即将上线，请进入具体项目后访问");
  }, [toast]);

  const handleOpenSupport = useCallback(() => {
    toast.show("支持中心即将上线");
  }, [toast]);

  return (
    <div className="min-h-screen bg-canvas-bg flex flex-col">
      <header
        data-testid="home-top-bar"
        className="shrink-0 border-b border-outline-variant bg-canvas-bg px-4 py-3 flex items-center"
      >
        <BrandHeader
          brandName="Nebula Forge"
          version="V0.1.0"
          versionLayout="stacked"
          versionTestId="version-chip"
        />
      </header>
      <div className="flex flex-1 min-h-0">
        <StatsSidebar
          stats={stats}
          statsLoading={statsLoading}
          onOpenPlaza={handleOpenPlaza}
          onOpenConsole={handleOpenConsole}
          onOpenSettings={handleOpenSettings}
          onOpenSupport={handleOpenSupport}
        />
        <main className="flex-1 min-w-0 px-8 py-8 max-w-[1200px] mx-auto">
          <BookShelf
            projects={projects}
            loading={projectsLoading}
            onProjectsDeleted={handleProjectsDeleted}
            onResumeWizard={handleResumeWizard}
            onOpenCreate={handleOpenCreate}
          />
        </main>
      </div>
      <CreateProjectModal
        isOpen={createOpen}
        submitting={submitting}
        error={createError}
        onSubmit={handleCreate}
        onClose={handleCloseCreate}
      />
      <PromptPlazaModal
        isOpen={plazaOpen}
        projectId={null}
        projectTitle={null}
        onClose={() => setPlazaOpen(false)}
      />
      <AIConsoleModal
        isOpen={consoleOpen}
        onClose={() => setConsoleOpen(false)}
      />
      {wizardProjectId && (
        <InitWizardModal
          projectId={wizardProjectId}
          onDismiss={() => setWizardProjectId(null)}
        />
      )}
    </div>
  );
}