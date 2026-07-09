import { useState, useEffect, useRef } from "react";
import api, { NovelOutline, VolumeDivision, GrowthMilestone, KeyPlotPoint } from "../../api/client";
import GlassPanel from "../shared/GlassPanel";

interface NovelOutlinePanelProps {
  projectId: string;
  data: NovelOutline | null;
  onChange: (n: NovelOutline) => void;
  onError: (msg: string) => void;
}

function emptyOutline(): NovelOutline {
  return {
    core_conflict_theme: "",
    volumes: [],
    mc_growth_arc: [],
    key_plot_points: [],
    generated_at: "",
    updated_at: "",
  };
}

function isEmpty(n: NovelOutline | null): boolean {
  if (!n) return true;
  return (
    !n.core_conflict_theme &&
    n.volumes.length === 0 &&
    n.mc_growth_arc.length === 0 &&
    n.key_plot_points.length === 0
  );
}

function hasUserContent(n: NovelOutline | null): boolean {
  if (!n) return false;
  return (
    n.core_conflict_theme.length > 0 ||
    n.volumes.length > 0 ||
    n.mc_growth_arc.length > 0 ||
    n.key_plot_points.length > 0
  );
}

export default function NovelOutlinePanel({
  projectId,
  data,
  onChange,
  onError,
}: NovelOutlinePanelProps) {
  const [local, setLocal] = useState<NovelOutline>(data || emptyOutline());
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmRegen, setConfirmRegen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setLocal(data || emptyOutline());
  }, [data]);

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, []);

  const debouncedSave = (next: NovelOutline) => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => doSave(next), 800);
  };

  const doSave = async (next: NovelOutline) => {
    setSaving(true);
    try {
      const resp = await api.updateNovelOutline(projectId, next);
      onChange(resp.detail);
      setLocal(resp.detail);
    } catch (e) {
      onError(e instanceof Error ? e.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  const handleGenerate = async () => {
    if (hasUserContent(data) && !confirmRegen) {
      setConfirmRegen(true);
      return;
    }
    setConfirmRegen(false);
    setGenerating(true);
    onError("");
    try {
      const resp = await api.generateNovelOutline(projectId);
      onChange(resp.detail);
      setLocal(resp.detail);
      setToast("全书大纲已生成");
      setTimeout(() => setToast(null), 2500);
    } catch (e) {
      onError(e instanceof Error ? e.message : "生成失败");
    } finally {
      setGenerating(false);
    }
  };

  const handleSnapshot = () => {
    const blob = new Blob([JSON.stringify(local, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `novel-outline-snapshot-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setToast("已下载快照");
    setTimeout(() => setToast(null), 2500);
  };

  const update = (patch: Partial<NovelOutline>) => {
    const next = { ...local, ...patch };
    setLocal(next);
    onChange(next);
    debouncedSave(next);
  };

  const updateVolume = (i: number, patch: Partial<VolumeDivision>) => {
    const volumes = local.volumes.map((v, idx) => (idx === i ? { ...v, ...patch } : v));
    update({ volumes });
  };

  const addVolume = () => {
    update({ volumes: [...local.volumes, { name: "", chapter_range: "", summary: "", key_events: [] }] });
  };

  const removeVolume = (i: number) => {
    update({ volumes: local.volumes.filter((_, idx) => idx !== i) });
  };

  const updateMilestone = (i: number, patch: Partial<GrowthMilestone>) => {
    const mc_growth_arc = local.mc_growth_arc.map((m, idx) => (idx === i ? { ...m, ...patch } : m));
    update({ mc_growth_arc });
  };

  const addMilestone = () => {
    update({ mc_growth_arc: [...local.mc_growth_arc, { label: "", target_chapter_range: "", description: "" }] });
  };

  const removeMilestone = (i: number) => {
    update({ mc_growth_arc: local.mc_growth_arc.filter((_, idx) => idx !== i) });
  };

  const updatePlotPoint = (i: number, patch: Partial<KeyPlotPoint>) => {
    const key_plot_points = local.key_plot_points.map((p, idx) => (idx === i ? { ...p, ...patch } : p));
    update({ key_plot_points });
  };

  const addPlotPoint = () => {
    update({
      key_plot_points: [
        ...local.key_plot_points,
        { title: "", must_appear_in_volume: "", description: "", trigger_chapter_hint: "" },
      ],
    });
  };

  const removePlotPoint = (i: number) => {
    update({ key_plot_points: local.key_plot_points.filter((_, idx) => idx !== i) });
  };

  const noContent = isEmpty(data);

  return (
    <GlassPanel>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="font-label-mono text-primary-container uppercase tracking-wider text-lg">
            全书大纲
          </h2>
          <p className="font-body-ui text-system-log text-xs mt-1">
            {noContent
              ? "尚未生成 — AI 将基于 STAGE2 的世界观和角色设计全书骨架"
              : "全本级别的核心冲突、卷划分、主角弧线与必出场关键点"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {saving && (
            <span className="text-xs text-system-log/60 font-label-mono">保存中...</span>
          )}
          {hasUserContent(data) && (
            <button
              onClick={handleSnapshot}
              className="px-3 py-1.5 text-xs bg-surface-container text-system-log font-body-ui rounded
                         hover:bg-surface-container-low transition-colors"
            >
              另存为快照
            </button>
          )}
          <button
            onClick={handleGenerate}
            disabled={generating}
            data-testid="generate-novel-outline-btn"
            className="px-4 py-2 bg-primary-container text-surface-container-low font-body-ui text-sm
                       rounded-lg hover:opacity-90 transition-opacity disabled:opacity-40 flex items-center gap-2"
          >
            <span className="material-symbols-outlined text-lg">
              {noContent ? "auto_awesome" : "refresh"}
            </span>
            {generating
              ? "生成中..."
              : noContent
                ? "AI 生成全书大纲"
                : "重新生成"}
          </button>
        </div>
      </div>

      {toast && (
        <div className="mb-3 p-2 bg-primary-container/20 text-primary-container font-body-ui text-xs rounded">
          {toast}
        </div>
      )}

      {noContent ? (
        <div className="text-center py-12">
          <span className="material-symbols-outlined text-5xl text-system-log/30 mb-3 block">
            menu_book
          </span>
          <p className="font-body-ui text-system-log text-sm">
            建议先生成全书大纲，让后续章节大纲与全本骨架保持一致
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Section 1: Core conflict / theme */}
          <div>
            <label className="font-label-mono text-system-log text-xs uppercase tracking-wider">
              核心冲突 / 主题
            </label>
            <textarea
              value={local.core_conflict_theme}
              onChange={(e) => update({ core_conflict_theme: e.target.value })}
              placeholder="一句话概括全书的核心冲突与主题"
              rows={3}
              className="w-full mt-2 bg-surface-container-low border border-outline-variant rounded p-3
                         font-body-narrative text-primary text-sm leading-relaxed resize-y
                         focus:outline-none focus:border-primary-container"
            />
          </div>

          {/* Section 2: Volumes */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="font-label-mono text-system-log text-xs uppercase tracking-wider">
                全卷 / 阶段划分
              </label>
              <button
                onClick={addVolume}
                className="text-xs text-primary-container font-body-ui flex items-center gap-1 hover:opacity-80"
              >
                <span className="material-symbols-outlined text-sm">add</span>
                添加卷
              </button>
            </div>
            <div className="space-y-3">
              {local.volumes.map((v, i) => (
                <div key={i} className="p-3 bg-surface-container rounded space-y-2">
                  <div className="flex items-center gap-2">
                    <input
                      value={v.name}
                      onChange={(e) => updateVolume(i, { name: e.target.value })}
                      placeholder="第一卷 崛起期"
                      className="flex-1 bg-surface-container-low border border-outline-variant rounded px-2 py-1
                                 font-body-ui text-primary text-sm focus:outline-none focus:border-primary-container"
                    />
                    <input
                      value={v.chapter_range}
                      onChange={(e) => updateVolume(i, { chapter_range: e.target.value })}
                      placeholder="1-50"
                      className="w-24 bg-surface-container-low border border-outline-variant rounded px-2 py-1
                                 font-body-ui text-primary text-sm focus:outline-none focus:border-primary-container"
                    />
                    <button
                      onClick={() => removeVolume(i)}
                      className="text-system-log hover:text-error"
                      aria-label="删除卷"
                    >
                      <span className="material-symbols-outlined text-sm">delete</span>
                    </button>
                  </div>
                  <textarea
                    value={v.summary}
                    onChange={(e) => updateVolume(i, { summary: e.target.value })}
                    placeholder="本卷核心冲突与高潮"
                    rows={2}
                    className="w-full bg-surface-container-low border border-outline-variant rounded px-2 py-1
                               font-body-narrative text-primary text-xs resize-y
                               focus:outline-none focus:border-primary-container"
                  />
                  <input
                    value={v.key_events.join("、")}
                    onChange={(e) =>
                      updateVolume(i, {
                        key_events: e.target.value.split(/[、，,\s]+/).filter(Boolean),
                      })
                    }
                    placeholder="本卷关键事件（顿号或逗号分隔）"
                    className="w-full bg-surface-container-low border border-outline-variant rounded px-2 py-1
                               font-body-ui text-primary text-xs focus:outline-none focus:border-primary-container"
                  />
                </div>
              ))}
              {local.volumes.length === 0 && (
                <p className="text-system-log/50 font-body-ui text-xs italic">未添加卷</p>
              )}
            </div>
          </div>

          {/* Section 3: MC growth arc */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="font-label-mono text-system-log text-xs uppercase tracking-wider">
                主角成长弧线
              </label>
              <button
                onClick={addMilestone}
                className="text-xs text-primary-container font-body-ui flex items-center gap-1 hover:opacity-80"
              >
                <span className="material-symbols-outlined text-sm">add</span>
                添加里程碑
              </button>
            </div>
            <div className="space-y-2">
              {local.mc_growth_arc.map((m, i) => (
                <div key={i} className="p-3 bg-surface-container rounded space-y-2">
                  <div className="flex items-center gap-2">
                    <input
                      value={m.label}
                      onChange={(e) => updateMilestone(i, { label: e.target.value })}
                      placeholder="起点 / 觉醒 / 突破..."
                      className="flex-1 bg-surface-container-low border border-outline-variant rounded px-2 py-1
                                 font-body-ui text-primary text-sm focus:outline-none focus:border-primary-container"
                    />
                    <input
                      value={m.target_chapter_range}
                      onChange={(e) => updateMilestone(i, { target_chapter_range: e.target.value })}
                      placeholder="约第 1-30 章"
                      className="w-32 bg-surface-container-low border border-outline-variant rounded px-2 py-1
                                 font-body-ui text-primary text-xs focus:outline-none focus:border-primary-container"
                    />
                    <button
                      onClick={() => removeMilestone(i)}
                      className="text-system-log hover:text-error"
                      aria-label="删除里程碑"
                    >
                      <span className="material-symbols-outlined text-sm">delete</span>
                    </button>
                  </div>
                  <textarea
                    value={m.description}
                    onChange={(e) => updateMilestone(i, { description: e.target.value })}
                    placeholder="状态变化描述"
                    rows={2}
                    className="w-full bg-surface-container-low border border-outline-variant rounded px-2 py-1
                               font-body-narrative text-primary text-xs resize-y
                               focus:outline-none focus:border-primary-container"
                  />
                </div>
              ))}
              {local.mc_growth_arc.length === 0 && (
                <p className="text-system-log/50 font-body-ui text-xs italic">未添加里程碑</p>
              )}
            </div>
          </div>

          {/* Section 4: Key plot points */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="font-label-mono text-system-log text-xs uppercase tracking-wider">
                必出场关键点
              </label>
              <button
                onClick={addPlotPoint}
                className="text-xs text-primary-container font-body-ui flex items-center gap-1 hover:opacity-80"
              >
                <span className="material-symbols-outlined text-sm">add</span>
                添加关键点
              </button>
            </div>
            <div className="space-y-2">
              {local.key_plot_points.map((p, i) => (
                <div key={i} className="p-3 bg-surface-container rounded space-y-2">
                  <div className="flex items-center gap-2">
                    <input
                      value={p.title}
                      onChange={(e) => updatePlotPoint(i, { title: e.target.value })}
                      placeholder="关键点标题"
                      className="flex-1 bg-surface-container-low border border-outline-variant rounded px-2 py-1
                                 font-body-ui text-primary text-sm focus:outline-none focus:border-primary-container"
                    />
                    <input
                      value={p.must_appear_in_volume}
                      onChange={(e) => updatePlotPoint(i, { must_appear_in_volume: e.target.value })}
                      placeholder="必出场于哪一卷（卷名或留空）"
                      className="w-48 bg-surface-container-low border border-outline-variant rounded px-2 py-1
                                 font-body-ui text-primary text-xs focus:outline-none focus:border-primary-container"
                    />
                    <button
                      onClick={() => removePlotPoint(i)}
                      className="text-system-log hover:text-error"
                      aria-label="删除关键点"
                    >
                      <span className="material-symbols-outlined text-sm">delete</span>
                    </button>
                  </div>
                  <textarea
                    value={p.description}
                    onChange={(e) => updatePlotPoint(i, { description: e.target.value })}
                    placeholder="为何必出场、如何铺垫"
                    rows={2}
                    className="w-full bg-surface-container-low border border-outline-variant rounded px-2 py-1
                               font-body-narrative text-primary text-xs resize-y
                               focus:outline-none focus:border-primary-container"
                  />
                  <input
                    value={p.trigger_chapter_hint}
                    onChange={(e) => updatePlotPoint(i, { trigger_chapter_hint: e.target.value })}
                    placeholder="建议落点（约第 X 章）"
                    className="w-full bg-surface-container-low border border-outline-variant rounded px-2 py-1
                               font-body-ui text-primary text-xs focus:outline-none focus:border-primary-container"
                  />
                </div>
              ))}
              {local.key_plot_points.length === 0 && (
                <p className="text-system-log/50 font-body-ui text-xs italic">未添加关键点</p>
              )}
            </div>
          </div>

          {local.generated_at && (
            <p className="text-system-log/50 font-label-mono text-xs">
              生成于 {local.generated_at.slice(0, 19).replace("T", " ")} · 最近编辑{" "}
              {local.updated_at.slice(0, 19).replace("T", " ")}
            </p>
          )}
        </div>
      )}

      {/* Confirm regen dialog */}
      {confirmRegen && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
          <div className="bg-surface-container-low border-2 border-amber-500 rounded-lg max-w-md w-full mx-4 p-5 space-y-4">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-amber-500">warning</span>
              <h3 className="font-label-mono text-amber-300">重新生成会覆盖当前大纲</h3>
            </div>
            <p className="font-body-ui text-system-log text-sm">
              当前已有手动编辑或 AI 生成的内容。重新生成会用 AI 输出完整覆盖。
              如需保留当前版本，请先点"另存为快照"。
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setConfirmRegen(false)}
                className="px-3 py-1.5 text-sm bg-surface-container text-system-log rounded
                           hover:bg-surface-container-low"
              >
                取消
              </button>
              <button
                onClick={handleGenerate}
                className="px-3 py-1.5 text-sm bg-amber-500 text-surface-container-low rounded
                           hover:opacity-90"
              >
                确认覆盖
              </button>
            </div>
          </div>
        </div>
      )}
    </GlassPanel>
  );
}
