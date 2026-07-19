import { useCallback, useEffect, useState } from "react";
import type { PromptDetail, PromptOverridePayload } from "../../../api/promptPlaza";
import { putPlazaPrompt, deletePlazaPrompt } from "../../../api/promptPlaza";
import { usePromptList } from "../../../hooks/usePromptList";
import { usePromptDetail } from "../../../hooks/usePromptDetail";
import PromptListPanel from "./PromptListPanel";
import PromptEditPanel from "./PromptEditPanel";

interface Props {
  isOpen: boolean;
  projectId: string | null;
  projectTitle: string | null;
  onClose: () => void;
}

export default function PromptPlazaModal({ isOpen, projectId, projectTitle, onClose }: Props) {
  const { prompts, loading: listLoading, error: listError, refresh: refreshList } = usePromptList(
    isOpen ? projectId : null,
  );
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const { detail, loading: detailLoading, error: detailError, refresh: refreshDetail } = usePromptDetail(
    isOpen ? projectId : null,
    selectedName,
  );
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Reset selection when modal opens/closes
  useEffect(() => {
    if (!isOpen) setSelectedName(null);
  }, [isOpen]);

  // Auto-select first prompt when list loads (only if nothing selected)
  useEffect(() => {
    if (prompts.length > 0 && selectedName === null) {
      setSelectedName(prompts[0].name);
    }
  }, [prompts, selectedName]);

  const handleSave = useCallback(
    async (payload: PromptOverridePayload) => {
      if (!projectId || !selectedName) return;
      setSaving(true);
      setSaveError(null);
      try {
        await putPlazaPrompt(projectId, selectedName, payload);
        await Promise.all([refreshList(), refreshDetail()]);
      } catch (e) {
        setSaveError(e instanceof Error ? e.message : "保存失败");
      } finally {
        setSaving(false);
      }
    },
    [projectId, selectedName, refreshList, refreshDetail],
  );

  const handleReset = useCallback(async () => {
    if (!projectId || !selectedName) return;
    setSaving(true);
    setSaveError(null);
    try {
      await deletePlazaPrompt(projectId, selectedName);
      await Promise.all([refreshList(), refreshDetail()]);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "重置失败");
    } finally {
      setSaving(false);
      setSelectedName(null);
    }
  }, [projectId, selectedName, refreshList, refreshDetail]);

  // ESC close
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      data-testid="prompt-plaza-modal"
      className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-6"
    >
      <div className="bg-surface-container-lowest border border-outline-variant rounded-lg w-full max-w-6xl h-[85vh] flex flex-col overflow-hidden">
        <header className="px-6 py-4 border-b border-outline-variant flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h2 className="font-display text-primary text-xl">提示词广场</h2>
            {projectTitle && (
              <span className="text-sm text-system-log">项目：{projectTitle}</span>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭"
            data-testid="plaza-close"
            className="text-system-log hover:text-primary"
          >
            <span className="material-symbols-outlined">close</span>
          </button>
        </header>

        {!projectId ? (
          <div className="flex-1 flex items-center justify-center text-system-log">
            请先创建项目
          </div>
        ) : (
          <>
            {saveError && (
              <div className="mx-6 mt-3 p-2 bg-error/10 border border-error/30 rounded text-error text-xs">
                {saveError}
              </div>
            )}
            <div className="flex-1 flex overflow-hidden">
              <aside className="w-72 border-r border-outline-variant">
                <PromptListPanel
                  prompts={prompts}
                  selectedName={selectedName}
                  onSelect={setSelectedName}
                />
                {listError && (
                  <div className="p-3 text-error text-xs">{listError}</div>
                )}
                {listLoading && (
                  <div className="p-3 text-system-log text-xs">加载中…</div>
                )}
              </aside>
              <main className="flex-1 flex flex-col overflow-hidden">
                <PromptEditPanel
                  detail={detail}
                  loading={detailLoading || saving}
                  error={detailError}
                  onSave={handleSave}
                  onReset={handleReset}
                  onClose={onClose}
                />
              </main>
            </div>
          </>
        )}
      </div>
    </div>
  );
}