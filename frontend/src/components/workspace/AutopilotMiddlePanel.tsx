import { useMemo, useState } from "react";
import { useAutopilotSession } from "../../hooks/useAutopilotSession";
import { MANAGED_START_DEFAULTS } from "../../hooks/useAutopilotConfig";
import type { ManagedStartConfig } from "./ManagedStartModal";
import { useToast } from "../../hooks/useToast";

type Tab = "cockpit" | "dashboard" | "log";

const TABS: { id: Tab; label: string }[] = [
  { id: "cockpit", label: "驾驶舱" },
  { id: "dashboard", label: "仪表盘" },
  { id: "log", label: "监控日志" },
];

const STATE_BADGE: Record<"stopped" | "running" | "paused", { label: string; cls: string }> = {
  stopped: { label: "已停止", cls: "bg-surface-container text-system-log" },
  running: { label: "运行中", cls: "bg-tertiary-container text-surface-container-low" },
  paused: { label: "已暂停", cls: "bg-secondary-container text-surface-container-low" },
};

const SCOPE_LABEL: Record<ManagedStartConfig["scope"], string> = {
  all_planned: "所有已规划章节",
  next_chapter: "仅下一章",
};
const CADENCE_LABEL: Record<ManagedStartConfig["cadence"], string> = {
  fast: "快",
  balanced: "均衡",
  careful: "稳",
};
const POLICY_LABEL: Record<ManagedStartConfig["policy"], string> = {
  auto: "自动决策",
  ask: "关键决策前询问",
};
const NOTIFY_LABEL: Record<ManagedStartConfig["notify"], string> = {
  all: "每次事件",
  milestones: "仅里程碑",
};

const LOG_EVENT_LABELS: Record<string, string> = {
  snapshot: "快照",
  session_start: "会话开始",
  session_stop: "会话停止",
  task_start: "任务开始",
  task_complete: "任务完成",
  task_fail: "任务失败",
  decision: "AI 决策",
  circuit_open: "熔断开启",
  circuit_close: "熔断关闭",
  queue_add: "入队",
  queue_remove: "出队",
};

interface Props {
  projectId: string;
}

