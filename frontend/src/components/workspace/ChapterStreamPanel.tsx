import { useEffect, useRef, useState } from "react";
import { useChapterStream } from "../../hooks/useChapterStream";

interface Props {
  projectId: string;
}

export default function ChapterStreamPanel({ projectId }: Props) {
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

  // Hide entirely until a scene has produced at least one chunk or scene_start.
  if (!stream.current && !stream.text) {
    return null;
  }

  const statusLabel = stream.failed
    ? `✗ 写入失败 · 已保留 ${stream.charCount} 字`
    : stream.active
      ? `● 正在写入 · ${stream.charCount} 字`
      : `○ 空闲 · 最近 ${stream.charCount} 字`;

  const statusClass = stream.failed
    ? "text-error"
    : stream.active
      ? "text-tertiary-container"
      : "text-system-log/60";

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
          <span className="text-system-log/60 italic">— 等待 AI 输出第一个字 —</span>
        )}
        {stream.active && (
          <span className="animate-pulse text-primary-container">▌</span>
        )}
      </div>
    </div>
  );
}