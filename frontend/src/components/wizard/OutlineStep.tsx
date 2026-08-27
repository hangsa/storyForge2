import { useEffect, useRef, useState } from "react";
import api, { NovelOutline, VolumeDivision, GrowthMilestone, KeyPlotPoint } from "../../api/client";
import { runWithGuardRetry } from "../../utils/outlineGuardRetry";
import { useWizard } from "./WizardContext";
import { RegenerateModal } from "../shared/RegenerateModal";
import { SectionRegenerateButton } from "../shared/SectionRegenerateButton";
import { AutoTextarea } from "../shared/AutoTextarea";

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
  // v2.1: per-call retry attempt counter for FORBIDDEN_TERM_DETECTED. Reset
  // to 1 at the start of each handleStart so "正在生成…" is the default
  // and "正在第N次生成…" only appears on guard-driven retries.
  const [attempt, setAttempt] = useState(1);
  // Mirror latest state for handlers registered in the modal footer.
  const outlineRef = useRef(outline);
  outlineRef.current = outline;

  const handleStart = async (userModifications: string = "") => {
    wizard.startStep(5);
    setBusy(true);
    setAttempt(1);
    try {
      const result = await runWithGuardRetry(
        (mods) => api.generateNovelOutline(projectId, mods),
        userModifications,
        { onAttempt: (a) => setAttempt(a) },
      );
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

  const handleSave = async () => {
    setBusy(true);
    try {
      const saved = await api.updateNovelOutline(projectId, outlineRef.current);
      wizard.markStepGenerated(5, { novel_outline: saved });
    } catch (e) {
      wizard.setStatus("error", e instanceof Error ? e.message : "大纲保存失败");
    } finally {
      setBusy(false);
    }
  };

  const handleSectionRegenerate = (
    section: "core_conflict" | "volumes" | "mc_growth" | "key_plot",
  ) => async (mods: string) => {
    try {
      const result = await api.regenerateNovelOutlineSection(projectId, section, mods);
      setOutline(result);
      wizard.markStepGenerated(5, { novel_outline: result });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "板块重新生成失败";
      wizard.setStatus("error", msg);
      // Re-throw so SectionRegenerateButton can surface the failure toast.
      throw new Error(msg);
    }
  };

  const updateVolume = (i: number, patch: Partial<VolumeDivision>) => {
    setOutline({
      ...outline,
      volumes: outline.volumes.map((v, idx) => (idx === i ? { ...v, ...patch } : v)),
    });
  };

  const addVolume = () => {
    setOutline({
      ...outline,
      volumes: [
        ...outline.volumes,
        { name: "", chapter_range: "", summary: "", key_events: [] },
      ],
    });
  };

  const removeVolume = (i: number) => {
    setOutline({
      ...outline,
      volumes: outline.volumes.filter((_, idx) => idx !== i),
    });
  };

  const updateVolumeEvent = (i: number, j: number, value: string) => {
    setOutline({
      ...outline,
      volumes: outline.volumes.map((v, idx) => {
        if (idx !== i) return v;
        return {
          ...v,
          key_events: v.key_events.map((e, ej) => (ej === j ? value : e)),
        };
      }),
    });
  };

  const addVolumeEvent = (i: number) => {
    setOutline({
      ...outline,
      volumes: outline.volumes.map((v, idx) => {
        if (idx !== i) return v;
        return { ...v, key_events: [...v.key_events, ""] };
      }),
    });
  };

  const removeVolumeEvent = (i: number, j: number) => {
    setOutline({
      ...outline,
      volumes: outline.volumes.map((v, idx) => {
        if (idx !== i) return v;
        return { ...v, key_events: v.key_events.filter((_, ej) => ej !== j) };
      }),
    });
  };

  const updateMilestone = (i: number, patch: Partial<GrowthMilestone>) => {
    setOutline({
      ...outline,
      mc_growth_arc: outline.mc_growth_arc.map((m, idx) => (idx === i ? { ...m, ...patch } : m)),
    });
  };

  const addMilestone = () => {
    setOutline({
      ...outline,
      mc_growth_arc: [
        ...outline.mc_growth_arc,
        { label: "", target_chapter_range: "", description: "" },
      ],
    });
  };

  const removeMilestone = (i: number) => {
    setOutline({
      ...outline,
      mc_growth_arc: outline.mc_growth_arc.filter((_, idx) => idx !== i),
    });
  };

  const updatePlotPoint = (i: number, patch: Partial<KeyPlotPoint>) => {
    setOutline({
      ...outline,
      key_plot_points: outline.key_plot_points.map((p, idx) => (idx === i ? { ...p, ...patch } : p)),
    });
  };

  const addPlotPoint = () => {
    setOutline({
      ...outline,
      key_plot_points: [
        ...outline.key_plot_points,
        { title: "", must_appear_in_volume: "", description: "", trigger_chapter_hint: "" },
      ],
    });
  };

  const removePlotPoint = (i: number) => {
    setOutline({
      ...outline,
      key_plot_points: outline.key_plot_points.filter((_, idx) => idx !== i),
    });
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

  // 重新生成 / 保存修改 / 确认修改并继续 are rendered by the modal footer;
  // the step just registers the handlers and the current busy state.
  useEffect(() => {
    const canRegenerate =
      !!wizard.data.novel_outline ||
      wizard.status === "completed" ||
      wizard.status === "error";
    const canSave = !!wizard.data.novel_outline || wizard.status === "completed";
    wizard.setRegenerateHandler(canRegenerate ? () => setShowRegenerateModal(true) : null, busy);
    wizard.setSaveHandler(canSave ? handleSave : null, busy);
    wizard.setNextHandler(canSave ? handleNext : null, busy);
    return () => {
      wizard.setRegenerateHandler(null, false);
      wizard.setSaveHandler(null, false);
      wizard.setNextHandler(null, false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wizard.status, !!wizard.data.novel_outline, busy]);

  return (
    <div data-testid="outline-step" className="space-y-4">
      {wizard.status === "generating" && (
        <div className="text-center py-12">
          <span className="material-symbols-outlined text-4xl text-primary-container animate-spin inline-block">progress_activity</span>
          <p className="font-body text-body-md text-primary-container mt-3 text-sm">
            正在
            <span data-testid="novel-outline-attempt">
              {attempt > 1 ? `第${attempt}次` : ""}
            </span>
            生成全书大纲…
          </p>
        </div>
      )}

      {wizard.status === "error" && (
        <div className="p-4 bg-error-container/20 border border-error rounded-lg text-error font-body text-body-md text-sm">
          {wizard.errorMessage}
        </div>
      )}

      {(wizard.status === "completed" || wizard.data.novel_outline) && (
        <div data-testid="outline-form" className="space-y-4">
          <div>
            <div className="flex items-center justify-between mb-1">
              <div className="font-mono text-primary-container text-xs">核心冲突与主题</div>
              <SectionRegenerateButton
                target="核心冲突与主题"
                onRegenerate={handleSectionRegenerate("core_conflict")}
                testId="outline-core-conflict-regenerate"
              />
            </div>
            <AutoTextarea
              value={outline.core_conflict_theme}
              onChange={(e) => setOutline({ ...outline, core_conflict_theme: e.target.value })}
              rows={5}
              className="w-full bg-surface-container border border-outline-variant rounded-lg px-3 py-2 text-sm text-primary focus:outline-none focus:border-primary-container resize-y"
            />
          </div>

          {outline.volumes.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <div className="font-mono text-primary-container text-[10px] uppercase tracking-wider">分卷 / 阶段划分</div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={addVolume}
                    data-testid="add-volume-btn"
                    className="text-xs text-primary-container font-body text-body-md flex items-center gap-1 hover:opacity-80"
                  >
                    <span className="material-symbols-outlined text-sm">add</span>
                    添加卷
                  </button>
                  <SectionRegenerateButton
                    target="分卷 / 阶段划分"
                    onRegenerate={handleSectionRegenerate("volumes")}
                    testId="outline-volumes-regenerate"
                  />
                </div>
              </div>
              <div data-testid="outline-volumes" className="space-y-2">
                {outline.volumes.map((v, i) => (
                  <div
                    key={`${v.name}-${i}`}
                    data-testid="outline-volume"
                    className="bg-surface-container border border-outline-variant rounded-lg p-3 space-y-2"
                  >
                    <div className="flex items-center gap-2">
                      <input
                        data-testid={`volume-name-${i}`}
                        value={v.name}
                        onChange={(e) => updateVolume(i, { name: e.target.value })}
                        placeholder="第一卷 崛起期"
                        className="flex-1 bg-surface-container-low border border-outline-variant rounded px-2 py-1
                                   text-primary text-sm focus:outline-none focus:border-primary-container"
                      />
                      <input
                        data-testid={`volume-range-${i}`}
                        value={v.chapter_range}
                        onChange={(e) => updateVolume(i, { chapter_range: e.target.value })}
                        placeholder="1-50"
                        className="w-24 bg-surface-container-low border border-outline-variant rounded px-2 py-1
                                   text-primary text-sm focus:outline-none focus:border-primary-container"
                      />
                      <button
                        onClick={() => removeVolume(i)}
                        className="text-on-surface-variant hover:text-error"
                        aria-label="删除卷"
                        data-testid={`volume-remove-${i}`}
                      >
                        <span className="material-symbols-outlined text-sm">delete</span>
                      </button>
                    </div>
                    <AutoTextarea
                      data-testid={`volume-summary-${i}`}
                      value={v.summary}
                      onChange={(e) => updateVolume(i, { summary: e.target.value })}
                      placeholder="本卷核心冲突与高潮"
                      minRows={2}
                      className="w-full bg-surface-container-low border border-outline-variant rounded px-2 py-1
                                 text-primary text-sm resize-y
                                 focus:outline-none focus:border-primary-container"
                    />
                    <div className="space-y-1">
                      {v.key_events.map((event, j) => (
                        <div key={j} className="flex items-center gap-2">
                          <input
                            data-testid={`volume-event-${i}-${j}`}
                            value={event}
                            onChange={(e) => updateVolumeEvent(i, j, e.target.value)}
                            placeholder={`事件 ${j + 1}`}
                            className="flex-1 bg-surface-container-low border border-outline-variant rounded px-2 py-1
                                       text-primary text-sm focus:outline-none focus:border-primary-container"
                          />
                          <button
                            onClick={() => removeVolumeEvent(i, j)}
                            className="text-on-surface-variant hover:text-error"
                            aria-label="删除事件"
                            data-testid={`volume-event-${i}-${j}-remove`}
                          >
                            <span className="material-symbols-outlined text-sm">delete</span>
                          </button>
                        </div>
                      ))}
                      {v.key_events.length === 0 && (
                        <p className="text-on-surface-variant/50 font-body text-body-md text-xs italic">未添加事件</p>
                      )}
                      <button
                        onClick={() => addVolumeEvent(i)}
                        data-testid={`add-volume-event-${i}`}
                        className="text-xs text-primary-container font-body text-body-md flex items-center gap-1 hover:opacity-80"
                      >
                        <span className="material-symbols-outlined text-sm">add</span>
                        添加事件
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div>
            <div className="flex items-center justify-between mb-2">
              <div className="font-mono text-primary-container text-[10px] uppercase tracking-wider">
                主角成长节点 · {outline.mc_growth_arc.length}
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={addMilestone}
                  data-testid="add-milestone-btn"
                  className="text-xs text-primary-container font-body text-body-md flex items-center gap-1 hover:opacity-80"
                >
                  <span className="material-symbols-outlined text-sm">add</span>
                  添加里程碑
                </button>
                <SectionRegenerateButton
                  target="主角成长节点"
                  onRegenerate={handleSectionRegenerate("mc_growth")}
                  testId="outline-mc-growth-regenerate"
                />
              </div>
            </div>
            <div data-testid="outline-milestones" className="space-y-2">
              {outline.mc_growth_arc.map((m, i) => (
                <div
                  key={i}
                  data-testid="outline-milestone"
                  className="bg-surface-container border border-outline-variant rounded-lg p-3 space-y-2"
                >
                  <div className="flex items-center gap-2">
                    <input
                      data-testid={`milestone-label-${i}`}
                      value={m.label}
                      onChange={(e) => updateMilestone(i, { label: e.target.value })}
                      placeholder="起点 / 觉醒 / 突破..."
                      className="flex-1 bg-surface-container-low border border-outline-variant rounded px-2 py-1
                                 text-primary text-sm focus:outline-none focus:border-primary-container"
                    />
                    <input
                      data-testid={`milestone-range-${i}`}
                      value={m.target_chapter_range}
                      onChange={(e) => updateMilestone(i, { target_chapter_range: e.target.value })}
                      placeholder="约第 1-30 章"
                      className="w-32 bg-surface-container-low border border-outline-variant rounded px-2 py-1
                                 text-primary text-sm focus:outline-none focus:border-primary-container"
                    />
                    <button
                      onClick={() => removeMilestone(i)}
                      className="text-on-surface-variant hover:text-error"
                      aria-label="删除里程碑"
                      data-testid={`milestone-remove-${i}`}
                    >
                      <span className="material-symbols-outlined text-sm">delete</span>
                    </button>
                  </div>
                  <AutoTextarea
                    data-testid={`milestone-desc-${i}`}
                    value={m.description}
                    onChange={(e) => updateMilestone(i, { description: e.target.value })}
                    placeholder="状态变化描述"
                    minRows={2}
                    className="w-full bg-surface-container-low border border-outline-variant rounded px-2 py-1
                               text-primary text-sm resize-y
                               focus:outline-none focus:border-primary-container"
                  />
                </div>
              ))}
              {outline.mc_growth_arc.length === 0 && (
                <p className="text-on-surface-variant/50 font-body text-body-md text-xs italic">未添加里程碑</p>
              )}
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <div className="font-mono text-primary-container text-[10px] uppercase tracking-wider">
                关键情节点 · {outline.key_plot_points.length}
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={addPlotPoint}
                  data-testid="add-plot-btn"
                  className="text-xs text-primary-container font-body text-body-md flex items-center gap-1 hover:opacity-80"
                >
                  <span className="material-symbols-outlined text-sm">add</span>
                  添加关键点
                </button>
                <SectionRegenerateButton
                  target="关键情节点"
                  onRegenerate={handleSectionRegenerate("key_plot")}
                  testId="outline-key-plot-regenerate"
                />
              </div>
            </div>
            <div data-testid="outline-plots" className="space-y-2">
              {outline.key_plot_points.map((p, i) => (
                <div
                  key={i}
                  data-testid="outline-plot"
                  className="bg-surface-container border border-outline-variant rounded-lg p-3 space-y-2"
                >
                  <div className="flex items-center gap-2">
                    <input
                      data-testid={`plot-title-${i}`}
                      value={p.title}
                      onChange={(e) => updatePlotPoint(i, { title: e.target.value })}
                      placeholder="关键点标题"
                      className="flex-1 bg-surface-container-low border border-outline-variant rounded px-2 py-1
                                 text-primary text-sm focus:outline-none focus:border-primary-container"
                    />
                    <input
                      data-testid={`plot-volume-${i}`}
                      value={p.must_appear_in_volume}
                      onChange={(e) => updatePlotPoint(i, { must_appear_in_volume: e.target.value })}
                      placeholder="必出场于哪一卷（卷名或留空）"
                      className="w-48 bg-surface-container-low border border-outline-variant rounded px-2 py-1
                                 text-primary text-sm focus:outline-none focus:border-primary-container"
                    />
                    <button
                      onClick={() => removePlotPoint(i)}
                      className="text-on-surface-variant hover:text-error"
                      aria-label="删除关键点"
                      data-testid={`plot-remove-${i}`}
                    >
                      <span className="material-symbols-outlined text-sm">delete</span>
                    </button>
                  </div>
                  <AutoTextarea
                    data-testid={`plot-desc-${i}`}
                    value={p.description}
                    onChange={(e) => updatePlotPoint(i, { description: e.target.value })}
                    placeholder="为何必出场、如何铺垫"
                    minRows={2}
                    className="w-full bg-surface-container-low border border-outline-variant rounded px-2 py-1
                               text-primary text-sm resize-y
                               focus:outline-none focus:border-primary-container"
                  />
                  <input
                    data-testid={`plot-hint-${i}`}
                    value={p.trigger_chapter_hint}
                    onChange={(e) => updatePlotPoint(i, { trigger_chapter_hint: e.target.value })}
                    placeholder="建议落点（约第 X 章）"
                    className="w-full bg-surface-container-low border border-outline-variant rounded px-2 py-1
                               text-primary text-sm focus:outline-none focus:border-primary-container"
                  />
                </div>
              ))}
              {outline.key_plot_points.length === 0 && (
                <p className="text-on-surface-variant/50 font-body text-body-md text-xs italic">未添加关键点</p>
              )}
            </div>
          </div>
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
