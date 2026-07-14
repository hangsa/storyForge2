import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import api, { DiagnosisIssue, DiagnosisReport, NovelOutline, Outline } from "../../api/client";
import { computePlannedTotal } from "../../utils/outline";

interface Props {
  projectId: string;
}

interface ProjectContext {
  /** Total chapters in outline.json (0 if no outline yet). */
  chapterCount: number;
  /** Planned total from novel_outline.json's volume chapter_range (0 if none). */
  plannedTotal: number;
}

/**
 * Diagnosis tab content. v1.9 expansion: shows real project context
 * (chapter count + planned total) at all times, then layers the latest
 * diagnosis report on top when one exists. The "运行诊断"/"重新诊断"
 * buttons call api.runDiagnosis in place. Detailed per-issue editing
 * lives on Stage5 — the link is kept as a secondary action so the
 * panel doesn't have to clone Stage5's full UI.
 */
export default function DiagnosisSummary({ projectId }: Props) {
  const [report, setReport] = useState<DiagnosisReport | null>(null);
  const [ctx, setCtx] = useState<ProjectContext>({ chapterCount: 0, plannedTotal: 0 });
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    let cancelled = false;
    setLoading(true);
    // Fetch the diagnosis + the project context (outline + novel_outline)
    // in parallel. The context fetch is best-effort — if either is missing
    // (404), we just show 0 for that field. This way the panel always
    // surfaces "本项目 N 章待诊断" even when no diagnosis has been run.
    Promise.all([
      api.getDiagnosis(projectId).catch(() => null),
      api.getOutline(projectId).catch(() => null),
      api.getNovelOutline(projectId).catch(() => null),
    ]).then(([report, outline, novelOutline]) => {
      if (cancelled) return;
      setReport(report);
      setCtx({
        chapterCount: countChapters(outline),
        plannedTotal: computePlannedTotal(novelOutline as NovelOutline | null),
      });
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  };

  useEffect(() => {
    const cancel = load();
    return cancel;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const handleRun = async () => {
    setRunning(true);
    setError(null);
    try {
      const r = await api.runDiagnosis(projectId);
      setReport(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : "运行诊断失败");
    } finally {
      setRunning(false);
    }
  };

  return (
    <div data-testid="diagnosis-summary" className="space-y-3">
      {/* Project context strip — always shown so the user sees real
          numbers, not just a link. */}
      <div data-testid="diagnosis-context" className="p-2 rounded-lg bg-surface-container border border-outline-variant space-y-1">
        <div className="font-label-mono text-system-log text-[10px] uppercase tracking-wider">项目状态</div>
        <div className="font-body-ui text-system-log text-xs">
          {ctx.chapterCount > 0
            ? <>已规划 <span className="text-primary font-medium">{ctx.chapterCount}</span> 章{ctx.plannedTotal > 0 && <> · 全书计划 {ctx.plannedTotal} 章</>}</>
            : ctx.plannedTotal > 0
              ? <>全书计划 {ctx.plannedTotal} 章 · 尚未生成章节大纲</>
              : <>尚未生成章节大纲 — 请先到 Stage3 生成大纲</>}
        </div>
      </div>

      {loading ? (
        <p className="font-body-ui text-system-log text-sm">加载诊断报告…</p>
      ) : !report ? (
        <div className="space-y-3">
          <p data-testid="diagnosis-empty" className="font-body-ui text-system-log text-sm">
            尚未运行诊断。
            {ctx.chapterCount > 0
              ? `点击下方按钮对 ${ctx.chapterCount} 章内容进行一致性 / 质量检查。`
              : "（需要先生成章节大纲才能进行诊断）"}
          </p>
          <button
            type="button"
            data-testid="diagnosis-run"
            onClick={handleRun}
            disabled={running || ctx.chapterCount === 0}
            className="px-4 py-1 text-sm bg-tertiary-container text-surface-container-low rounded-lg hover:opacity-90 disabled:opacity-40"
          >{running ? "运行中…" : "运行诊断"}</button>
          {error && (
            <p data-testid="diagnosis-error" className="font-body-ui text-error text-xs">{error}</p>
          )}
        </div>
      ) : (
        <ReportBody report={report} running={running} onRerun={handleRun} error={error} />
      )}

      <div className="border-t border-outline-variant pt-2">
        <Link
          to={`/project/${encodeURIComponent(projectId)}/stage5`}
          data-testid="diagnosis-link"
          className="inline-flex items-center gap-1 text-system-log/70 hover:text-primary-container text-xs"
        >
          在完整页面打开 <span aria-hidden>→</span>
        </Link>
      </div>
    </div>
  );
}

function ReportBody({ report, running, onRerun, error }: {
  report: DiagnosisReport;
  running: boolean;
  onRerun: () => void;
  error: string | null;
}) {
  const openIssues = (report.issues ?? []).filter((i) => i.status === "open");
  const { p0_count, p1_count, p2_count } = report.summary ?? { p0_count: 0, p1_count: 0, p2_count: 0 };

  return (
    <div className="space-y-3">
      <div className="font-label-mono text-system-log text-[10px] uppercase tracking-wider">诊断结果</div>
      <div data-testid="diagnosis-stats" className="grid grid-cols-3 gap-2 text-center">
        <div className="p-2 rounded-lg bg-error-container/20 border border-error/40">
          <div className="font-display text-error text-lg">{p0_count}</div>
          <div className="font-label-mono text-system-log text-[10px] uppercase">P0</div>
        </div>
        <div className="p-2 rounded-lg bg-surface-container border border-outline-variant">
          <div className="font-display text-primary text-lg">{p1_count}</div>
          <div className="font-label-mono text-system-log text-[10px] uppercase">P1</div>
        </div>
        <div className="p-2 rounded-lg bg-surface-container border border-outline-variant">
          <div className="font-display text-primary text-lg">{p2_count}</div>
          <div className="font-label-mono text-system-log text-[10px] uppercase">P2</div>
        </div>
      </div>
      <p className="font-body-ui text-system-log/70 text-xs">
        全书 {report.total_chapters ?? 0} 章 · 开放问题 {openIssues.length} / {report.issues?.length ?? 0}
      </p>

      {openIssues.length > 0 && (
        <div className="space-y-1">
          <div className="font-label-mono text-system-log text-[10px] uppercase tracking-wider">待处理问题（最多展示 5 条）</div>
          {openIssues.slice(0, 5).map((iss) => (
            <IssueRow key={iss.id} issue={iss} />
          ))}
          {openIssues.length > 5 && (
            <p className="font-body-ui text-system-log/60 text-xs">还有 {openIssues.length - 5} 条问题 — 在 Stage5 查看全部。</p>
          )}
        </div>
      )}

      {error && (
        <p data-testid="diagnosis-error" className="font-body-ui text-error text-xs">{error}</p>
      )}

      <button
        type="button"
        data-testid="diagnosis-rerun"
        onClick={onRerun}
        disabled={running}
        className="px-4 py-1 text-sm bg-tertiary-container text-surface-container-low rounded-lg hover:opacity-90 disabled:opacity-40"
      >{running ? "运行中…" : "重新诊断"}</button>
    </div>
  );
}

const PRIORITY_CLASS: Record<DiagnosisIssue["priority"], string> = {
  P0: "text-error",
  P1: "text-primary",
  P2: "text-system-log",
};

function IssueRow({ issue }: { issue: DiagnosisIssue }) {
  return (
    <div data-testid={`diagnosis-issue-${issue.id}`} className="p-2 border border-outline-variant rounded-lg space-y-0.5">
      <div className={`font-label-mono text-[10px] uppercase tracking-wider ${PRIORITY_CLASS[issue.priority]}`}>
        {issue.priority} · {issue.category} · 第 {issue.chapter} 章
      </div>
      <p className="font-body-ui text-primary text-xs">{issue.description}</p>
      {issue.suggestion && (
        <p className="font-body-ui text-system-log/70 text-xs italic">建议：{issue.suggestion}</p>
      )}
    </div>
  );
}

function countChapters(outline: Outline | null | undefined): number {
  if (!outline || !Array.isArray(outline.chapters)) return 0;
  return outline.chapters.length;
}
