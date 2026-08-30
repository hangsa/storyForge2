import { useOutletContext } from "react-router-dom";
import BookShelf from "../components/home/BookShelf";
import type { HomeOutletContext } from "../components/layout/HomeLayout";

export default function HomePage() {
  const {
    projects,
    projectsLoading,
    handleProjectsDeleted,
    handleResumeWizard,
    handleOpenCreate,
    loadProjects,
  } = useOutletContext<HomeOutletContext>();

  return (
    <div className="flex-1 min-w-0 pt-4 pb-8">
      <BookShelf
        projects={projects}
        loading={projectsLoading}
        onProjectsDeleted={handleProjectsDeleted}
        onResumeWizard={handleResumeWizard}
        onOpenCreate={handleOpenCreate}
        onRefresh={loadProjects}
      />
    </div>
  );
}