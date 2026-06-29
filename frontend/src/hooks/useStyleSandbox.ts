import { useCallback, useState } from "react";
import api, { ApiError, type PreviewResponse, type SandboxParams, type SavedStyleConfig } from "../api/client";

export interface UseStyleSandboxReturn {
  previewResponse: PreviewResponse | null;
  previewError: string | null;
  previewing: boolean;
  preview: (sourceText: string, params: SandboxParams, genre?: string) => Promise<void>;
  configs: SavedStyleConfig[];
  loadConfigs: () => Promise<void>;
  saving: boolean;
  save: (name: string, params: SandboxParams) => Promise<void>;
}

export function useStyleSandbox(projectId: string): UseStyleSandboxReturn {
  const [previewResponse, setPreviewResponse] = useState<PreviewResponse | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [configs, setConfigs] = useState<SavedStyleConfig[]>([]);
  const [saving, setSaving] = useState(false);

  const preview = useCallback(async (sourceText: string, params: SandboxParams, genre = "cool_novel") => {
    setPreviewing(true);
    setPreviewError(null);
    try {
      const r = await api.styleSandboxPreview(projectId, { source_text: sourceText, params, genre });
      setPreviewResponse(r);
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : (e as Error).message;
      setPreviewError(msg);
      setPreviewResponse(null);
    } finally {
      setPreviewing(false);
    }
  }, [projectId]);

  const loadConfigs = useCallback(async () => {
    const r = await api.styleSandboxListConfigs(projectId);
    setConfigs(r.configs);
  }, [projectId]);

  const save = useCallback(async (name: string, params: SandboxParams) => {
    setSaving(true);
    try {
      await api.styleSandboxSave(projectId, { name, params });
      await loadConfigs();
    } finally {
      setSaving(false);
    }
  }, [projectId, loadConfigs]);

  return {
    previewResponse, previewError, previewing, preview,
    configs, loadConfigs, saving, save,
  };
}
