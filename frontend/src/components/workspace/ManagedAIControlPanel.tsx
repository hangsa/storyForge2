import { useState } from "react";
import { useAutopilotSession } from "../../hooks/useAutopilotSession";
import { useToast } from "../../hooks/useToast";

type Tab = "decisions" | "queue" | "checks" | "intervene";
const TABS: { id: Tab; label: string }[] = [
  { id: "decisions", label: "决策流" },
  { id: "queue", label: "队列" },
  { id: "checks", label: "检查" },
  { id: "intervene", label: "干预" },
];

const DECISION_EVENTS = new Set(["decision", "task_complete", "circuit_open", "circuit_close"]);
const CHECK_EVENTS = new Set(["task_fail"]);

export default function ManagedAIControlPanel({ projectId }: { projectId: string }) {
  const [tab, setTab] = useState<Tab>("decisions");
  const { session, events, pause, stop } = useAutopilotSession(projectId);
  const { show } = useToast();

  const runAction = async (label: string, fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      show(`${label}失败：${detail}`);
    }
  };

  return (
    <div data-testid="ai-control-panel" className="h-full flex flex-col">
      <div className="flex border-b border-outline-variant">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            data-testid={`ai-tab-${t.id}`}
            onClick={() => setTab(t.id)}
            className={`flex-1 py-2 text-sm font-body-ui border-b-2 transition-colors ${
              tab === t.id
                ? "border-primary-container text-primary-container"
                : "border-transparent text-system-log hover:text-primary"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="flex-1 p-4 overflow-y-auto text-sm font-body-ui text-system-log space-y-2">
        {tab === "decisions" && (
          <ul data-testid="ai-decisions-list" className="space-y-2">
            {events
              .filter((e) => DECISION_EVENTS.has(e.event))
              .reverse()
              .map((e) => (
                <li
                  key={e.id ?? `${e.event}-${Math.random()}`}
                  data-testid={`event-card-${e.event}`}
                  className="p-2 rounded bg-surface-container-low"
                >
                  {e.event}
                  {e.data && typeof e.data === "object"
                    ? " · " + JSON.stringify(e.data)
                    : ""}
                </li>
              ))}
          </ul>
        )}
        {tab === "queue" && (
          <ul data-testid="ai-queue-list" className="space-y-2">
            {(session?.queue ?? []).map((q) => (
              <li
                key={q.id}
                data-testid={`queue-item-${q.id}`}
                className="p-2 rounded bg-surface-container-low"
              >
                {q.description}
              </li>
            ))}
            {(session?.queue ?? []).length === 0 && (
              <li className="p-2 rounded bg-surface-container-low/40 italic">
                — 队列为空 —
              </li>
            )}
          </ul>
        )}
        {tab === "checks" && (
          <ul data-testid="ai-checks-list" className="space-y-2">
            {events
              .filter((e) => CHECK_EVENTS.has(e.event))
              .map((e) => (
                <li
                  key={e.id ?? `${e.event}-${Math.random()}`}
                  data-testid={`event-card-${e.event}`}
                  className="p-2 rounded bg-surface-container-low text-amber-700"
                >
                  {e.event}
                  {e.data && typeof e.data === "object"
                    ? " · " + JSON.stringify(e.data)
                    : ""}
                </li>
              ))}
          </ul>
        )}
        {tab === "intervene" && (
          <div data-testid="ai-intervene-actions" className="space-y-2">
            <button
              type="button"
              data-testid="action-pause"
              onClick={() => runAction("暂停托管", pause)}
              className="w-full px-3 py-2 rounded-lg bg-surface-container text-system-log hover:bg-surface-container-high text-sm"
            >
              暂停托管
            </button>
            <button
              type="button"
              data-testid="action-rollback"
              disabled
              title="v1.9.1 接入 checkpoint rollback"
              className="w-full px-3 py-2 rounded-lg bg-surface-container text-system-log/50 cursor-not-allowed text-sm"
            >
              回滚到上一节点
            </button>
            <button
              type="button"
              data-testid="action-stop"
              onClick={() => runAction("停止托管", stop)}
              className="w-full px-3 py-2 rounded-lg bg-error/90 text-surface-container-low hover:opacity-90 text-sm"
            >
              停止当前任务
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
