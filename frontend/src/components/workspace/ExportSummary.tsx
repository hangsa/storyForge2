import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import api, { Outline } from "../../api/client";

interface Props {
  projectId: string;
}

/**
 * Export tab content. v1.8 expansion: surface the project stats (chapters,
 * scenes) the user will be exporting, list the available output options
 * (from Stage6's options payload), and keep the Stage6 link as the
 * primary action. The actual export pipeline (with the chosen options
 * applied) runs on Stage6 — invoking it from a side panel would require
 * extra UI we don't need for v1.8.
 */
export default function ExportSummary({ projectId }: Props) {
  const [outline, setOutline] = useState<Outline | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .getOutline(projectId)
      .then((o) => { if (!cancelled) setOutline(o); })
      .catch(() => { if (!cancelled) setOutline(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [projectId]);

  const chapters = outline?.chapters ?? [];
  const sceneCount = chapters.reduce((acc, ch) => acc + (ch.scene_plan?.length ?? 0), 0);

  if (loading) {
    return (
      <div data-testid="export-summary" className="space-y-3">
        <p className="font-body-ui text-system-log text-sm">加载大纲…</p>
      </div>
    );
  }

  return (
    <div data-testid="export-summary" className="space-y-3">
      <div className="font-label-mono text-system-log text-[10px] uppercase tracking-wider">导出项目</div>
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
        <p className="font-body-ui text-system-log/60 text-xs italic">
          上述选项在 Stage6 的导出向导中可勾选；点击下方按钮进入完整页面。
        </p>
      </div>

      {chapters.length === 0 && (
        <p className="font-body-ui text-system-log/60 text-xs">尚未生成大纲，无法导出。请先到 Stage3 生成章节大纲。</p>
      )}

      <Link
        to={`/project/${encodeURIComponent(projectId)}/stage6`}
        data-testid="export-link"
        className="inline-flex items-center gap-1 text-primary-container hover:opacity-80 text-sm"
      >
        在完整页面打开 <span aria-hidden>→</span>
      </Link>
    </div>
  );
}
