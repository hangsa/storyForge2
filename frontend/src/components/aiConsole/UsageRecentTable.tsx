import type { UsageRecord } from '../../api/client';

export type { UsageRecord };

interface Props {
  records: UsageRecord[];
}

export default function UsageRecentTable({ records }: Props) {
  if (records.length === 0) {
    return (
      <div
        data-testid="usage-empty"
        className="rounded-lg border border-dashed border-canvas-text-muted/30 px-4 py-6 text-center text-sm text-canvas-text-muted"
      >
        暂无最近的 LLM 调用记录。
      </div>
    );
  }
  return (
    <div className="overflow-x-auto rounded-lg border border-canvas-text-muted/20">
      <table className="min-w-full divide-y divide-canvas-text-muted/20 text-sm">
        <thead className="bg-canvas-surface">
          <tr>
            <th className="px-3 py-2 text-left font-medium">时间</th>
            <th className="px-3 py-2 text-left font-medium">Agent / 任务</th>
            <th className="px-3 py-2 text-left font-medium">Tier / 模型</th>
            <th className="px-3 py-2 text-right font-medium">Tokens in / out</th>
            <th className="px-3 py-2 text-right font-medium">成本</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-canvas-text-muted/10 bg-canvas-bg">
          {records.map((r, idx) => (
            <tr key={`${r.timestamp}-${idx}`} data-testid="usage-row">
              <td className="px-3 py-2 text-canvas-text-muted">{r.timestamp}</td>
              <td className="px-3 py-2 font-mono text-xs">{r.agent} · {r.task}</td>
              <td className="px-3 py-2 font-mono text-xs">{r.tier} / {r.model}</td>
              <td className="px-3 py-2 text-right tabular-nums">{r.tokens_in} / {r.tokens_out}</td>
              <td className="px-3 py-2 text-right tabular-nums">${r.cost.toFixed(4)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}