import { useEffect, useRef, useState } from "react";
import api, { Outline } from "../../api/client";
import { useWizard } from "./WizardContext";

interface ChapterOutlineStepProps {
  projectId: string;
  /** Invoked after the outline is saved. Modal passes advance+navigate here. */
  onFinish: () => void;
}

export default function ChapterOutlineStep({ projectId, onFinish }: ChapterOutlineStepProps) {
  const wizard = useWizard();
  const [outline, setOutline] = useState<Outline | null>(wizard.data.chapter1_outline ?? null);
  const [busy, setBusy] = useState(false);
  // Mirror latest state for handlers registered in the modal footer.
  const outlineRef = useRef(outline);
  outlineRef.current = outline;
  const onFinishRef = useRef(onFinish);
  onFinishRef.current = onFinish;

  const handleStart = async () => {
    wizard.startStep(6);
    setBusy(true);
    try {
      const result = await api.generateOutline(projectId, 1);
      setOutline(result);
      wizard.setStatus("completed");
    } catch (e) {
      wizard.setStatus("error", e instanceof Error ? e.message : "章节大纲生成失败");
    } finally {
      setBusy(false);
    }
  };

  const updateChapterTitle = (idx: number, title: string) => {
    if (!outline) return;
    const chapters = outline.chapters.map((ch, i) => (i === idx ? { ...ch, title } : ch));
    setOutline({ ...outline, chapters });
  };

  const handleFinish = async () => {
    const current = outlineRef.current;
    if (!current) return;
    setBusy(true);
    try {
      await api.updateOutline(projectId, current);
      wizard.saveStep(6, { chapter1_outline: current });
      onFinishRef.current();
    } catch (e) {
      wizard.setStatus("error", e instanceof Error ? e.message : "章节大纲保存失败");
    } finally {
      setBusy(false);
    }
  };

  // Auto-trigger generation on first mount when there is no existing outline
  // and the wizard isn't already mid-run or in error. v1.8 drops the manual
  // "开始生成" button to match the other wizard steps.
  useEffect(() => {
    if (
      !outline &&
      wizard.status !== "generating" &&
      wizard.status !== "error"
    ) {
      handleStart();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 重新生成 moves to the modal footer. 完成 → 进入工作台 stays in the
  // form per current spec (not part of the 下一步/重新生成 rename). The
  // regenerate button is enabled for the form, the completed state, and
  // the error state so the user can recover from a generation failure.
  useEffect(() => {
    const hasOutline = !!outline && outline.chapters.length > 0;
    const canRegenerate =
      hasOutline ||
      wizard.status === "completed" ||
      wizard.status === "error";
    wizard.setRegenerateHandler(canRegenerate ? handleStart : null, busy);
    return () => {
      wizard.setRegenerateHandler(null, false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!outline, outline?.chapters.length, busy]);

  return (
    <div data-testid="chapter-outline-step" className="space-y-4">
      {wizard.status === "generating" && (
        <div className="text-center py-12">
          <span className="material-symbols-outlined text-4xl text-primary-container animate-spin inline-block">progress_activity</span>
          <p className="font-body-ui text-system-log mt-3 text-sm">正在生成章节大纲…</p>
        </div>
      )}

      {wizard.status === "error" && (
        <div className="p-4 bg-error-container/20 border border-error rounded-lg text-error font-body-ui text-sm">
          {wizard.errorMessage}
        </div>
      )}

      {outline && outline.chapters.length > 0 && (
        <div data-testid="chapter-outline-form" className="space-y-3">
          <div className="font-label-mono text-system-log text-[10px] uppercase tracking-wider">
            已生成 {outline.chapters.length} 章 · {outline.chapters.reduce((acc, ch) => acc + ch.scene_plan.length, 0)} 个场景
          </div>
          {outline.chapters.map((ch, idx) => (
            <div key={idx} className="border border-outline-variant rounded-lg p-3 space-y-2">
              <label className="block font-label-mono text-system-log text-[10px] uppercase tracking-wider">
                第 {ch.chapter_number} 章标题
              </label>
              <input
                data-testid={`chapter-${ch.chapter_number}-title`}
                value={ch.title}
                onChange={(e) => updateChapterTitle(idx, e.target.value)}
                className="w-full bg-surface-container border border-outline-variant rounded-lg px-3 py-2 text-sm text-primary focus:outline-none focus:border-primary-container"
              />
              <div className="font-body-ui text-system-log text-xs">
                {ch.scene_plan.length} 个场景 · 概要字数 {((ch as { summary?: string }).summary?.length ?? 0)}
              </div>
            </div>
          ))}
          <p className="font-body-ui text-system-log/60 text-xs">
            场景级详情可在工作台的大纲标签页内编辑。
          </p>
          <div className="flex justify-end pt-2">
            <button
              data-testid="chapter-outline-finish"
              onClick={handleFinish}
              disabled={busy}
              className="px-5 py-2 bg-tertiary-container text-surface-container-low text-sm rounded-lg hover:opacity-90 disabled:opacity-40"
            >
              {busy ? "保存中…" : "完成 → 进入工作台"}
            </button>
          </div>
          {/* 重新生成 moved to modal footer (see useEffect above). */}
        </div>
      )}
    </div>
  );
}