import { useState, useCallback } from "react";
import { useParams } from "react-router-dom";
import api, { ImpactReport, ApiError } from "../api/client";
import GlassPanel from "../components/shared/GlassPanel";

const FILE_LABELS: Record<string, string> = {
  "story_dna.json": "故事DNA",
  "world.json": "世界观",
  "characters.json": "角色设定",
  "outline.json": "章节大纲",
};

const PRIORITY_COLORS: Record<string, string> = {
  P0: "bg-error/10 text-error border-error/30",
  P1: "bg-warning/10 text-warning-p1 border-warning-p1/30",
  P2: "bg-tertiary-container/10 text-tertiary-container border-tertiary-container/30",
};

const PRIORITY_LABELS: Record<string, string> = {
  P0: "严重",
  P1: "重要",
  P2: "建议",
};

export default function ImpactAnalysisPage() {
  const { projectId } = useParams<{ projectId: string }>();

  const [report, setReport] = useState<ImpactReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState("");
  const [decided, setDecided] = useState(false);
  const [decidedAction, setDecidedAction] = useState<"confirm" | "cancel" | null>(null);
  const [noChanges, setNoChanges] = useState(false);
  const [noBaseline, setNoBaseline] = useState(false);

  const resetState = useCallback(() => {
    setReport(null);
    setError(null);
    setSuccessMsg("");
    setDecided(false);
    setDecidedAction(null);
    setNoChanges(false);
    setNoBaseline(false);
  }, []);

  const handleAnalyze = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    setError(null);
    setSuccessMsg("");
    setReport(null);
    setNoChanges(false);
    setNoBaseline(false);
    setDecided(false);
    setDecidedAction(null);

    try {
      await api.advance(projectId, "STAGE4");
    } catch (e) {
      const apiErr = e instanceof ApiError ? e : null;
      const fromStage = (apiErr?.detail as Record<string, unknown>)?.from_stage as string | undefined;
      if (!fromStage || !["STAGE4", "STAGE5", "STAGE6"].includes(fromStage)) {
        setError(e instanceof ApiError ? e.message : "无法进入分析阶段");
        setLoading(false);
        return;
      }
    }

    try {
      const result = await api.analyzeImpact(projectId);
      setReport(result);
    } catch (e) {
      if (e instanceof ApiError) {
        if (e.code === "BASELINE_NOT_FOUND") {
          setNoBaseline(true);
        } else if (e.code === "NO_CHANGES_DETECTED") {
          setNoChanges(true);
        } else {
          setError(e.message);
        }
      } else {
        setError("分析失败");
      }
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  const handleRollback = useCallback(async (action: "confirm" | "cancel") => {
    if (!projectId) return;
    setLoading(true);
    setError(null);
    setSuccessMsg("");
    try {
      const result = await api.executeRollback(projectId, action);
      setDecided(true);
      setDecidedAction(action);
      if (result.baseline_updated) {
        setSuccessMsg("基线已更新");
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "操作失败");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  const showInitial = !report && !loading && !noChanges && !noBaseline && !decided;

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-display text-white">影响分析</h2>
          <p className="text-system-log/50 mt-1 text-sm">
            检测 STAGE 1-3 设定文件变更对已写内容的影响
          </p>
        </div>
        <button
          onClick={handleAnalyze}
          disabled={loading}
          className="flex items-center gap-2 rounded-lg bg-accent-purple/20 text-accent-purple border border-accent-purple/30 px-5 py-2 text-sm transition hover:bg-accent-purple/30 disabled:opacity-50"
        >
          <span className="material-symbols-outlined text-lg">
            {loading ? "progress_activity" : "refresh"}
          </span>
          {loading ? "分析中..." : "分析影响"}
        </button>
      </div>

      {/* Error banner */}
      {error && !noChanges && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      )}

      {/* Success message */}
      {successMsg && (
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-400 flex items-center gap-2">
          <span className="material-symbols-outlined text-lg">check_circle</span>
          {successMsg}
        </div>
      )}

      {/* Initial / Empty state */}
      {showInitial && (
        <GlassPanel>
          <div className="flex flex-col items-center justify-center py-16 text-system-log/40">
            <span className="material-symbols-outlined text-5xl mb-3">find_in_page</span>
            <p className="text-sm">尚未运行影响分析</p>
            <p className="text-xs mt-1">修改 STAGE 1-3 设定文件后，点击上方按钮检测影响范围</p>
          </div>
        </GlassPanel>
      )}

      {/* No-baseline state */}
      {noBaseline && (
        <GlassPanel>
          <div className="flex flex-col items-center justify-center py-16 text-system-log/40">
            <span className="material-symbols-outlined text-5xl mb-3">info</span>
            <p className="text-sm">尚未建立基线</p>
            <p className="text-xs mt-1 text-center max-w-md leading-relaxed">
              基线在首次进入 STAGE 4 写作阶段时自动创建。<br />
              请先完成写作流程进入 STAGE 4，修改 STAGE 1-3 设定后重新进行分析。
            </p>
          </div>
        </GlassPanel>
      )}

      {/* No-changes state */}
      {noChanges && (
        <GlassPanel>
          <div className="flex flex-col items-center justify-center py-16">
            <span className="material-symbols-outlined text-5xl mb-3 text-emerald-400">check_circle</span>
            <p className="text-sm text-emerald-400">所有文件与基线一致</p>
            <p className="text-xs mt-1 text-system-log/40">STAGE 1-3 设定文件未发生变更，已写内容不受影响</p>
          </div>
        </GlassPanel>
      )}

      {/* Loading state */}
      {loading && (
        <GlassPanel>
          <div className="flex items-center justify-center py-16">
            <span className="material-symbols-outlined text-3xl text-system-log/30 animate-spin">
              progress_activity
            </span>
          </div>
        </GlassPanel>
      )}

      {/* Analysis Results */}
      {report && !decided && !loading && (
        <>
          {/* Summary bar */}
          <GlassPanel>
            <h3 className="text-sm font-medium text-system-log/50 mb-4">影响摘要</h3>
            <div className="flex items-center gap-8">
              {(["P0", "P1", "P2"] as const).map((p) => (
                <div key={p} className="flex items-center gap-3">
                  <span className={`text-xs px-2 py-0.5 rounded border font-label-mono ${PRIORITY_COLORS[p]}`}>
                    {p} {PRIORITY_LABELS[p]}
                  </span>
                  <span className="text-lg font-semibold text-white">
                    {report.summary[p] ?? 0}
                  </span>
                </div>
              ))}
            </div>
            {report.summary.P0 === 0 && report.summary.P1 === 0 && report.summary.P2 === 0 && (
              <p className="text-sm text-emerald-400 mt-3">无影响项</p>
            )}
          </GlassPanel>

          {/* Modified files */}
          <GlassPanel>
            <h3 className="text-sm font-medium text-white mb-3">已变更文件</h3>
            <div className="space-y-2">
              {report.modified_files.map((file) => (
                <div key={file} className="flex items-center gap-3 p-2 bg-surface-container rounded">
                  <span className="material-symbols-outlined text-system-log text-lg">description</span>
                  <span className="text-sm text-primary">{FILE_LABELS[file] || file}</span>
                  <span className="text-xs text-system-log/50 font-mono">{file}</span>
                </div>
              ))}
            </div>
          </GlassPanel>

          {/* Impact entries */}
          <GlassPanel>
            <h3 className="text-sm font-medium text-white mb-4">影响详情</h3>
            {report.entries.length === 0 ? (
              <p className="text-sm text-system-log/40 text-center py-8">无受影响的章节</p>
            ) : (
              <div className="space-y-3">
                {report.entries.map((entry, i) => (
                  <div key={i} className="p-4 bg-surface-container rounded-lg border border-outline-variant">
                    <div className="flex items-center gap-3 mb-3 flex-wrap">
                      <span className={`text-xs px-2 py-0.5 rounded border font-label-mono ${PRIORITY_COLORS[entry.priority] || "bg-surface-container text-system-log border-surface-container-low"}`}>
                        {entry.priority} {PRIORITY_LABELS[entry.priority] || entry.priority}
                      </span>
                      <span className="text-sm text-primary font-label-mono">
                        {entry.chapter_number === 0 ? "全局影响" : `第 ${entry.chapter_number} 章`}
                      </span>
                      {entry.scene_numbers.length > 0 && (
                        <span className="text-xs text-system-log font-mono">
                          场景: {entry.scene_numbers.join(", ")}
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-system-log/60 mb-3 leading-relaxed">{entry.reason}</p>
                    {entry.affected_assets.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {entry.affected_assets.map((asset) => (
                          <span key={asset} className="text-xs px-2 py-0.5 rounded font-mono bg-surface-container-low text-system-log border border-outline-variant">
                            {FILE_LABELS[asset] || asset}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </GlassPanel>

          {/* Decision panel */}
          <GlassPanel>
            <h3 className="text-sm font-medium text-white mb-3">操作决策</h3>
            <p className="text-sm text-system-log/60 mb-4 leading-relaxed">
              确认变更将接受当前设定作为新基线；取消变更则需要手动还原 STAGE 1-3 文件。
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => handleRollback("confirm")}
                disabled={loading}
                className="flex items-center gap-2 rounded-lg bg-emerald-600 px-5 py-2 text-sm font-medium text-white transition hover:bg-emerald-500 disabled:opacity-50"
              >
                <span className="material-symbols-outlined text-lg">check</span>
                确认变更
              </button>
              <button
                onClick={() => handleRollback("cancel")}
                disabled={loading}
                className="flex items-center gap-2 rounded-lg bg-amber-600 px-5 py-2 text-sm font-medium text-white transition hover:bg-amber-500 disabled:opacity-50"
              >
                <span className="material-symbols-outlined text-lg">undo</span>
                取消变更
              </button>
            </div>
          </GlassPanel>
        </>
      )}

      {/* Post-decision state */}
      {decided && decidedAction && (
        <GlassPanel>
          <div className="flex flex-col items-center py-12">
            {decidedAction === "confirm" ? (
              <>
                <span className="material-symbols-outlined text-5xl mb-3 text-emerald-400">check_circle</span>
                <p className="text-sm text-emerald-400">变更已确认，基线已更新</p>
                <p className="text-xs text-system-log/40 mt-1">当前设定已作为新基线保存</p>
              </>
            ) : (
              <>
                <span className="material-symbols-outlined text-5xl mb-3 text-amber-400">info</span>
                <p className="text-sm text-amber-400">变更已取消</p>
                <p className="text-xs text-system-log/40 mt-1 text-center max-w-md leading-relaxed">
                  请将 STAGE 1-3 设定文件还原至修改前的状态，<br />
                  或重新进入对应阶段调整设定
                </p>
              </>
            )}
            <button
              onClick={resetState}
              className="mt-6 flex items-center gap-2 rounded-lg bg-surface-container px-4 py-2 text-sm text-system-log hover:text-primary transition-colors"
            >
              <span className="material-symbols-outlined text-lg">refresh</span>
              重新分析
            </button>
          </div>
        </GlassPanel>
      )}
    </div>
  );
}