export default function AutopilotMiddlePanel({ projectId }: Props) {
  const [tab, setTab] = useState<Tab>("cockpit");
  const { session, events, start, stop, pause, resume, status: sseStatus } =
    useAutopilotSession(projectId);
  const { show } = useToast();

  const state = session?.state ?? "stopped";
  const active = state === "running";
  const config = session?.config ?? MANAGED_START_DEFAULTS;
  const currentTask = session?.current_task ?? null;
  const queue = session?.queue ?? [];

  const onAction = async (label: string, fn: () => Promise<unknown>) => {
    try {
      await fn();
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      show(`${label}失败：${detail}`);
    }
  };

  const eventStats = useMemo(() => {
    const stats = { complete: 0, fail: 0, decision: 0, circuit: 0 };
    for (const e of events) {
      if (e.event === "task_complete") stats.complete += 1;
      else if (e.event === "task_fail") stats.fail += 1;
      else if (e.event === "decision") stats.decision += 1;
      else if (e.event === "circuit_open" || e.event === "circuit_close") stats.circuit += 1;
    }
    return stats;
  }, [events]);

  return (
    <div
      data-testid="autopilot-middle-panel"
      className="h-full flex flex-col bg-surface-container-lowest"
    >
      <div className="flex border-b border-outline-variant">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            data-testid={`autopilot-tab-${t.id}`}
            onClick={() => setTab(t.id)}
            className={`px-5 py-2.5 text-sm font-body-ui border-b-2 transition-colors ${
              tab === t.id
                ? "border-primary-container text-primary-container"
                : "border-transparent text-system-log hover:text-primary"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto">
        {tab === "cockpit" && (
          <CockpitView
            state={state}
            currentTask={currentTask}
            queue={queue}
            events={events}
            sseStatus={sseStatus}
            onStart={() => onAction("启动托管", () => start(config))}
            onPause={() => onAction("暂停托管", () => pause())}
            onResume={() => onAction("继续托管", () => resume())}
            onStop={() => onAction("停止托管", () => stop())}
          />
        )}
        {tab === "dashboard" && (
          <DashboardView
            state={state}
            config={config}
            queue={queue}
            eventStats={eventStats}
            totalEvents={events.length}
          />
        )}
        {tab === "log" && <LogView events={events} />}
      </div>
    </div>
  );
}

interface CockpitViewProps {
  state: "stopped" | "running" | "paused";
  currentTask: { description: string; chapter?: number } | null;
  queue: Array<{ id: string; description: string }>;
  events: Array<{ event: string; data: unknown; id?: number }>;
  sseStatus: "connecting" | "connected" | "reconnecting" | "error";
  onStart: () => void;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
}

function CockpitView({
  state, currentTask, queue, events, sseStatus,
  onStart, onPause, onResume, onStop,
}: CockpitViewProps) {
  const recentEvents = events.slice(-12).reverse();
  const badge = STATE_BADGE[state];
  const chapter = currentTask?.chapter;

  return (
    <div className="p-6 space-y-6">
      {/* State card */}
      <div
        data-testid="autopilot-cockpit-state"
        className="rounded-xl border border-outline-variant bg-surface-container-low p-5"
      >
        <div className="flex items-center justify-between gap-4">
          <div className="space-y-2 min-w-0">
            <div className="flex items-center gap-3">
              <span
                data-testid="autopilot-state-badge"
                className={`px-3 py-1 rounded-full text-xs font-label-mono ${badge.cls}`}
              >
                {badge.label}
              </span>
              <span
                data-testid="autopilot-sse-status"
                className="text-[11px] font-label-mono text-system-log"
              >
                SSE · {sseStatus}
              </span>
            </div>
            <div
              data-testid="autopilot-cockpit-current-task"
              className="text-base font-display text-primary"
            >
              {currentTask?.description
                ? `AI 正在 ${currentTask.description}${chapter ? ` · 第 ${chapter} 章` : ""}`
                : state === "running"
                  ? "AI 正在准备下一任务…"
                  : "AI 尚未启动"}
            </div>
            {queue.length > 0 && (
              <div className="text-xs font-body-ui text-system-log truncate">
                队列预览：{queue.slice(0, 3).map((q) => q.description).join(" → ")}
              </div>
            )}
          </div>
          <div className="flex flex-col gap-2 shrink-0">
            {state === "stopped" && (
              <button
                type="button"
                data-testid="autopilot-cockpit-start"
                onClick={onStart}
                className="px-4 py-2 text-sm rounded-lg bg-primary-container text-surface-container-low hover:opacity-90"
              >
                ▶ 启动托管
              </button>
            )}
            {state === "running" && (
              <button
                type="button"
                data-testid="autopilot-cockpit-pause"
                onClick={onPause}
                className="px-4 py-2 text-sm rounded-lg bg-secondary-container text-surface-container-low hover:opacity-90"
              >
                ⏸ 暂停
              </button>
            )}
            {state === "paused" && (
              <button
                type="button"
                data-testid="autopilot-cockpit-resume"
                onClick={onResume}
                className="px-4 py-2 text-sm rounded-lg bg-tertiary-container text-surface-container-low hover:opacity-90"
              >
                ▶ 继续
              </button>
            )}
            {state !== "stopped" && (
              <button
                type="button"
                data-testid="autopilot-cockpit-stop"
                onClick={onStop}
                className="px-4 py-2 text-sm rounded-lg bg-error/90 text-surface-container-low hover:opacity-90"
              >
                ⏹ 停止
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Live event feed */}
      <section>
        <h3 className="font-label-mono text-system-log text-[11px] uppercase tracking-wider mb-2">
          实时事件流
        </h3>
        <ul
          data-testid="autopilot-cockpit-events"
          className="space-y-1.5 text-xs font-body-ui"
        >
          {recentEvents.length === 0 && (
            <li className="text-system-log/60 italic">— 暂无事件 —</li>
          )}
          {recentEvents.map((e, idx) => (
            <li
              key={e.id ?? `${e.event}-${idx}`}
              data-testid={`autopilot-cockpit-event-${idx}`}
              className="flex items-baseline gap-2 px-3 py-1.5 rounded bg-surface-container"
            >
              <span className="font-label-mono text-[10px] text-system-log shrink-0">
                {LOG_EVENT_LABELS[e.event] ?? e.event}
              </span>
              <span className="text-system-log truncate">
                {e.data && typeof e.data === "object"
                  ? JSON.stringify(e.data).slice(0, 120)
                  : ""}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

interface DashboardViewProps {
  state: "stopped" | "running" | "paused";
  config: ManagedStartConfig;
  queue: Array<{ id: string; description: string }>;
  eventStats: { complete: number; fail: number; decision: number; circuit: number };
  totalEvents: number;
}

function DashboardView({ state, config, queue, eventStats, totalEvents }: DashboardViewProps) {
  return (
    <div className="p-6 space-y-6">
      {/* Config summary */}
      <section data-testid="autopilot-dashboard-config">
        <h3 className="font-label-mono text-system-log text-[11px] uppercase tracking-wider mb-3">
          当前配置
        </h3>
        <dl className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <ConfigCell label="推进范围" value={SCOPE_LABEL[config.scope]} />
          <ConfigCell label="推进节奏" value={CADENCE_LABEL[config.cadence]} />
          <ConfigCell label="AI 决策策略" value={POLICY_LABEL[config.policy]} />
          <ConfigCell label="通知规则" value={NOTIFY_LABEL[config.notify]} />
        </dl>
      </section>

      {/* Event stats */}
      <section data-testid="autopilot-dashboard-stats">
        <h3 className="font-label-mono text-system-log text-[11px] uppercase tracking-wider mb-3">
          运行指标
        </h3>
        <dl className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <ConfigCell label="会话状态" value={STATE_BADGE[state].label} />
          <ConfigCell label="事件总数" value={String(totalEvents)} />
          <ConfigCell label="任务完成" value={String(eventStats.complete)} />
          <ConfigCell
            label="任务失败 / 熔断"
            value={`${eventStats.fail} / ${eventStats.circuit}`}
            warn={eventStats.fail > 0 || eventStats.circuit > 0}
          />
        </dl>
      </section>

      {/* Queue preview */}
      <section data-testid="autopilot-dashboard-queue">
        <h3 className="font-label-mono text-system-log text-[11px] uppercase tracking-wider mb-3">
          任务队列（{queue.length}）
        </h3>
        {queue.length === 0 ? (
          <p className="text-sm font-body-ui text-system-log/60 italic">
            — 队列为空 —
          </p>
        ) : (
          <ul className="space-y-1.5 text-sm font-body-ui">
            {queue.map((q) => (
              <li
                key={q.id}
                data-testid={`autopilot-queue-row-${q.id}`}
                className="px-3 py-2 rounded-lg bg-surface-container flex items-center gap-2"
              >
                <span className="font-label-mono text-[10px] text-system-log/70">
                  {q.id}
                </span>
                <span className="text-primary">{q.description}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function ConfigCell({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="rounded-lg bg-surface-container-low border border-outline-variant px-4 py-3">
      <dt className="font-label-mono text-[10px] text-system-log uppercase tracking-wider">
        {label}
      </dt>
      <dd
        className={`mt-1 text-sm font-body-ui ${
          warn ? "text-error" : "text-primary"
        }`}
      >
        {value}
      </dd>
    </div>
  );
}

function LogView({ events }: { events: Array<{ event: string; data: unknown; id?: number }> }) {
  const [filter, setFilter] = useState<string>("all");

  const filtered = filter === "all"
    ? events.slice().reverse()
    : events.filter((e) => e.event === filter).slice().reverse();

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="font-label-mono text-system-log text-[11px] uppercase tracking-wider">
          过滤：
        </span>
        {["all", "task_complete", "task_fail", "decision", "circuit_open", "circuit_close"].map((f) => (
          <button
            key={f}
            type="button"
            data-testid={`autopilot-log-filter-${f}`}
            onClick={() => setFilter(f)}
            className={`px-3 py-1 text-xs font-body-ui rounded-full border ${
              filter === f
                ? "border-primary-container bg-primary-container/10 text-primary-container"
                : "border-outline-variant text-system-log hover:border-primary-container"
            }`}
          >
            {f === "all" ? "全部" : (LOG_EVENT_LABELS[f] ?? f)}
          </button>
        ))}
      </div>
      <ul
        data-testid="autopilot-log-list"
        className="space-y-1.5 font-body-ui text-xs"
      >
        {filtered.length === 0 && (
          <li className="text-system-log/60 italic px-3 py-2">— 暂无事件 —</li>
        )}
        {filtered.map((e, idx) => (
          <li
            key={e.id ?? `${e.event}-${idx}`}
            data-testid={`autopilot-log-row-${idx}`}
            className="px-3 py-2 rounded bg-surface-container flex items-baseline gap-3"
          >
            <span className="font-label-mono text-[10px] text-primary-container shrink-0 w-24">
              {LOG_EVENT_LABELS[e.event] ?? e.event}
            </span>
            <span className="text-system-log break-all">
              {e.data && typeof e.data === "object"
                ? JSON.stringify(e.data)
                : String(e.data ?? "")}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}