import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import api, { DiagnosisIssue, DiagnosisReport } from "../../api/client";

interface Props {
  projectId: string;
}

/**
 * Diagnosis tab content. v1.8 expansion: real information display +
 * operable from the panel (not just a link to Stage5). Shows the
 * latest diagnosis report (P0/P1/P2 counts + open issues list) and
 * exposes a "重新诊断" button that calls api.runDiagnosis() in place.
 * Detailed issue editing lives on Stage5 (per-Issue resolve/skip UI);
 * we keep the Stage5 link as a secondary action.
 */
export default function DiagnosisSummary({ projectId }: Props) {
  const [report, setReport] = useState<DiagnosisReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    let cancelled = false;
    setLoading(true);
    api
      .getDiagnosis(projectId)
      .then((r) => { if (!cancelled) setReport(r); })
      .catch(() => { if (!cancelled) setReport(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
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

  if (loading) {
    return (
      <div data-testid="diagnosis-summary" className="space-y-3">
        <p className="font-body-ui text-system-log text-sm">加载诊断报告…</p>
      </div>
    );
  }

  if (!report) {
    return (
      <div data-testid="diagnosis-summary" className="space-y-3">
        <p className="font-body-ui text-system-log text-sm">尚未运行诊断。</p>
        <button
          type="button"
          data-testid="diagnosis-run"
          onClick={handleRun}
          disabled={running}
          className="px-4 py-1 text-sm bg-tertiary-container text-surface-container-low rounded-lg hover:opacity-90 disabled:opacity-40"
        >{running ? "运行中…" : "运行诊断"}</button>
        {error && (
          <p data-testid="diagnosis-error" className="font-body-ui text-error text-xs">{error}</p>
        )}
        <Link
          to={`/project/${encodeURIComponent(projectId)}/stage5`}
          data-testid="diagnosis-link"
          className="inline-flex items-center gap-1 text-primary-container hover:opacity-80 text-sm"
        >
          在完整页面打开 <span aria-hidden>→</span>
        </Link>
      </div>
    );
  }

  const openIssues = (report.issues ?? []).filter((i) => i.status === "open");
  const { p0_count, p1_count, p2_count } = report.summary ?? { p0_count: 0, p1_count: 0, p2_count: 0 };

  return (
    <div data-testid="diagnosis-summary" className="space-y-3">
      <div className="font-label-mono text-system-log text-[10px] uppercase tracking-wider">诊断概览</div>
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

      <div className="flex items-center gap-3 pt-1">
        <button
          type="button"
          data-testid="diagnosis-rerun"
          onClick={handleRun}
          disabled={running}
          className="px-4 py-1 text-sm bg-tertiary-container text-surface-container-low rounded-lg hover:opacity-90 disabled:opacity-40"
        >{running ? "运行中…" : "重新诊断"}</button>
        <Link
          to={`/project/${encodeURIComponent(projectId)}/stage5`}
          data-testid="diagnosis-link"
          className="inline-flex items-center gap-1 text-primary-container hover:opacity-80 text-sm"
        >
          在完整页面打开 <span aria-hidden>→</span>
        </Link>
      </div>
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
