import { useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import api from "../api/client";
import StatsSidebar from "../components/home/StatsSidebar";
import ManifestoHeader from "../components/home/ManifestoHeader";
import CreateProjectCard from "../components/home/CreateProjectCard";
import BookShelf from "../components/home/BookShelf";
import { useProjectStats } from "../hooks/useProjectStats";

export default function HomePage() {
  const navigate = useNavigate();
  const { stats, loading: statsLoading, refresh } = useProjectStats();
  const [submitting, setSubmitting] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [shelfRefreshKey, setShelfRefreshKey] = useState(0);

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
          // proceed even if advance fails (mirrors ProjectListPage behavior)
        }
        navigate(`/project/${encodeURIComponent(project.id)}/stage1`);
      } catch (e) {
        setCreateError(e instanceof Error ? e.message : "创建项目失败");
      } finally {
        setSubmitting(false);
      }
    },
    [navigate]
  );

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await refresh();
      // Bumping the key remounts BookShelf so its own mount effect re-runs
      // listProjects(), giving the user an up-to-date shelf alongside fresh stats.
      setShelfRefreshKey((k) => k + 1);
    } finally {
      setRefreshing(false);
    }
  }, [refresh]);

  // mtimes is intentionally a stable empty list here; the existing /api/project/list
  // endpoint does not expose file mtime, so shelf items fall back to created_at desc.
  // Future: pass actual mtimes once the list endpoint is extended.
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
        <BookShelf key={shelfRefreshKey} mtimes={mtimes} />
      </main>
    </div>
  );
}
