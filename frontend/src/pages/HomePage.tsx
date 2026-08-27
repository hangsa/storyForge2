import { useState, useCallback, useEffect } from "react";
import api, { type ProjectSummary } from "../api/client";
import StatsSidebar from "../components/home/StatsSidebar";
import CreateProjectCard from "../components/home/CreateProjectCard";
import BookShelf from "../components/home/BookShelf";
import InitWizardModal from "../components/wizard/InitWizardModal";
import PromptPlazaModal from "../components/home/promptPlaza/PromptPlazaModal";
import AIConsoleModal from "../components/aiConsole/AIConsoleModal";
import MoreActionsModal from "../components/home/MoreActionsModal";
import { useProjectStats } from "../hooks/useProjectStats";

export default function HomePage() {
  const { stats, loading: statsLoading, refresh } = useProjectStats();
  const [submitting, setSubmitting] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [wizardProjectId, setWizardProjectId] = useState<string | null>(null);
  const [plazaOpen, setPlazaOpen] = useState(false);
  const [consoleOpen, setConsoleOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);

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

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await refresh();
    } finally {
      setRefreshing(false);
    }
  }, [refresh]);

  const handleOpenPlaza = useCallback(() => {
    setPlazaOpen(true);
  }, []);

  const handleOpenConsole = useCallback(() => {
    setConsoleOpen(true);
  }, []);

  const handleOpenMore = useCallback(() => {
    setMoreOpen(true);
  }, []);

  return (
    <div className="min-h-screen bg-canvas-bg flex">
      <StatsSidebar
        stats={stats}
        statsLoading={statsLoading}
        onRefresh={handleRefresh}
        refreshing={refreshing}
        onOpenPlaza={handleOpenPlaza}
        onOpenConsole={handleOpenConsole}
        onOpenMore={handleOpenMore}
      />
      <main className="flex-1 min-w-0 px-8 py-8 max-w-[1200px] mx-auto">
        <CreateProjectCard
          onSubmit={handleCreate}
          submitting={submitting}
          error={createError}
        />
        <BookShelf
          projects={projects}
          loading={projectsLoading}
          onProjectsDeleted={handleProjectsDeleted}
          onResumeWizard={handleResumeWizard}
        />
      </main>
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
      {moreOpen && <MoreActionsModal onClose={() => setMoreOpen(false)} />}
      {wizardProjectId && (
        <InitWizardModal
          projectId={wizardProjectId}
          onDismiss={() => setWizardProjectId(null)}
        />
      )}
    </div>
  );
}
