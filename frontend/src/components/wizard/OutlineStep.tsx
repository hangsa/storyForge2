import { useEffect, useRef, useState } from "react";
import api, { NovelOutline } from "../../api/client";
import { useWizard } from "./WizardContext";
import { RegenerateModal } from "../shared/RegenerateModal";

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
  const [showRegenerateModal, setShowRegenerateModal] = useState(false);
  // Mirror latest state for handlers registered in the modal footer.
  const outlineRef = useRef(outline);
  outlineRef.current = outline;

  const handleStart = async (userModifications: string = "") => {
    wizard.startStep(5);
    setBusy(true);
    try {
      const result = await api.generateNovelOutline(projectId, userModifications);
      setOutline(result);
      // v1.8.4: mark generated so step 5 stays reachable in the indicator
      // when the user navigates away before clicking "下一步".
      wizard.markStepGenerated(5, { novel_outline: result });
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

  // Sync local `outline` state from wizard.data.novel_outline when prefill
  // lands. Only overwrite if the user hasn't typed anything yet (i.e., local
  // state is still the EMPTY_OUTLINE default). Without this, a user who
  // re-enters the wizard after closing on step 5 — where wizard.data has no
  // novel_outline but the file exists on disk — would see an empty form
  // because local state was initialized from the (then-null) wizard state.
  useEffect(() => {
    const persisted = wizard.data.novel_outline;
    if (!persisted) return;
    const isLocalEmpty =
      outline.core_conflict_theme === "" &&
      outline.volumes.length === 0 &&
      outline.mc_growth_arc.length === 0 &&
      outline.key_plot_points.length === 0;
    if (isLocalEmpty) {
      setOutline(persisted);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wizard.data.novel_outline]);

  // Auto-trigger generation on mount if no outline has been generated yet.
  // Errors keep the error UI visible so the user can hit "重新生成" in the footer.
  //
  // v1.8.2: wait for prefill to finish before deciding. Without this gate,
  // the auto-trigger fires synchronously on mount and POSTs
  // /generate-novel-outline BEFORE the async prefill can hydrate
  // wizard.data.novel_outline from disk. For proj_cc4ca4ae (and any project
  // closed on step 5 without saving), that meant regenerating content the
  // user already paid for.
  useEffect(() => {
    if (!wizard.prefillComplete) return;
    if (
      !wizard.data.novel_outline &&
      wizard.status !== "generating" &&
      wizard.status !== "error"
    ) {
      handleStart();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wizard.prefillComplete]);

  // 重新生成 / 确认修改并继续 are rendered by the modal footer; the step
  // just registers the handlers and the current busy state.
  useEffect(() => {
    const canRegenerate =
      !!wizard.data.novel_outline ||
      wizard.status === "completed" ||
      wizard.status === "error";
    const canSave = !!wizard.data.novel_outline || wizard.status === "completed";
    wizard.setRegenerateHandler(canRegenerate ? () => setShowRegenerateModal(true) : null, busy);
    wizard.setNextHandler(canSave ? handleNext : null, busy);
    return () => {
      wizard.setRegenerateHandler(null, false);
      wizard.setNextHandler(null, false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wizard.status, !!wizard.data.novel_outline, busy]);

  return (
    <div data-testid="outline-step" className="space-y-4">
      {wizard.status === "generating" && (
        <div className="text-center py-12">
          <span className="material-symbols-outlined text-4xl text-primary-container animate-spin inline-block">progress_activity</span>
          <p className="font-body-ui text-system-log mt-3 text-sm">正在生成全书大纲…</p>
        </div>
      )}

      {wizard.status === "error" && (
        <div className="p-4 bg-error-container/20 border border-error rounded-lg text-error font-body-ui text-sm">
          {wizard.errorMessage}
        </div>
      )}

      {(wizard.status === "completed" || wizard.data.novel_outline) && (
        <div data-testid="outline-form" className="space-y-4">
          <div>
            <label className="block font-label-mono text-system-log mb-1 text-xs">核心冲突与主题</label>
            <textarea
              value={outline.core_conflict_theme}
              onChange={(e) => setOutline({ ...outline, core_conflict_theme: e.target.value })}
              rows={5}
              className="w-full bg-surface-container border border-outline-variant rounded-lg px-3 py-2 text-sm text-primary focus:outline-none focus:border-primary-container resize-y"
            />
          </div>

          {outline.volumes.length > 0 && (
            <div>
              <div className="font-label-mono text-system-log mb-2 text-[10px] uppercase tracking-wider">
                分卷 / 阶段划分
              </div>
              <div data-testid="outline-volumes" className="space-y-2">
                {outline.volumes.map((v, i) => (
                  <div
                    key={`${v.name}-${i}`}
                    data-testid="outline-volume"
                    className="bg-surface-container border border-outline-variant rounded-lg p-3"
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <h3 className="font-display text-primary text-sm">{v.name}</h3>
                      <span className="font-label-mono text-system-log/60 text-xs shrink-0">
                        第 {v.chapter_range} 章
                      </span>
                    </div>
                    {v.summary && (
                      <p className="font-body-ui text-system-log text-sm mt-1.5 leading-relaxed">{v.summary}</p>
                    )}
                    {v.key_events.length > 0 && (
                      <ul className="mt-2 space-y-1">
                        {v.key_events.map((e, j) => (
                          <li
                            key={j}
                            className="font-body-ui text-system-log/80 text-xs flex gap-2 leading-relaxed"
                          >
                            <span className="text-primary-container shrink-0">•</span>
                            <span>{e}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="font-label-mono text-system-log text-[10px] uppercase tracking-wider">
            {outline.volumes.length} 个分卷 · {outline.mc_growth_arc.length} 个主角成长节点 · {outline.key_plot_points.length} 个关键情节点
          </div>
          <p className="font-body-ui text-system-log/60 text-xs">
            详细分卷/情节点编辑可在工作台的大纲标签页内进行。
          </p>
          {/* 重新生成 / 确认修改并继续 buttons moved to modal footer (see useEffect above). */}
        </div>
      )}

      <RegenerateModal
        open={showRegenerateModal}
        target="细纲"
        onConfirm={async (text) => {
          setShowRegenerateModal(false);
          await handleStart(text);
        }}
        onCancel={() => setShowRegenerateModal(false)}
      />
    </div>
  );
}
