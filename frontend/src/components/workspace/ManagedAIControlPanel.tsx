import { useState } from "react";

type Tab = "decisions" | "queue" | "checks" | "intervene";
const TABS: { id: Tab; label: string }[] = [
  { id: "decisions", label: "决策流" },
  { id: "queue", label: "队列" },
  { id: "checks", label: "检查" },
  { id: "intervene", label: "干预" },
];

export default function ManagedAIControlPanel() {
  const [tab, setTab] = useState<Tab>("decisions");
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
        {tab === "decisions" && <MockDecisions />}
        {tab === "queue" && <MockQueue />}
        {tab === "checks" && <MockChecks />}
        {tab === "intervene" && <MockIntervene />}
      </div>
    </div>
  );
}

function MockDecisions() {
  return (
    <ul data-testid="ai-decisions-list" className="space-y-2">
      <li className="p-2 rounded bg-surface-container-low">12:04 · 完成第 6 章生成</li>
      <li className="p-2 rounded bg-surface-container-low">12:01 · 决策：续写第 7 章冲突升级</li>
      <li className="p-2 rounded bg-surface-container-low">11:58 · 重试 Fact Guard（剩余 1 次）</li>
      <li className="p-2 rounded bg-surface-container-low/40 italic">— 暂无更多事件 —</li>
    </ul>
  );
}

function MockQueue() {
  return (
    <ul data-testid="ai-queue-list" className="space-y-2">
      <li className="p-2 rounded bg-surface-container-low">计划任务 1 · 配角黎清情感线推进</li>
      <li className="p-2 rounded bg-surface-container-low">计划任务 2 · 检查反派动机一致性</li>
    </ul>
  );
}

function MockChecks() {
  return (
    <ul data-testid="ai-checks-list" className="space-y-2">
      <li className="p-2 rounded bg-surface-container-low text-amber-700">第 6 章 · 时间线异常 1 处</li>
      <li className="p-2 rounded bg-surface-container-low">第 5 章 · 无问题</li>
    </ul>
  );
}

function MockIntervene() {
  return (
    <div data-testid="ai-intervene-actions" className="space-y-2">
      <ActionButton testid="action-pause" label="暂停托管" />
      <ActionButton testid="action-rollback" label="回滚到上一节点" />
      <ActionButton testid="action-stop" label="停止当前任务" />
      <p className="text-xs text-system-log/60 italic mt-3">v1.8 占位 · 真实调度在 v1.9+ 接入</p>
    </div>
  );
}

function ActionButton({ testid, label }: { testid: string; label: string }) {
  return (
    <button
      type="button"
      data-testid={testid}
      disabled
      className="w-full px-3 py-2 rounded-lg bg-surface-container text-system-log/50 cursor-not-allowed text-sm"
    >
      {label}
    </button>
  );
}
