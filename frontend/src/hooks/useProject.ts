import { useState, useCallback } from "react";
import api, { Project, ProjectStatus, ApiError } from "../api/client";

interface UseProjectReturn {
  project: Project | null;
  projectStatus: ProjectStatus | null;
  loading: boolean;
  error: string | null;
  createProject: (intent: string, genre: string, minWords: number) => Promise<Project>;
  loadProjectStatus: (projectId: string) => Promise<void>;
  clearError: () => void;
}

export function useProject(): UseProjectReturn {
  const [project, setProject] = useState<Project | null>(null);
  const [projectStatus, setProjectStatus] = useState<ProjectStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const createProject = useCallback(
    async (intent: string, genre: string, minWords: number): Promise<Project> => {
      setLoading(true);
      setError(null);
      try {
        const result = await api.createProject({
          intent,
          genre,
          min_words: minWords,
        });
        setProject(result);
        return result;
      } catch (e) {
        const msg = e instanceof ApiError ? e.message : "创建项目失败";
        setError(msg);
        throw e;
      } finally {
        setLoading(false);
      }
    },
    []
  );

  const loadProjectStatus = useCallback(async (projectId: string) => {
    setLoading(true);
    setError(null);
    try {
      const status = await api.getProjectStatus(projectId);
      setProjectStatus(status);
      setProject(status.project);
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : "加载项目状态失败";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  const clearError = useCallback(() => setError(null), []);

  return {
    project,
    projectStatus,
    loading,
    error,
    createProject,
    loadProjectStatus,
    clearError,
  };
}
