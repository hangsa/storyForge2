import { useEffect, useRef, useState } from "react";
import api, {
  NovelOutline,
  VolumeDivision,
  GrowthMilestone,
  KeyPlotPoint,
} from "../../../api/client";
import { useAutoHeight } from "../../../hooks/useAutoHeight";

interface BaseEditorProps {
  projectId: string;
  data: unknown;
  onSaved: () => void;
  readOnly?: boolean;
}

const EMPTY: NovelOutline = {
  core_conflict_theme: "",
  volumes: [],
  mc_growth_arc: [],
  key_plot_points: [],
  generated_at: "",
  updated_at: "",
};

function readNovel(data: unknown): NovelOutline {
  if (!data || typeof data !== "object") return EMPTY;
  return { ...EMPTY, ...(data as Partial<NovelOutline>) };
}

/**
 * v1.9 Bug 2 follow-up: the right-panel "大纲" tab now shows the NOVEL-level
 * outline (core_conflict_theme / volumes / mc_growth_arc / key_plot_points),
 * not the per-chapter outline. The chapter outline lives in the left panel
 * (ChapterTreePanel → WritingArea) — showing both at the same level in the
 * right panel would be redundant.
 *
 * Save → api.updateNovelOutline. Volumes, growth milestones and plot points
 * are edited in flat, simple shapes (no add/remove UI — that lives on
 * Stage3 itself). Empty novel_outline shows a "请到 Stage3 生成全文大纲"
 * hint with a link.
 */
