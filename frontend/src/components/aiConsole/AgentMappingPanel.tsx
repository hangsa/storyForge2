import { useState } from 'react';
import type { AgentTaskMapping, ModelEntry, ModelTiersConfig } from '../../api/client';

interface Props {
  value: ModelTiersConfig['agent_mapping'];
  onChange: (next: ModelTiersConfig['agent_mapping']) => void;
  tiers: ModelTiersConfig['tiers'];
  catalog: ModelEntry[];
}

export default function AgentMappingPanel({ value, onChange, tiers, catalog }: Props) {
  const tierNames = Object.keys(tiers);
  const [newAgent, setNewAgent] = useState('');
  const [pendingTaskByAgent, setPendingTaskByAgent] = useState<Record<string, string>>({});

  const updateAgent = (agent: string, task: string, next: AgentTaskMapping) => {
    const agentTasks = { ...(value[agent] ?? {}) };
    agentTasks[task] = next;
    onChange({ ...value, [agent]: agentTasks });
  };

  const removeTask = (agent: string, task: string) => {
    const agentTasks = { ...(value[agent] ?? {}) };
    delete agentTasks[task];
    onChange({ ...value, [agent]: agentTasks });
  };

  const addAgent = () => {
    const name = newAgent.trim();
    if (!name || name in value) {
      setNewAgent('');
      return;
    }
    onChange({ ...value, [name]: {} });
    setNewAgent('');
  };

  const addTask = (agent: string) => {
    const raw = (pendingTaskByAgent[agent] ?? '').trim();
    const tasks = value[agent] ?? {};
    if (!raw || raw in tasks) {
      setPendingTaskByAgent((prev) => ({ ...prev, [agent]: '' }));
      return;
    }
    onChange({
      ...value,
      [agent]: { ...tasks, [raw]: { tier: tierNames[0] ?? 'tier_1' } },
    });
    setPendingTaskByAgent((prev) => ({ ...prev, [agent]: '' }));
  };

  const removeAgent = (agent: string) => {
    const next = { ...value };
    delete next[agent];
    onChange(next);
  };

  const modelOptionsForTier = (tierName: string): { id: string; label: string }[] => {
    const tier = tiers[tierName];
    if (!tier) return [{ id: 'default', label: '默认' }];
    return [
      { id: 'default', label: `默认（${tier.default}）` },
      ...catalog.map((m) => ({ id: m.id, label: m.id })),
    ];
  };

  return (
    <div className="space-y-3">
      {Object.entries(value).map(([agent, tasks]) => (
        <div
          key={agent}
          data-testid={`agent-${agent}`}
          className="rounded-lg border border-canvas-text-muted/20"
        >
          <div className="flex items-center justify-between bg-canvas-surface px-4 py-2">
            <span className="font-mono text-sm font-semibold">{agent}</span>
            <button
              type="button"
              data-testid={`agent-${agent}-remove`}
              onClick={() => removeAgent(agent)}
              className="text-xs text-rose-600"
            >
              删除 agent
            </button>
          </div>
          <div className="space-y-2 px-4 py-3">
            {Object.entries(tasks ?? {}).map(([task, mapping]) => {
              const m = mapping as AgentTaskMapping;
              const opts = modelOptionsForTier(m.tier ?? '');
              return (
                <div
                  key={task}
                  data-testid={`agent-${agent}-task-${task}`}
                  className="grid grid-cols-12 items-center gap-2 text-sm"
                >
                  <span className="col-span-3 truncate font-mono text-xs">{task}</span>
                  <select
                    data-testid={`agent-${agent}-task-${task}-tier`}
                    className="col-span-3 rounded border border-canvas-text-muted/30 bg-canvas-bg px-2 py-1 text-xs"
                    value={m.tier ?? tierNames[0]}
                    onChange={(e) => {
                      const next = { tier: e.target.value };
                      onChange({ ...value, [agent]: { ...tasks, [task]: next } });
                    }}
                  >
                    {tierNames.map((tn) => (
                      <option key={tn} value={tn}>{tn}</option>
                    ))}
                  </select>
                  <select
                    data-testid={`agent-${agent}-task-${task}-model`}
                    className="col-span-2 rounded border border-canvas-text-muted/30 bg-canvas-bg px-2 py-1 text-xs"
                    value={m.model ?? 'default'}
                    onChange={(e) => updateAgent(agent, task, { ...m, model: e.target.value })}
                  >
                    {opts.map((o) => (
                      <option key={o.id} value={o.id}>{o.label}</option>
                    ))}
                  </select>
                  <select
                    data-testid={`agent-${agent}-task-${task}-fallback`}
                    className="col-span-2 rounded border border-canvas-text-muted/30 bg-canvas-bg px-2 py-1 text-xs"
                    value={m.fallback ?? ''}
                    onChange={(e) =>
                      updateAgent(agent, task, { ...m, fallback: e.target.value || null })
                    }
                  >
                    <option value="">（无）</option>
                    {opts.filter((o) => o.id !== 'default').map((o) => (
                      <option key={o.id} value={o.id}>{o.label}</option>
                    ))}
                  </select>
                  <button
                    type="button"
                    data-testid={`agent-${agent}-task-${task}-remove`}
                    onClick={() => removeTask(agent, task)}
                    className="col-span-2 rounded border border-rose-500/40 px-2 py-1 text-xs text-rose-600"
                  >
                    删除任务
                  </button>
                </div>
              );
            })}

            <div className="mt-2 flex items-center gap-2">
              <input
                data-testid={`agent-${agent}-new-task-name`}
                className="flex-1 rounded border border-canvas-text-muted/30 bg-canvas-bg px-2 py-1 text-xs"
                placeholder="新任务名"
                value={pendingTaskByAgent[agent] ?? ''}
                onChange={(e) =>
                  setPendingTaskByAgent((prev) => ({ ...prev, [agent]: e.target.value }))
                }
              />
              <button
                type="button"
                data-testid={`agent-${agent}-add-task`}
                onClick={() => addTask(agent)}
                className="rounded border border-canvas-accent/40 px-2 py-1 text-xs text-canvas-accent"
              >
                + 任务
              </button>
              <button
                type="button"
                data-testid={`agent-${agent}-new-task-add-button`}
                onClick={() => addTask(agent)}
                className="rounded border border-canvas-accent/40 px-2 py-1 text-xs text-canvas-accent"
              >
                确认输入
              </button>
            </div>
          </div>
        </div>
      ))}

      <div className="flex items-center gap-2 rounded-lg border border-dashed border-canvas-text-muted/30 px-4 py-3">
        <input
          data-testid="new-agent-name"
          className="flex-1 rounded border border-canvas-text-muted/30 bg-canvas-bg px-2 py-1 text-sm"
          placeholder="新 agent 名"
          value={newAgent}
          onChange={(e) => setNewAgent(e.target.value)}
        />
        <button
          type="button"
          data-testid="new-agent-add"
          onClick={addAgent}
          className="rounded border border-canvas-accent/40 px-2 py-1 text-sm text-canvas-accent"
        >
          + 新增 agent
        </button>
      </div>
    </div>
  );
}