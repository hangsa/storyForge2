import { useState, useEffect, useCallback, useRef } from "react";
import { useParams } from "react-router-dom";
import api, { ChapterReviewData, ApiError } from "../api/client";
import GlassPanel from "../components/shared/GlassPanel";
import ProgressBar from "../components/shared/ProgressBar";
import NarrativeChip from "../components/shared/NarrativeChip";

const READER_OS_METRICS: Array<{ key: string; label: string; good: boolean }> = [
  { key: "addiction", label: "上瘾度", good: true },
  { key: "curiosity", label: "好奇心", good: true },
  { key: "tension", label: "紧张感", good: true },
  { key: "satisfaction", label: "满足感", good: true },
  { key: "discussion", label: "讨论潜力", good: true },
  { key: "fatigue", label: "疲劳度", good: false },
  { key: "frustration", label: "挫败感", good: false },
];

export default function ChapterReviewPage() {
  const { projectId } = useParams<{ projectId: string }>();

  const [chapters, setChapters] = useState<number[]>([]);
  const [selectedChapter, setSelectedChapter] = useState<number | null>(null);
  const [review, setReview] = useState<ChapterReviewData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState("");
  const [saving, setSaving] = useState(false);
  const [successMsg, setSuccessMsg] = useState("");

  const autoSelectedRef = useRef(false);

  const loadChapters = useCallback(async () => {
    if (!projectId) return;
    try {
      const list = await api.listChapterReviews(projectId);
      setChapters(list.chapters);
      setError("");
      if (list.chapters.length > 0 && !autoSelectedRef.current) {
        setSelectedChapter(list.chapters[list.chapters.length - 1]);
        autoSelectedRef.current = true;
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "加载章节列表失败");
    }
  }, [projectId]);

  useEffect(() => { loadChapters(); }, [loadChapters]);

  const loadReview = useCallback(async (chapter: number) => {
    if (!projectId) return;
    setLoading(true);
    setError("");
    setFeedback("");
    setSuccessMsg("");
    try {
      const r = await api.getChapterReview(projectId, chapter);
      setReview(r);
    } catch (e) {
      setReview(null);
      setError(e instanceof ApiError ? e.message : "加载审查数据失败");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    if (selectedChapter !== null) {
      loadReview(selectedChapter);
    }
  }, [selectedChapter, loadReview]);

  const handleDecision = async (decision: "approved" | "revise") => {
    if (!projectId || selectedChapter === null) return;
    setSaving(true);
    setSuccessMsg("");
    try {
      await api.setChapterDecision(projectId, selectedChapter, decision, feedback);
      setSuccessMsg(decision === "approved" ? "已批准本章" : "已标记为需修改");
      if (review) {
        setReview({ ...review, decision, decision_feedback: feedback });
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "保存决策失败");
    } finally {
      setSaving(false);
    }
  };

  const coherenceColor = (score: number): "primary" | "warning" | "tertiary" => {
    if (score >= 70) return "primary";
    if (score >= 40) return "warning";
    return "tertiary";
  };

  if (chapters.length === 0 && !error) {
    return (
      <div className="max-w-4xl mx-auto space-y-6">
        <div>
          <h2 className="text-3xl font-display text-white">章节审查</h2>
          <p className="text-system-log/50 mt-1 text-sm">
            查看章节连贯性评分、读者指标和叙事守卫警告
          </p>
        </div>
        <GlassPanel>
          <div className="flex flex-col items-center justify-center py-16 text-system-log/40">
            <span className="material-symbols-outlined text-5xl mb-3">rate_review</span>
            <p className="text-sm">暂无章节审查数据</p>
            <p className="text-xs mt-1">完成章节写作后，系统将自动生成审查报告</p>
          </div>
        </GlassPanel>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <h2 className="text-3xl font-display text-white">章节审查</h2>
        <p className="text-system-log/50 mt-1 text-sm">
          查看章节连贯性评分、读者指标和叙事守卫警告
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      )}

      {/* Chapter selector */}
      <div className="flex items-center gap-3">
        <span className="text-sm text-system-log/50">选择章节</span>
        <select
          value={selectedChapter ?? ""}
          onChange={(e) => setSelectedChapter(Number(e.target.value))}
          className="rounded-lg border border-outline-variant bg-surface-container px-3 py-2 text-sm text-white"
        >
          {chapters.map((ch) => (
            <option key={ch} value={ch}>第 {ch} 章</option>
          ))}
        </select>
      </div>

      {loading && (
        <GlassPanel>
          <div className="flex items-center justify-center py-16">
            <span className="material-symbols-outlined text-3xl text-system-log/30 animate-spin">
              progress_activity
            </span>
          </div>
        </GlassPanel>
      )}

      {review && !loading && (
        <>
          {/* Coherence Score */}
          <GlassPanel>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-medium text-white">连贯性评分</h3>
              <span className="text-2xl font-display text-white">{review.coherence_score}</span>
            </div>
            <ProgressBar
              value={review.coherence_score}
              color={coherenceColor(review.coherence_score)}
            />
            {review.coherence_comment && (
              <p className="mt-2 text-xs text-system-log/50">{review.coherence_comment}</p>
            )}
          </GlassPanel>

          {/* ReaderOS Gauges */}
          <GlassPanel>
            <h3 className="text-sm font-medium text-white mb-3">读者状态指标</h3>
            <div className="grid grid-cols-2 gap-x-6 gap-y-3">
              {READER_OS_METRICS.map(({ key, label, good }) => {
                const val = (review.reader_os as Record<string, number>)[key] ?? 0;
                return (
                  <ProgressBar
                    key={key}
                    label={label}
                    value={val}
                    color={good ? "primary" : "warning"}
                  />
                );
              })}
            </div>
          </GlassPanel>

          {/* Fact Guard Summary */}
          <GlassPanel>
            <h3 className="text-sm font-medium text-white mb-3">事实守卫</h3>
            <div className="flex items-center gap-4 mb-2">
              <ProgressBar
                value={review.fact_guard_summary.pass_rate * 100}
                color={review.fact_guard_summary.pass_rate >= 0.8 ? "primary" : "warning"}
              />
            </div>
            <div className="flex gap-4 text-xs text-system-log/50">
              <span>通过 {review.fact_guard_summary.passed}</span>
              <span>失败 {review.fact_guard_summary.failed}</span>
              <span>总计 {review.fact_guard_summary.total}</span>
              <span>通过率 {(review.fact_guard_summary.pass_rate * 100).toFixed(0)}%</span>
            </div>
          </GlassPanel>

          {/* Narrative Guard Warnings */}
          <GlassPanel>
            <h3 className="text-sm font-medium text-white mb-3">
              叙事守卫警告
              {review.narrative_guard_warnings.length === 0 && (
                <span className="ml-2 text-emerald-400 text-xs font-normal">全部通过</span>
              )}
            </h3>
            {review.narrative_guard_warnings.length === 0 ? (
              <div className="flex items-center gap-2 text-emerald-400 text-sm">
                <span className="material-symbols-outlined">check_circle</span>
                未检测到叙事漂移
              </div>
            ) : (
              <div className="space-y-2">
                {review.narrative_guard_warnings.map((w, i) => (
                  <div
                    key={i}
                    className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2"
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <NarrativeChip label="类型" value={w.drift_type} color="warning" />
                      <NarrativeChip label="角色" value={w.character} color="primary" />
                      {w.severity && (
                        <span className="text-xs text-system-log/40">{w.severity}</span>
                      )}
                    </div>
                    {w.description && (
                      <p className="text-xs text-system-log/50">{w.description}</p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </GlassPanel>

          {/* Writing Formula Compliance */}
          {review.writing_formula_compliance.length > 0 && (
            <GlassPanel>
              <h3 className="text-sm font-medium text-white mb-3">写作公式合规</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-system-log/50 border-b border-outline-variant">
                      <th className="pb-2 pr-4 font-medium">指标</th>
                      <th className="pb-2 pr-4 font-medium">期望值</th>
                      <th className="pb-2 pr-4 font-medium">实际值</th>
                      <th className="pb-2 font-medium">状态</th>
                    </tr>
                  </thead>
                  <tbody>
                    {review.writing_formula_compliance.map((item, i) => (
                      <tr key={i} className="border-b border-system-log/10">
                        <td className="py-2 pr-4 text-system-log/80">{item.metric}</td>
                        <td className="py-2 pr-4 text-system-log/50 font-mono">
                          {typeof item.expected === "object"
                            ? JSON.stringify(item.expected)
                            : String(item.expected)}
                        </td>
                        <td className="py-2 pr-4 text-system-log/50 font-mono">
                          {typeof item.actual === "object"
                            ? JSON.stringify(item.actual)
                            : String(item.actual)}
                        </td>
                        <td className="py-2">
                          <span
                            className={`text-xs ${item.passed ? "text-emerald-400" : "text-red-400"}`}
                          >
                            {item.passed ? "通过" : "未通过"}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </GlassPanel>
          )}

          {/* Style Guard Violations */}
          {review.style_guard_violations.length > 0 && (
            <GlassPanel>
              <h3 className="text-sm font-medium text-white mb-3">风格守卫违规</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-system-log/50 border-b border-outline-variant">
                      <th className="pb-2 pr-4 font-medium">类型</th>
                      <th className="pb-2 pr-4 font-medium">详情</th>
                    </tr>
                  </thead>
                  <tbody>
                    {review.style_guard_violations.map((v, i) => (
                      <tr key={i} className="border-b border-system-log/10">
                        <td className="py-2 pr-4 text-system-log/80">
                          {v.violation_type || v.type || "unknown"}
                        </td>
                        <td className="py-2 text-system-log/50">
                          {v.description || v.detail || JSON.stringify(v)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </GlassPanel>
          )}

          {/* Discussion Topics */}
          {review.discussion_topics.length > 0 && (
            <GlassPanel>
              <h3 className="text-sm font-medium text-white mb-3">讨论话题</h3>
              <div className="space-y-2">
                {review.discussion_topics.map((topic, i) => (
                  <div
                    key={i}
                    className="flex items-start gap-2 rounded-lg border border-primary-container/20 bg-primary-container/5 px-3 py-2"
                  >
                    <span className="material-symbols-outlined text-lg text-primary-container shrink-0 mt-0.5">
                      lightbulb
                    </span>
                    <p className="text-sm text-system-log/70">{topic}</p>
                  </div>
                ))}
              </div>
            </GlassPanel>
          )}

          {/* Decision Panel */}
          <GlassPanel>
            <h3 className="text-sm font-medium text-white mb-3">作者决策</h3>
            {review.decision ? (
              <div className="flex items-center gap-3">
                <NarrativeChip
                  label="决策"
                  value={review.decision === "approved" ? "已批准" : "需修改"}
                  color={review.decision === "approved" ? "primary" : "warning"}
                />
                {review.decision_feedback && (
                  <span className="text-xs text-system-log/50">{review.decision_feedback}</span>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                <textarea
                  value={feedback}
                  onChange={(e) => setFeedback(e.target.value)}
                  placeholder="可选：添加决策反馈..."
                  rows={2}
                  className="w-full rounded-lg border border-outline-variant bg-surface-container px-3 py-2 text-sm text-white placeholder:text-system-log/30"
                />
                <div className="flex items-center gap-3">
                  {successMsg && (
                    <span className="text-xs text-emerald-400">{successMsg}</span>
                  )}
                  <button
                    onClick={() => handleDecision("approved")}
                    disabled={saving}
                    className="flex items-center gap-2 rounded-lg bg-emerald-600 px-5 py-2 text-sm font-medium text-white transition hover:bg-emerald-500 disabled:opacity-50"
                  >
                    <span className="material-symbols-outlined text-lg">check</span>
                    批准
                  </button>
                  <button
                    onClick={() => handleDecision("revise")}
                    disabled={saving}
                    className="flex items-center gap-2 rounded-lg bg-amber-600 px-5 py-2 text-sm font-medium text-white transition hover:bg-amber-500 disabled:opacity-50"
                  >
                    <span className="material-symbols-outlined text-lg">edit</span>
                    需修改
                  </button>
                </div>
              </div>
            )}
          </GlassPanel>
        </>
      )}
    </div>
  );
}
