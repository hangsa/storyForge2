import type { ProviderStatus } from '../../api/client';

interface Props {
  providers: ProviderStatus[];
}

const LABELS: Record<string, string> = {
  anthropic: 'Anthropic',
  deepseek: 'DeepSeek',
  minimax: 'MiniMax',
};

export default function ProviderPanel({ providers }: Props) {
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {providers.map((p) => (
        <div
          key={p.provider}
          data-testid={`provider-${p.provider}`}
          className="rounded-lg border border-canvas-text-muted/20 bg-canvas-surface px-4 py-3"
        >
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold">{LABELS[p.provider] ?? p.provider}</span>
            <span
              data-testid={`provider-key-${p.provider}`}
              className={`text-xs font-medium ${p.api_key_configured ? 'text-emerald-600' : 'text-rose-600'}`}
            >
              {p.api_key_configured ? '✓ 已配置' : '✗ 未配置'}
            </span>
          </div>
          {p.base_url && (
            <div className="mt-2 truncate text-xs text-canvas-text-muted" title={p.base_url}>
              {p.base_url}
            </div>
          )}
          <div className="mt-2 flex flex-wrap gap-1">
            {p.models.length === 0 ? (
              <span className="text-xs text-canvas-text-muted">（无模型）</span>
            ) : (
              p.models.map((mid) => (
                <span
                  key={mid}
                  className="rounded bg-canvas-bg px-2 py-0.5 font-mono text-xs text-canvas-text-secondary"
                >
                  {mid}
                </span>
              ))
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
