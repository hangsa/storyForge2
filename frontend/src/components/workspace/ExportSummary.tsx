import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import api, { NovelOutline, Outline } from "../../api/client";
import { computePlannedTotal } from "../../utils/outline";

interface Props {
  projectId: string;
}

/**
 * Export tab content. v1.9 expansion: always surfaces project context
 * (actual chapter count vs planned total) so the user sees real numbers
 * even before any chapters are written. The "在完整页面打开" link is the
 * primary action (Stage6 has the actual export wizard with all the
 * options applied); the panel shows a preview of the available options
 * so the user knows what to expect.
 */
export default function ExportSummary({ projectId }: Props) {
  const [outline, setOutline] = useState<Outline | null>(null);
  const [plannedTotal, setPlannedTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      api.getOutline(projectId).catch(() => null),
      api.getNovelOutline(projectId).catch(() => null),
    ]).then(([o, n]) => {
      if (cancelled) return;
      setOutline(o);
      setPlannedTotal(computePlannedTotal(n as NovelOutline | null));
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [projectId]);

  const chapters = outline?.chapters ?? [];
  const sceneCount = chapters.reduce((acc, ch) => acc + (ch.scene_plan?.length ?? 0), 0);

  return (
    <div data-testid="export-summary" className="space-y-3">
      <div data-testid="export-context" className="p-2 rounded-lg bg-surface-container border border-outline-variant space-y-1">
        <div className="font-label-mono text-system-log text-[10px] uppercase tracking-wider">项目状态</div>
        <div className="font-body-ui text-system-log text-xs">
          {chapters.length > 0
            ? <>已规划 <span className="text-primary font-medium">{chapters.length}</span> 章 · <span className="text-primary font-medium">{sceneCount}</span> 个场景{plannedTotal > 0 && <> · 全书计划 {plannedTotal} 章</>}</>
            : plannedTotal > 0
              ? <>全书计划 {plannedTotal} 章 · 尚未生成章节大纲</>
              : <>尚未生成章节大纲 — 请先到 Stage3 生成大纲</>}
        </div>
      </div>

      <div data-testid="export-stats" className="grid grid-cols-2 gap-2 text-center">
        <div className="p-2 rounded-lg bg-surface-container border border-outline-variant">
          <div className="font-display text-primary text-lg">{chapters.length}</div>
          <div className="font-label-mono text-system-log text-[10px] uppercase">章</div>
        </div>
        <div className="p-2 rounded-lg bg-surface-container border border-outline-variant">
          <div className="font-display text-primary text-lg">{sceneCount}</div>
          <div className="font-label-mono text-system-log text-[10px] uppercase">场景</div>
        </div>
      </div>

      <div className="space-y-1">
        <div className="font-label-mono text-system-log text-[10px] uppercase tracking-wider">输出选项（Stage6 中可选）</div>
        <ul className="font-body-ui text-system-log text-xs space-y-0.5 list-disc pl-4">
          <li>是否去除 SF_LOG 标记</li>
          <li>是否添加目录 (TOC)</li>
          <li>是否添加扉页 (title page)</li>
        </ul>
      </div>

      {chapters.length === 0 && (
        <p data-testid="export-empty" className="font-body-ui text-system-log/60 text-xs">尚未生成大纲，无法导出。请先到 Stage3 生成章节大纲。</p>
      )}

      <div className="border-t border-outline-variant pt-2">
        <Link
          to={`/project/${encodeURIComponent(projectId)}/stage6`}
          data-testid="export-link"
          className="inline-flex items-center gap-1 text-system-log/70 hover:text-primary-container text-xs"
        >
          在完整页面打开 <span aria-hidden>→</span>
        </Link>
      </div>
    </div>
  );
}
