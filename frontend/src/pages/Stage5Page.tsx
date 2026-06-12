import { useState, useCallback, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import api, { DiagnosisReport, DiagnosisIssue } from "../api/client";
import GlassPanel from "../components/shared/GlassPanel";

const PRIORITY_LABELS: Record<string, string> = {
  P0: "严重",
  P1: "重要",
  P2: "建议",
};

const PRIORITY_COLORS: Record<string, string> = {
  P0: "bg-red-500/20 text-red-400 border-red-500/30",
  P1: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  P2: "bg-blue-500/20 text-blue-400 border-blue-500/30",
};

const CATEGORY_LABELS: Record<string, string> = {
  timeline_break: "时间线断裂",
  unresolved_conflict: "未解决冲突",
  unrevealed_mystery: "未揭示谜团",
  pending_promise: "未兑现承诺",
  unrevealed_twist: "未揭示转折",
  stalled_goal: "目标停滞",
  unrevealed_secret: "未揭示秘密",
  high_expectation: "高期待值",
  dead_foreshadowing: "死伏笔",
  stale_foreshadowing: "陈旧伏笔",
};

type FilterKey = "all" | "P0" | "P1" | "P2";

export default function Stage5Page() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();

  const [report, setReport] = useState<DiagnosisReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<FilterKey>("all");
  const [resolvedIds, setResolvedIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState("");

  const loadDiagnosis = useCallback(async () => {
    if (!projectId) return;
    try {
      const r = await api.getDiagnosis(projectId);
      setReport(r);
      setResolvedIds(new Set(
        r.issues.filter((i) => i.status !== "open").map((i) => i.id)
      ));
    } catch {
      setReport(null);
    }
  }, [projectId]);

  useEffect(() => {
    loadDiagnosis();
  }, [loadDiagnosis]);

  const handleDiagnose = async () => {
    if (!projectId) return;
    setLoading(true);
    setError("");
    try {
      const r = await api.runDiagnosis(projectId);
      setReport(r);
      setResolvedIds(new Set());
    } catch (e) {
      setError(e instanceof Error ? e.message : "诊断失败");
    } finally {
      setLoading(false);
    }
  };

  const handleResolve = async (issueId: string, action: "resolve" | "skip") => {
    if (!projectId) return;
    try {
      await api.resolveIssue(projectId, issueId, action);
      setResolvedIds((prev) => new Set(prev).add(issueId));
    } catch {
      // silent fail
    }
  };

  const handleAdvanceToExport = async () => {
    if (!projectId) return;
    try {
      await api.advance(projectId, "STAGE6");
      navigate(`/project/${projectId}/stage6`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "推进失败");
    }
  };

  const filteredIssues = report?.issues.filter((issue) => {
    if (filter === "all") return true;
    return issue.priority === filter;
  }) ?? [];

  const allP0Resolved = report?.issues
    .filter((i) => i.priority === "P0")
    .every((i) => resolvedIds.has(i.id) || i.status !== "open") ?? true;

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-display text-white">全书诊断</h2>
          <p className="text-system-log/50 mt-1 text-sm">
            扫描全部已写章节，检测时间线断裂、叙事资产遗留和伏笔完整性问题
          </p>
        </div>
        <button
          onClick={handleDiagnose}
          disabled={loading}
          className="flex items-center gap-2 rounded-lg bg-accent-purple px-5 py-2.5 text-sm font-medium text-white transition hover:bg-accent-purple/80 disabled:opacity-50"
        >
          <span className="material-symbols-outlined text-lg">
            {loading ? "progress_activity" : "refresh"}
          </span>
          {loading ? "诊断中..." : "重新诊断"}
        </button>
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      )}

      {/* Empty state */}
      {!report && !loading && (
        <GlassPanel>
          <div className="flex flex-col items-center gap-4 py-16 text-center">
            <span className="material-symbols-outlined text-5xl text-system-log/20">
              clinical_notes
            </span>
            <p className="text-system-log/40">尚无诊断报告</p>
            <button
              onClick={handleDiagnose}
              className="rounded-lg bg-accent-purple px-6 py-2.5 text-sm font-medium text-white transition hover:bg-accent-purple/80"
            >
              开始诊断
            </button>
          </div>
        </GlassPanel>
      )}

      {/* Report */}
      {report && (
        <>
          {/* Summary bar */}
          <GlassPanel>
            <div className="flex items-center gap-8">
              <span className="text-sm text-system-log/50">诊断摘要</span>
              {(["P0", "P1", "P2"] as const).map((p) => {
                const count = report.summary[`${p.toLowerCase()}_count` as keyof typeof report.summary] ?? 0;
                return (
                  <div key={p} className="flex items-center gap-2">
                    <span className={`rounded border px-2 py-0.5 text-xs font-medium ${PRIORITY_COLORS[p]}`}>
                      {p} {PRIORITY_LABELS[p]}
                    </span>
                    <span className="text-lg font-semibold text-white">{count}</span>
                  </div>
                );
              })}
            </div>
          </GlassPanel>

          {/* Filter tabs */}
          <div className="flex gap-2">
            {([
              { key: "all", label: "全部" },
              { key: "P0", label: "P0 严重" },
              { key: "P1", label: "P1 重要" },
              { key: "P2", label: "P2 建议" },
            ] as const).map(({ key, label }) => (
              <button
                key={key}
                onClick={() => setFilter(key)}
                className={`rounded-lg px-4 py-2 text-sm transition ${
                  filter === key
                    ? "bg-accent-purple/20 text-accent-purple border border-accent-purple/30"
                    : "text-system-log/50 hover:text-system-log/80 border border-transparent"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Issue list */}
          {filteredIssues.length === 0 ? (
            <GlassPanel>
              <div className="py-12 text-center text-system-log/40 text-sm">
                {filter === "all" ? "没有问题" : `无 ${filter} 级别问题`}
              </div>
            </GlassPanel>
          ) : (
            <div className="space-y-3">
              {filteredIssues.map((issue) => (
                <IssueCard
                  key={issue.id}
                  issue={issue}
                  resolved={resolvedIds.has(issue.id)}
                  onResolve={(action) => handleResolve(issue.id, action)}
                />
              ))}
            </div>
          )}

          {/* Bottom actions */}
          <div className="flex items-center justify-between pt-2">
            <button
              onClick={handleDiagnose}
              disabled={loading}
              className="flex items-center gap-2 rounded-lg border border-system-log/20 px-4 py-2 text-sm text-system-log/60 transition hover:border-system-log/40 hover:text-system-log/80 disabled:opacity-50"
            >
              <span className="material-symbols-outlined text-lg">refresh</span>
              重新诊断
            </button>

            <button
              onClick={handleAdvanceToExport}
              disabled={!allP0Resolved}
              className="flex items-center gap-2 rounded-lg bg-emerald-600 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed"
              title={!allP0Resolved ? "请先处理所有 P0 问题" : "进入导出阶段"}
            >
              <span className="material-symbols-outlined text-lg">arrow_forward</span>
              全部标记已处理 → 进入导出
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function IssueCard({
  issue,
  resolved,
  onResolve,
}: {
  issue: DiagnosisIssue;
  resolved: boolean;
  onResolve: (action: "resolve" | "skip") => void;
}) {
  return (
    <GlassPanel className={resolved ? "opacity-50" : ""}>
      <div className="flex items-start gap-4">
        {/* Priority badge */}
        <span
          className={`shrink-0 rounded border px-2 py-1 text-xs font-medium ${PRIORITY_COLORS[issue.priority]}`}
        >
          {issue.priority}
        </span>

        <div className="flex-1 min-w-0 space-y-2">
          {/* Header row */}
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-sm font-medium text-white">
              {CATEGORY_LABELS[issue.category] ?? issue.category}
            </span>
            <span className="text-xs text-system-log/40">
              第 {issue.chapter} 章
            </span>
            {issue.asset_id && (
              <span className="text-xs text-system-log/30 font-mono">
                {issue.asset_id}
              </span>
            )}
            {resolved && (
              <span className="rounded bg-emerald-500/20 px-2 py-0.5 text-xs text-emerald-400">
                已处理
              </span>
            )}
          </div>

          {/* Description */}
          <p className="text-sm text-system-log/60 leading-relaxed">
            {issue.description}
          </p>

          {/* Suggestion */}
          <div className="rounded bg-system-log/5 border border-system-log/10 px-3 py-2">
            <span className="text-xs text-system-log/40">建议: </span>
            <span className="text-xs text-system-log/50">{issue.suggestion}</span>
          </div>

          {/* Actions */}
          {!resolved && (
            <div className="flex gap-2 pt-1">
              <button
                onClick={() => onResolve("resolve")}
                className="rounded bg-emerald-600/20 px-3 py-1.5 text-xs text-emerald-400 transition hover:bg-emerald-600/30"
              >
                标记已处理
              </button>
              <button
                onClick={() => onResolve("skip")}
                className="rounded bg-system-log/10 px-3 py-1.5 text-xs text-system-log/40 transition hover:bg-system-log/20"
              >
                跳过
              </button>
            </div>
          )}
        </div>
      </div>
    </GlassPanel>
  );
}
