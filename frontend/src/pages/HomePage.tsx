import { useState, useCallback } from "react";
import api from "../api/client";
import StatsSidebar from "../components/home/StatsSidebar";
import ManifestoHeader from "../components/home/ManifestoHeader";
import CreateProjectCard from "../components/home/CreateProjectCard";
import BookShelf from "../components/home/BookShelf";
import InitWizardModal from "../components/wizard/InitWizardModal";
import { useProjectStats } from "../hooks/useProjectStats";

export default function HomePage() {
  const { stats, loading: statsLoading, refresh } = useProjectStats();
  const [submitting, setSubmitting] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [wizardProjectId, setWizardProjectId] = useState<string | null>(null);

  const handleCreate = useCallback(
    async (data: { intent: string; title?: string; genre: string; min_words: number }) => {
      setSubmitting(true);
      setCreateError(null);
      try {
        const project = await api.createProject({
          intent: data.intent,
          genre: data.genre,
          min_words: data.min_words,
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

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await refresh();
    } finally {
      setRefreshing(false);
    }
  }, [refresh]);

  const mtimes: { id: string; mtime: number }[] = [];

  return (
    <div className="min-h-screen bg-canvas-bg flex">
      <StatsSidebar
        stats={stats}
        statsLoading={statsLoading}
        onRefresh={handleRefresh}
        refreshing={refreshing}
      />
      <main className="flex-1 min-w-0 px-8 py-8 max-w-[1200px] mx-auto">
        <ManifestoHeader />
        <CreateProjectCard
          onSubmit={handleCreate}
          submitting={submitting}
          error={createError}
        />
        <BookShelf mtimes={mtimes} />
      </main>
      {wizardProjectId && (
        <InitWizardModal
          projectId={wizardProjectId}
          onDismiss={() => setWizardProjectId(null)}
        />
      )}
    </div>
  );
}