import { useEffect, useState } from 'react';
import { llmConsole, type LLMUsageEntry } from '../../api/llmConsole';

interface Props {
  refreshSignal: number;
}

function fmtTimestamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function fmtCost(n: number): string {
  if (n >= 1) return `¥${n.toFixed(2)}`;
  if (n >= 0.01) return `¥${n.toFixed(3)}`;
  return `¥${n.toFixed(4)}`;
}

export default function UsagePanel({ refreshSignal }: Props) {
  const [entries, setEntries] = useState<LLMUsageEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await llmConsole.getLLMUsage(100);
      setEntries(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshSignal]);

  const totalCalls = entries.length;
  const totalTokens = entries.reduce(
    (sum, e) => sum + (e.tokens_in || 0) + (e.tokens_out || 0),
    0,
  );
  const totalCost = entries.reduce((sum, e) => sum + (e.cost || 0), 0);

  return (
    <section data-testid="tab-panel-usage" className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">最近调用统计（最近 {totalCalls} 条）</h3>
        <button
          type="button"
          data-testid="usage-refresh"
          disabled={loading}
          onClick={load}
          className="rounded border border-canvas-text-muted/40 px-3 py-1 text-sm disabled:opacity-50"
        >
          {loading ? '加载中…' : '↻ 刷新'}
        </button>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div data-testid="usage-stat-calls" className="rounded border border-canvas-text-muted/20 bg-canvas-surface px-4 py-3">
          <div className="text-xs text-canvas-text-muted">总调用</div>
          <div className="mt-1 text-xl font-semibold">{totalCalls.toLocaleString()}</div>
        </div>
        <div data-testid="usage-stat-tokens" className="rounded border border-canvas-text-muted/20 bg-canvas-surface px-4 py-3">
          <div className="text-xs text-canvas-text-muted">总 token (in+out)</div>
          <div className="mt-1 text-xl font-semibold">{fmtTokens(totalTokens)}</div>
        </div>
        <div data-testid="usage-stat-cost" className="rounded border border-canvas-text-muted/20 bg-canvas-surface px-4 py-3">
          <div className="text-xs text-canvas-text-muted">总 cost</div>
          <div className="mt-1 text-xl font-semibold">{fmtCost(totalCost)}</div>
        </div>
      </div>

      {error && (
        <div data-testid="usage-error" className="rounded border border-rose-500/40 bg-rose-500/10 px-4 py-2 text-sm text-rose-700">
          {error}
        </div>
      )}

      {entries.length === 0 && !loading && !error && (
        <div data-testid="usage-empty" className="rounded border border-canvas-text-muted/20 bg-canvas-surface px-4 py-6 text-center text-sm text-canvas-text-muted">
          暂无调用记录
        </div>
      )}

      {entries.length > 0 && (
        <div className="overflow-hidden rounded border border-canvas-text-muted/20">
          <table data-testid="usage-table" className="w-full text-xs">
            <thead className="bg-canvas-surface">
              <tr>
                <th className="px-3 py-2 text-left">时间</th>
                <th className="px-3 py-2 text-left">agent</th>
                <th className="px-3 py-2 text-left">task</th>
                <th className="px-3 py-2 text-left">tier</th>
                <th className="px-3 py-2 text-left">model</th>
                <th className="px-3 py-2 text-right">in</th>
                <th className="px-3 py-2 text-right">out</th>
                <th className="px-3 py-2 text-right">cost</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e, i) => (
                <tr
                  key={`${e.timestamp}-${i}`}
                  data-testid="usage-row"
                  className="border-t border-canvas-text-muted/10 hover:bg-canvas-surface/40"
                >
                  <td className="px-3 py-1.5 font-mono text-canvas-text-muted">{fmtTimestamp(e.timestamp)}</td>
                  <td className="px-3 py-1.5">{e.agent}</td>
                  <td className="px-3 py-1.5">{e.task}</td>
                  <td className="px-3 py-1.5">{e.tier}</td>
                  <td className="px-3 py-1.5">{e.model}</td>
                  <td className="px-3 py-1.5 text-right font-mono">{e.tokens_in}</td>
                  <td className="px-3 py-1.5 text-right font-mono">{e.tokens_out}</td>
                  <td className="px-3 py-1.5 text-right font-mono">{fmtCost(e.cost)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}