export default function NovelOutlineEditor({ projectId, data, onSaved, readOnly }: BaseEditorProps) {
  const [novel, setNovel] = useState<NovelOutline>(() => readNovel(data));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const novelRef = useRef(novel);
  novelRef.current = novel;
  const themeRef = useRef<HTMLTextAreaElement>(null);
  useAutoHeight(themeRef, [novel.core_conflict_theme ?? ""]);

  useEffect(() => {
    setNovel(readNovel(data));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const handleSave = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.updateNovelOutline(projectId, novelRef.current);
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存失败");
    } finally {
      setBusy(false);
    }
  };

  const handleCancel = () => {
    setNovel(readNovel(data));
    setError(null);
  };

  const isEmpty =
    !novel.core_conflict_theme?.trim() &&
    novel.volumes.length === 0 &&
    novel.mc_growth_arc.length === 0 &&
    novel.key_plot_points.length === 0;

  if (isEmpty) {
    return (
      <div data-testid="novel-outline-editor" className="space-y-3">
        <p data-testid="novel-outline-empty" className="font-body-ui text-system-log text-sm">
          尚未生成全文大纲 — 请到 Stage3 使用"生成全文大纲"功能。
        </p>
      </div>
    );
  }

  return (
    <div data-testid="novel-outline-editor" className="space-y-3">
      <div>
        <label className="block font-label-mono text-system-log mb-1 text-xs">核心冲突 / 主题</label>
        <textarea
          ref={themeRef}
          data-testid="novel-outline-theme"
          value={novel.core_conflict_theme ?? ""}
          onChange={(e) => setNovel({ ...novel, core_conflict_theme: e.target.value })}
          className="w-full bg-surface-container border border-outline-variant rounded-lg px-3 py-2 text-sm text-primary focus:outline-none focus:border-primary-container overflow-hidden"
        />
      </div>

      <Section title={`全卷划分（${novel.volumes.length} 卷）`}>
        {novel.volumes.map((v, idx) => (
          <VolumeCard
            key={idx}
            idx={idx}
            volume={v}
            onUpdate={(next) => {
              const list = novel.volumes.slice();
              list[idx] = next;
              setNovel({ ...novel, volumes: list });
            }}
          />
        ))}
      </Section>

      <Section title={`主角成长弧线（${novel.mc_growth_arc.length} 阶段）`}>
        {novel.mc_growth_arc.map((m, idx) => (
          <GrowthMilestoneCard
            key={idx}
            idx={idx}
            milestone={m}
            onUpdate={(next) => {
              const list = novel.mc_growth_arc.slice();
              list[idx] = next;
              setNovel({ ...novel, mc_growth_arc: list });
            }}
          />
        ))}
      </Section>

      <Section title={`必出场关键剧情点（${novel.key_plot_points.length} 个）`}>
        {novel.key_plot_points.map((p, idx) => (
          <PlotPointCard
            key={idx}
            idx={idx}
            point={p}
            onUpdate={(next) => {
              const list = novel.key_plot_points.slice();
              list[idx] = next;
              setNovel({ ...novel, key_plot_points: list });
            }}
          />
        ))}
      </Section>

      {error && (
        <div data-testid="novel-outline-editor-error" className="p-2 bg-error-container/20 border border-error rounded text-error font-body-ui text-xs">
          {error}
        </div>
      )}

      <footer className="flex items-center justify-end gap-2 pt-2">
        <button
          type="button"
          data-testid="novel-outline-editor-cancel"
          onClick={handleCancel}
          disabled={busy}
          className="px-3 py-1 text-xs bg-surface-container text-system-log rounded-lg hover:bg-surface-container-low disabled:opacity-40"
        >取消</button>
        <button
          type="button"
          data-testid="novel-outline-editor-save"
          onClick={handleSave}
          disabled={busy || readOnly}
          title={readOnly ? "托管运行中,元数据已锁定" : undefined}
          className="px-4 py-1 text-xs bg-tertiary-container text-surface-container-low rounded-lg hover:opacity-90 disabled:opacity-40"
        >{busy ? "保存中…" : "保存"}</button>
      </footer>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <div className="font-label-mono text-system-log text-[10px] uppercase tracking-wider">{title}</div>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function VolumeCard({
  idx, volume, onUpdate,
}: { idx: number; volume: VolumeDivision; onUpdate: (v: VolumeDivision) => void }) {
  const summaryRef = useRef<HTMLTextAreaElement>(null);
  useAutoHeight(summaryRef, [volume.summary]);
  return (
    <div className="p-2 border border-outline-variant rounded-lg space-y-1">
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="block font-label-mono text-system-log mb-1 text-xs">卷名</label>
          <input
            data-testid={`novel-outline-volume-${idx}-name`}
            value={volume.name}
            onChange={(e) => onUpdate({ ...volume, name: e.target.value })}
            className="w-full bg-surface-container border border-outline-variant rounded px-2 py-1 text-xs text-primary focus:outline-none focus:border-primary-container"
          />
        </div>
        <div>
          <label className="block font-label-mono text-system-log mb-1 text-xs">章节范围</label>
          <input
            data-testid={`novel-outline-volume-${idx}-range`}
            value={volume.chapter_range}
            onChange={(e) => onUpdate({ ...volume, chapter_range: e.target.value })}
            className="w-full bg-surface-container border border-outline-variant rounded px-2 py-1 text-xs text-primary focus:outline-none focus:border-primary-container"
          />
        </div>
      </div>
      <div>
        <label className="block font-label-mono text-system-log mb-1 text-xs">概要</label>
        <textarea
          ref={summaryRef}
          data-testid={`novel-outline-volume-${idx}-summary`}
          value={volume.summary}
          onChange={(e) => onUpdate({ ...volume, summary: e.target.value })}
          className="w-full bg-surface-container border border-outline-variant rounded px-2 py-1 text-xs text-primary focus:outline-none focus:border-primary-container overflow-hidden"
        />
      </div>
      <div>
        <label className="block font-label-mono text-system-log mb-1 text-xs">
          关键事件（、分隔）
        </label>
        <input
          data-testid={`novel-outline-volume-${idx}-events`}
          value={(volume.key_events ?? []).join("、")}
          onChange={(e) => onUpdate({
            ...volume,
            key_events: e.target.value.split(/[、,]/).map((x) => x.trim()).filter(Boolean),
          })}
          className="w-full bg-surface-container border border-outline-variant rounded px-2 py-1 text-xs text-primary focus:outline-none focus:border-primary-container"
        />
      </div>
    </div>
  );
}

function GrowthMilestoneCard({
  idx, milestone, onUpdate,
}: { idx: number; milestone: GrowthMilestone; onUpdate: (m: GrowthMilestone) => void }) {
  const descRef = useRef<HTMLTextAreaElement>(null);
  useAutoHeight(descRef, [milestone.description]);
  return (
    <div className="p-2 border border-outline-variant rounded-lg space-y-1">
      <div>
        <label className="block font-label-mono text-system-log mb-1 text-xs">阶段标签</label>
        <input
          data-testid={`novel-outline-mc-${idx}-label`}
          value={milestone.label}
          onChange={(e) => onUpdate({ ...milestone, label: e.target.value })}
          className="w-full bg-surface-container border border-outline-variant rounded px-2 py-1 text-xs text-primary focus:outline-none focus:border-primary-container"
        />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="block font-label-mono text-system-log mb-1 text-xs">目标章节范围</label>
          <input
            data-testid={`novel-outline-mc-${idx}-range`}
            value={milestone.target_chapter_range}
            onChange={(e) => onUpdate({ ...milestone, target_chapter_range: e.target.value })}
            className="w-full bg-surface-container border border-outline-variant rounded px-2 py-1 text-xs text-primary focus:outline-none focus:border-primary-container"
          />
        </div>
      </div>
      <div>
        <label className="block font-label-mono text-system-log mb-1 text-xs">描述</label>
        <textarea
          ref={descRef}
          data-testid={`novel-outline-mc-${idx}-description`}
          value={milestone.description}
          onChange={(e) => onUpdate({ ...milestone, description: e.target.value })}
          className="w-full bg-surface-container border border-outline-variant rounded px-2 py-1 text-xs text-primary focus:outline-none focus:border-primary-container overflow-hidden"
        />
      </div>
    </div>
  );
}

function PlotPointCard({
  idx, point, onUpdate,
}: { idx: number; point: KeyPlotPoint; onUpdate: (p: KeyPlotPoint) => void }) {
  const descRef = useRef<HTMLTextAreaElement>(null);
  useAutoHeight(descRef, [point.description]);
  return (
    <div className="p-2 border border-outline-variant rounded-lg space-y-1">
      <div>
        <label className="block font-label-mono text-system-log mb-1 text-xs">标题</label>
        <input
          data-testid={`novel-outline-plot-${idx}-title`}
          value={point.title}
          onChange={(e) => onUpdate({ ...point, title: e.target.value })}
          className="w-full bg-surface-container border border-outline-variant rounded px-2 py-1 text-xs text-primary focus:outline-none focus:border-primary-container"
        />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="block font-label-mono text-system-log mb-1 text-xs">必出场卷</label>
          <input
            data-testid={`novel-outline-plot-${idx}-volume`}
            value={point.must_appear_in_volume}
            onChange={(e) => onUpdate({ ...point, must_appear_in_volume: e.target.value })}
            className="w-full bg-surface-container border border-outline-variant rounded px-2 py-1 text-xs text-primary focus:outline-none focus:border-primary-container"
          />
        </div>
        <div>
          <label className="block font-label-mono text-system-log mb-1 text-xs">触发章节提示</label>
          <input
            data-testid={`novel-outline-plot-${idx}-hint`}
            value={point.trigger_chapter_hint}
            onChange={(e) => onUpdate({ ...point, trigger_chapter_hint: e.target.value })}
            className="w-full bg-surface-container border border-outline-variant rounded px-2 py-1 text-xs text-primary focus:outline-none focus:border-primary-container"
          />
        </div>
      </div>
      <div>
        <label className="block font-label-mono text-system-log mb-1 text-xs">描述</label>
        <textarea
          ref={descRef}
          data-testid={`novel-outline-plot-${idx}-description`}
          value={point.description}
          onChange={(e) => onUpdate({ ...point, description: e.target.value })}
          className="w-full bg-surface-container border border-outline-variant rounded px-2 py-1 text-xs text-primary focus:outline-none focus:border-primary-container overflow-hidden"
        />
      </div>
    </div>
  );
}
