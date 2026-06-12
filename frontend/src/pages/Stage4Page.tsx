import { useState, useCallback, useEffect } from "react";
import { useParams } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import api, { ParsedLog, CheckResult, ProgressFile } from "../api/client";
import { useStage4Writing } from "../hooks/useStage4Writing";
import GlassPanel from "../components/shared/GlassPanel";
import ChapterProgress from "../components/stage4/ChapterProgress";

const LOG_TYPE_LABELS: Record<string, string> = {
  character_relation_change: "角色关系",
  character_emotion: "角色情感",
  knowledge_gain: "知识获取",
  conflict_escalate: "冲突升级",
  mystery_clue: "线索揭露",
  twist_reveal: "转折揭示",
  expectation_fulfill: "期望满足",
  goal_milestone: "目标里程碑",
  registry_create: "注册创建",
  character_location_change: "位置变更",
  character_physical_change: "物理变更",
};

export default function Stage4Page() {
  const { projectId } = useParams<{ projectId: string }>();
  const { state, writeScene, forcePass, skipScene, loadDraft, reset } = useStage4Writing();

  const [chapterNum, setChapterNum] = useState(1);
  const [sceneNum, setSceneNum] = useState(1);
  const [progress, setProgress] = useState<ProgressFile | null>(null);
  const [showCircuitBreaker, setShowCircuitBreaker] = useState(false);
  const [advancing, setAdvancing] = useState(false);

  const loadProgress = useCallback(async () => {
    if (!projectId) return;
    try {
      const p = await api.getStage4Progress(projectId);
      setProgress(p);
      if (p.current_chapter) setChapterNum(p.current_chapter);
    } catch {
      // silent fail on progress load
    }
  }, [projectId]);

  useEffect(() => {
    loadProgress();
  }, [loadProgress]);

  const handleWrite = async () => {
    if (!projectId) return;
    await writeScene(projectId, chapterNum, sceneNum);
    loadProgress();
  };

  const handleForcePass = async () => {
    if (!projectId) return;
    await forcePass(projectId, sceneNum);
    setShowCircuitBreaker(false);
    loadProgress();
  };

  const handleSkip = async () => {
    if (!projectId) return;
    await skipScene(projectId, sceneNum);
    reset();
    loadProgress();
  };

  const handleNextScene = () => {
    if (!projectId) return;
    const nextScene = sceneNum + 1;
    setSceneNum(nextScene);
    loadDraft(projectId, chapterNum, nextScene);
  };

  const handlePrevScene = () => {
    if (!projectId || sceneNum <= 1) return;
    const prevScene = sceneNum - 1;
    setSceneNum(prevScene);
    loadDraft(projectId, chapterNum, prevScene);
  };

  const handleSceneChange = (scene: number) => {
    if (!projectId || scene < 1) return;
    setSceneNum(scene);
    loadDraft(projectId, chapterNum, scene);
  };

  const handleChapterNumChange = (chapter: number) => {
    if (!projectId || chapter < 1) return;
    setChapterNum(chapter);
    setSceneNum(1);
    loadDraft(projectId, chapter, 1);
  };

  const handleChapterChange = (chapter: number) => {
    if (!projectId) return;
    setChapterNum(chapter);
    setSceneNum(1);
    loadDraft(projectId, chapter, 1);
  };

  const handleAdvance = async () => {
    if (!projectId) return;
    setAdvancing(true);
    try {
      await api.advanceChapter(projectId);
      loadProgress();
    } catch {
      // silent fail
    } finally {
      setAdvancing(false);
    }
  };

  if (!projectId) return null;

  const sceneFromProgress = progress?.chapters
    ?.find((c) => c.chapter_number === chapterNum)
    ?.scenes?.find((s) => s.scene_number === sceneNum);

  const checkLabels: Record<number, string> = {
    1: "时间线连续性",
    2: "角色状态一致性",
    3: "世界规则合规",
    4: "注册表合规性",
    5: "日志完整性",
  };

  return (
    <div className="max-w-full mx-auto py-8 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-4xl font-bold text-primary-container">写作中心</h1>
          <p className="font-body-ui text-system-log mt-1">
            端到端写作循环：撰写 → 审查 → 解析 → 注册表更新
          </p>
        </div>
        <div className="flex items-center gap-3">
          {state.status !== "idle" && (
            <button
              onClick={reset}
              className="px-4 py-2 bg-surface-container text-system-log font-body-ui text-sm
                         rounded-lg hover:bg-surface-container-low transition-colors"
            >
              重置
            </button>
          )}
          <button
            onClick={handleWrite}
            disabled={
              state.status === "loading" || state.status === "retrying"
            }
            className="px-5 py-2.5 bg-primary-container text-surface-container-low font-body-ui
                       rounded-lg hover:opacity-90 transition-opacity disabled:opacity-40 flex items-center gap-2"
          >
            <span className="material-symbols-outlined text-lg">edit_note</span>
            {state.status === "loading" ? "思考中..." : state.status === "complete" ? "重新写作" : "开始写作"}
          </button>
        </div>
      </div>

      {state.error && (
        <div className="p-4 bg-error-container/20 border border-error rounded-lg text-error font-body-ui text-sm">
          {state.error}
        </div>
      )}

      {/* Chapter Progress */}
      <GlassPanel>
        <ChapterProgress
          chapterNumber={chapterNum}
          onChapterChange={handleChapterChange}
          onAdvance={handleAdvance}
          advancing={advancing}
          progress={progress}
        />
      </GlassPanel>

      {/* Controls bar */}
      <div className="flex items-center gap-4 p-4 bg-surface-container rounded-lg flex-wrap">
        <div className="flex items-center gap-2">
          <span className="font-label-mono text-system-log text-xs">章节</span>
          <input
            type="number"
            min={1}
            value={chapterNum}
            onChange={(e) => handleChapterNumChange(Number(e.target.value))}
            className="w-16 bg-surface-container-low border border-outline-variant rounded px-2 py-1
                       font-body-ui text-primary text-sm focus:outline-none focus:border-primary-container"
          />
        </div>
        <div className="flex items-center gap-2">
          <span className="font-label-mono text-system-log text-xs">场景</span>
          <input
            type="number"
            min={1}
            value={sceneNum}
            onChange={(e) => handleSceneChange(Number(e.target.value))}
            className="w-16 bg-surface-container-low border border-outline-variant rounded px-2 py-1
                       font-body-ui text-primary text-sm focus:outline-none focus:border-primary-container"
          />
        </div>
        {sceneFromProgress && (
          <span
            className={`text-xs px-2 py-0.5 rounded font-label-mono ${
              sceneFromProgress.status === "completed"
                ? "bg-green-500/20 text-green-300"
                : sceneFromProgress.status === "force_passed"
                  ? "bg-amber-500/20 text-amber-300"
                  : "bg-surface-container-low text-system-log"
            }`}
          >
            状态: {sceneFromProgress.status}
          </span>
        )}
        {state.status !== "idle" && (
          <span className="text-xs px-2 py-0.5 bg-primary-container/20 text-primary-container rounded font-label-mono">
            管道: {state.status}
          </span>
        )}
        <div className="flex gap-2 ml-auto">
          <button
            onClick={handleSkip}
            disabled={state.status === "loading"}
            className="px-3 py-1.5 text-sm bg-surface-container-low text-system-log font-body-ui
                       rounded hover:bg-surface-container transition-colors disabled:opacity-40"
          >
            跳过场景
          </button>
          {state.circuitBreakerTriggered && (
            <button
              onClick={() => setShowCircuitBreaker(true)}
              className="px-3 py-1.5 text-sm bg-error-container/30 text-error font-body-ui
                         rounded hover:bg-error-container/50 transition-colors"
            >
              熔断详情
            </button>
          )}
        </div>
      </div>

      {/* Main content: 3-column layout */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* Left: Draft text */}
        <div className="xl:col-span-2 space-y-6">
          {/* Writing Canvas */}
          <GlassPanel>
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-label-mono text-system-log uppercase tracking-wider">
                草稿文本
              </h2>
              {state.coherenceScore > 0 && (
                <div className="flex items-center gap-2">
                  <span className="font-label-mono text-system-log text-xs">连贯性</span>
                  <div className="w-16 h-2 bg-surface-container rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${
                        state.coherenceScore >= 80
                          ? "bg-green-500"
                          : state.coherenceScore >= 60
                            ? "bg-amber-500"
                            : "bg-red-500"
                      }`}
                      style={{ width: `${state.coherenceScore}%` }}
                    />
                  </div>
                  <span className="font-label-mono text-sm text-primary">{state.coherenceScore}%</span>
                </div>
              )}
            </div>

            {state.draftText ? (
              <div className="prose prose-invert prose-sm max-w-none text-sm text-primary leading-relaxed
                              [&_code]:text-xs [&_code]:bg-surface-container [&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded
                              [&_code]:text-system-log [&_code]:font-mono [&_code]:before:content-none [&_code]:after:content-none">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {state.draftText}
                </ReactMarkdown>
              </div>
            ) : (
              <div className="text-center py-12">
                <span className="material-symbols-outlined text-4xl text-system-log/30 mb-3 block">
                  edit_note
                </span>
                <p className="font-body-ui text-system-log text-sm">
                  {state.status === "loading"
                    ? "正在生成..."
                    : '点击「开始写作」生成场景草稿'}
                </p>
              </div>
            )}
          </GlassPanel>

        </div>

        {/* Right: Scene Navigation + SF Log Feed */}
        <div className="space-y-6">
          {/* Scene Navigation — always visible */}
          <GlassPanel>
            <h2 className="font-label-mono text-system-log uppercase tracking-wider mb-4">
              场景导航
            </h2>
            <div className="flex gap-2">
              <button
                onClick={handlePrevScene}
                disabled={sceneNum <= 1}
                className="flex-1 px-4 py-2.5 bg-surface-container text-system-log font-body-ui text-sm
                           rounded-lg hover:bg-surface-container-low transition-colors
                           disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                <span className="material-symbols-outlined text-lg">skip_previous</span>
                上一场景
              </button>
              <button
                onClick={handleNextScene}
                className="flex-1 px-4 py-2.5 bg-surface-container text-system-log font-body-ui text-sm
                           rounded-lg hover:bg-surface-container-low transition-colors flex items-center justify-center gap-2"
              >
                下一场景
                <span className="material-symbols-outlined text-lg">skip_next</span>
              </button>
            </div>
          </GlassPanel>

          <GlassPanel>
            <h2 className="font-label-mono text-system-log uppercase tracking-wider mb-4">
              SF Log 解析
              {state.parsedLogs.length > 0 && (
                <span className="ml-2 text-xs text-system-log/50">
                  ({state.parsedLogs.length})
                </span>
              )}
            </h2>

            {state.parsedLogs.length > 0 ? (
              <div className="space-y-2 max-h-[600px] overflow-y-auto">
                {state.parsedLogs.map((log: ParsedLog, i: number) => (
                  <div
                    key={i}
                    className="p-2 bg-surface-container rounded text-xs"
                  >
                    <div className="flex items-center gap-1.5 mb-1">
                      <span className="material-symbols-outlined text-sm text-system-log">
                        terminal
                      </span>
                      <span className="font-label-mono text-system-log">
                        {LOG_TYPE_LABELS[log.type] || log.type}
                      </span>
                    </div>
                    <div className="space-y-0.5">
                      {Object.entries(log.params).map(([k, v]) => (
                        <div key={k} className="flex items-baseline gap-1.5 pl-5">
                          <code className="text-system-log/70 font-mono">{k}</code>
                          <span className="text-primary text-xs">
                            {typeof v === "object" ? JSON.stringify(v) : String(v)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8">
                <span className="material-symbols-outlined text-3xl text-system-log/20 mb-2 block">
                  receipt_long
                </span>
                <p className="font-body-ui text-system-log/50 text-xs">
                  {state.status === "complete"
                    ? "未发现 SF LOG 标签"
                    : "完成写作后显示解析结果"}
                </p>
              </div>
            )}
          </GlassPanel>

          {/* Fact Guard Results */}
          {state.factGuardChecks.length > 0 && (
            <GlassPanel className="!rounded-none">
              <h2 className="font-label-mono text-system-log uppercase tracking-wider mb-4">
                Fact Guard 检查
              </h2>
              <div className="space-y-2">
                {state.factGuardChecks.map((check: CheckResult) => (
                  <div
                    key={check.check_id}
                    className={`flex items-start gap-3 p-3 rounded-none ${
                      check.passed
                        ? "bg-green-500/10 border border-green-500/30"
                        : "bg-red-500/10 border border-red-500/30"
                    }`}
                  >
                    <span
                      className={`material-symbols-outlined text-lg mt-0.5 ${
                        check.passed ? "text-green-400" : "text-red-400"
                      }`}
                    >
                      {check.passed ? "check_circle" : "cancel"}
                    </span>
                    <div className="flex-1">
                      <div className="flex items-center justify-between">
                        <span className="font-label-mono text-sm text-primary">
                          {checkLabels[check.check_id] || check.name}
                        </span>
                        <span
                          className={`text-xs font-label-mono ${
                            check.passed ? "text-green-400" : "text-red-400"
                          }`}
                        >
                          {check.passed ? "PASS" : "FAIL"}
                        </span>
                      </div>
                      {check.detail && (
                        <p className="font-body-ui text-system-log text-xs mt-1">{check.detail}</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {!state.allPassed && state.retryHints && (
                <div className="mt-4 p-3 bg-amber-500/10 border border-amber-500/30 rounded">
                  <span className="font-label-mono text-amber-300 text-xs">重试提示</span>
                  <p className="font-body-ui text-system-log text-xs mt-1 whitespace-pre-wrap">
                    {state.retryHints}
                  </p>
                </div>
              )}

              {state.circuitBreakerTriggered && state.compatibilityNote && (
                <div className="mt-4 p-3 bg-error/10 border border-error/30 rounded">
                  <span className="font-label-mono text-error text-xs">兼容性说明</span>
                  <p className="font-body-ui text-system-log text-xs mt-1">{state.compatibilityNote}</p>
                </div>
              )}
            </GlassPanel>
          )}

          {/* Force-pass — only when complete and breaker triggered */}
          {state.status === "complete" && state.circuitBreakerTriggered && (
            <GlassPanel>
              <button
                onClick={handleForcePass}
                className="w-full px-4 py-2.5 bg-error/20 text-error font-body-ui text-sm
                           rounded-lg hover:bg-error/30 transition-colors flex items-center justify-center gap-2"
              >
                <span className="material-symbols-outlined text-lg">flash_on</span>
                强制通过（熔断）
              </button>
            </GlassPanel>
          )}

          {/* Retry info */}
          {state.retryCount > 0 && (
            <GlassPanel>
              <h2 className="font-label-mono text-system-log uppercase tracking-wider mb-2">
                重试统计
              </h2>
              <div className="flex items-center gap-4">
                <div>
                  <span className="font-label-mono text-system-log text-xs">重试次数</span>
                  <p className="font-display-md text-primary">{state.retryCount}</p>
                </div>
                <div>
                  <span className="font-label-mono text-system-log text-xs">最终分数</span>
                  <p className="font-display-md text-primary">{state.coherenceScore}</p>
                </div>
              </div>
            </GlassPanel>
          )}
        </div>
      </div>

      {/* Circuit Breaker Modal */}
      {showCircuitBreaker && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
          <div className="bg-surface-container-low border-2 border-error rounded-lg max-w-lg w-full mx-4 overflow-hidden">
            {/* Terminal-style header */}
            <div className="bg-error/20 px-4 py-3 flex items-center justify-between border-b border-error/30">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-error">dangerous</span>
                <span className="font-label-mono text-error">CIRCUIT BREAKER TRIGGERED</span>
              </div>
              <button
                onClick={() => setShowCircuitBreaker(false)}
                className="text-system-log hover:text-primary"
              >
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            <div className="p-4 space-y-4">
              <div className="p-3 bg-error/10 border border-error/20 rounded">
                <p className="font-body-narrative text-primary text-sm">
                  场景写作在第 {state.retryCount} 次重试后仍未通过 Fact Guard 检查。
                  系统已触发熔断机制并以兼容性说明强制通过。
                </p>
              </div>

              {state.compatibilityNote && (
                <div>
                  <span className="font-label-mono text-system-log text-xs">兼容性说明</span>
                  <p className="font-body-ui text-system-log text-sm mt-1 bg-surface-container p-3 rounded font-mono">
                    {state.compatibilityNote}
                  </p>
                </div>
              )}

              <div className="flex justify-end gap-3">
                <button
                  onClick={() => setShowCircuitBreaker(false)}
                  className="px-4 py-2 bg-surface-container text-system-log font-body-ui text-sm rounded-lg"
                >
                  关闭
                </button>
                <button
                  onClick={handleForcePass}
                  className="px-4 py-2 bg-error text-surface-container-low font-body-ui text-sm rounded-lg"
                >
                  确认强制通过
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
