import type { ParsedLog } from "@/api/client";

interface SFLogFeedProps {
  logs: ParsedLog[];
}

const LOG_TYPE_LABELS: Record<string, string> = {
  character_emotion: "情绪",
  character_relation_change: "关系",
  character_location_change: "位置",
  knowledge_gain: "知识",
  conflict_escalate: "冲突升级",
  mystery_clue: "线索",
  registry_create: "资产创建",
};

export default function SFLogFeed({ logs }: SFLogFeedProps) {
  return (
    <div className="font-code-sm text-system-log">
      <div className="font-label-mono text-system-log uppercase tracking-wider mb-2 px-2">
        SF_LOG Feed
      </div>
      <div className="space-y-1 max-h-[300px] overflow-y-auto">
        {logs.length === 0 && (
          <div className="px-2 py-4 text-center text-system-log/50">
            等待解析...
          </div>
        )}
        {logs.map((log, i) => (
          <div
            key={i}
            className="bg-surface-container-low rounded px-2 py-1 border-l-2 border-primary-container/30"
          >
            <span className="text-primary-container/70">
              {LOG_TYPE_LABELS[log.type] || log.type}
            </span>
            {Object.entries(log.params).slice(0, 3).map(([k, v]) => (
              <span key={k} className="ml-2 text-system-log/70">
                {k}={v}
              </span>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
