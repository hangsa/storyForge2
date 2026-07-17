import { useEffect, useRef, useState } from "react";
import { useChapterStream } from "../../hooks/useChapterStream";

type SessionState = "stopped" | "running" | "paused";

interface Props {
  projectId: string;
  /**
   * Outer autopilot session state. When the session is `stopped`, we
   * surface the persisted `stopReason` instead of an indefinite "waiting
   * for the next scene" hint — the runner is no longer producing events.
   */
  sessionState?: SessionState;
  /** Short tag like "outline_exhausted" / "user_requested" (only meaningful when sessionState === "stopped"). */
  stopReason?: string | null;
}

const STOP_REASON_LABEL: Record<string, string> = {
  outline_exhausted: "大纲已用完",
  user_requested: "用户手动停止",
};

export default function ChapterStreamPanel({
  projectId,
  sessionState,
  stopReason,
}: Props) {
  const stream = useChapterStream(projectId);
  const containerRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);

  // Default: stick to bottom as text grows, unless user scrolls up.
  useEffect(() => {
    if (!autoScroll) return;
    const el = containerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight - el.clientHeight;
  }, [stream.text, autoScroll]);

  const onScroll = () => {
    const el = containerRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 20;
    setAutoScroll(atBottom);
  };

  // Priority: streaming > failed > stopped (with reason) > idle text > waiting.
  // When the outer session is stopped, never show the "waiting" placeholder
  // — the runner is gone, so no chunks will arrive until the user restarts.
  const isStopped = sessionState === "stopped";
  const statusLabel = stream.active
    ? `● 正在写入 · ${stream.charCount} 字`
    : stream.failed
      ? `✗ 写入失败 · 已保留 ${stream.charCount} 字`
      : isStopped
        ? stream.text
          ? `⏹ 已停止 · 最近 ${stream.charCount} 字`
          : `⏹ 已停止 · ${STOP_REASON_LABEL[stopReason ?? ""] ?? (stopReason || "未启动托管")}`
        : stream.text
          ? `○ 空闲 · 最近 ${stream.charCount} 字`
          : `○ 等待 AI 开始下一场景`;

  const statusClass = stream.active
    ? "text-tertiary-container"
    : stream.failed
      ? "text-error"
      : isStopped
        ? "text-system-log/80"
        : "text-system-log/60";

  const emptyHint = stream.failed
    ? "— 等待重试或新场景 —"
    : isStopped && !stream.text
      ? `— 托管已停止（${STOP_REASON_LABEL[stopReason ?? ""] ?? stopReason ?? "未启动托管"}），启动后继续 —`
      : isStopped
        ? "— 托管已停止 —"
        : "— 等待 AI 输出第一个字 —";

  return (
    <div
      data-testid="chapter-stream-panel"
      className="rounded-xl border border-primary-container/40 bg-surface-container-low"
    >
      <div className="flex items-center justify-between px-4 py-2 border-b border-outline-variant bg-primary-container/5">
        <span className="font-label-mono text-[11px] text-primary-container uppercase tracking-wider">
          📝 实时写作流
          {stream.current && ` · 第 ${stream.current.chapter} 章 第 ${stream.current.scene} 场景`}
        </span>
        <span className={`text-[11px] font-label-mono ${statusClass}`}>
          {statusLabel}
        </span>
      </div>
      <div
        ref={containerRef}
        onScroll={onScroll}
        data-testid="chapter-stream-text"
        className="px-5 py-4 text-sm font-body-ui leading-7 max-h-[340px] overflow-y-auto whitespace-pre-wrap"
      >
        {stream.text || (
          <span className="text-system-log/60 italic">{emptyHint}</span>
        )}
        {stream.active && (
          <span className="animate-pulse text-primary-container">▌</span>
        )}
      </div>
    </div>
  );
}