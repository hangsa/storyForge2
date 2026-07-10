import { useEffect, useRef, useState } from "react";
import api, { NovelOutline } from "../../api/client";
import { useWizard } from "./WizardContext";

interface OutlineStepProps {
  projectId: string;
}

const EMPTY_OUTLINE: NovelOutline = {
  core_conflict_theme: "",
  volumes: [],
  mc_growth_arc: [],
  key_plot_points: [],
  generated_at: "",
  updated_at: "",
};

export default function OutlineStep({ projectId }: OutlineStepProps) {
  const wizard = useWizard();
  const [outline, setOutline] = useState<NovelOutline>(wizard.data.novel_outline ?? EMPTY_OUTLINE);
  const [busy, setBusy] = useState(false);
  // Mirror latest state for handlers registered in the modal footer.
  const outlineRef = useRef(outline);
  outlineRef.current = outline;

  const handleStart = async () => {
    wizard.startStep(5);
    setBusy(true);
    try {
      const result = await api.generateNovelOutline(projectId);
      setOutline(result);
      wizard.setStatus("completed");
    } catch (e) {
      wizard.setStatus("error", e instanceof Error ? e.message : "全书大纲生成失败");
    } finally {
      setBusy(false);
    }
  };

  const handleNext = async () => {
    setBusy(true);
    try {
      const saved = await api.updateNovelOutline(projectId, outlineRef.current);
      wizard.saveStep(5, { novel_outline: saved });
    } catch (e) {
      wizard.setStatus("error", e instanceof Error ? e.message : "大纲保存失败");
    } finally {
      setBusy(false);
    }
  };

  // 重新生成 / 确认修改并继续 are rendered by the modal footer; the step
  // just registers the handlers and the current busy state.
  useEffect(() => {
    const showForm = wizard.status === "completed" || !!wizard.data.novel_outline;
    wizard.setRegenerateHandler(showForm ? handleStart : null, busy);
    wizard.setNextHandler(showForm ? handleNext : null, busy);
    return () => {
      wizard.setRegenerateHandler(null, false);
      wizard.setNextHandler(null, false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wizard.status, !!wizard.data.novel_outline, busy]);

  return (
    <div data-testid="outline-step" className="space-y-4">
      {wizard.status === "idle" && (
        <div data-testid="outline-idle" className="text-center py-12">
          <span className="material-symbols-outlined text-5xl text-system-log/30 mb-4 block">account_tree</span>
          <p className="font-body-ui text-system-log mb-6">点击下方按钮生成全书大纲（章节级概览）</p>
          <button
            data-testid="outline-start"
            onClick={handleStart}
            disabled={busy}
            className="px-5 py-2.5 bg-primary-container text-surface-container-low font-body-ui rounded-lg hover:opacity-90 disabled:opacity-40"
          >
            {busy ? "生成中…" : "开始生成"}
          </button>
        </div>
      )}

      {wizard.status === "generating" && (
        <div className="text-center py-12">
          <span className="material-symbols-outlined text-4xl text-primary-container animate-spin inline-block">progress_activity</span>
          <p className="font-body-ui text-system-log mt-3 text-sm">正在生成全书大纲…</p>
        </div>
      )}

      {wizard.status === "error" && (
        <div className="p-4 bg-error-container/20 border border-error rounded-lg text-error font-body-ui text-sm">
          {wizard.errorMessage}
          <button onClick={handleStart} className="ml-3 px-3 py-1 bg-surface-container text-primary rounded text-xs">重试</button>
        </div>
      )}

      {(wizard.status === "completed" || wizard.data.novel_outline) && (
        <div data-testid="outline-form" className="space-y-3">
          <div>
            <label className="block font-label-mono text-system-log mb-1 text-xs">核心冲突与主题</label>
            <textarea
              value={outline.core_conflict_theme}
              onChange={(e) => setOutline({ ...outline, core_conflict_theme: e.target.value })}
              rows={3}
              className="w-full bg-surface-container border border-outline-variant rounded-lg px-3 py-2 text-sm text-primary focus:outline-none focus:border-primary-container resize-y"
            />
          </div>
          <div className="font-label-mono text-system-log text-[10px] uppercase tracking-wider">
            {outline.volumes.length} 个分卷 · {outline.mc_growth_arc.length} 个主角成长节点 · {outline.key_plot_points.length} 个关键情节点
          </div>
          <p className="font-body-ui text-system-log/60 text-xs">
            详细分卷/情节点编辑可在工作台的大纲标签页内进行。
          </p>
          {/* 重新生成 / 确认修改并继续 buttons moved to modal footer (see useEffect above). */}
        </div>
      )}
    </div>
  );
}
