import { useState } from 'react';
import type { ModelEntry, TierConfig } from '../../api/client';

export type { TierConfig };

interface Props {
  tierName: string;
  value: TierConfig;
  onChange: (next: TierConfig) => void;
  catalog: ModelEntry[];
  readOnly?: boolean;
}

export default function TierPanel({ tierName, value, onChange, catalog, readOnly = false }: Props) {
  const isTier0 = tierName === 'tier_0';
  const disabled = readOnly || isTier0;
  const tid = tierName === 'tier_0' ? '0' : tierName.replace(/^tier_/, '');
  const update = (patch: Partial<TierConfig>) => onChange({ ...value, ...patch });
  const [pendingModel, setPendingModel] = useState('');

  return (
    <div data-testid={`tier-${tid}`} className="rounded-lg border border-canvas-text-muted/20">
      <div className="flex items-center justify-between bg-canvas-surface px-4 py-3">
        <div className="font-semibold">{tierName}</div>
        {disabled && (
          <span data-testid={`tier-${tid}-readonly-note`} className="text-xs text-canvas-text-muted">
            {tierName === 'tier_0' ? 'tier_0 只读（确定性）' : '只读'}
          </span>
        )}
      </div>
      <div className="space-y-3 px-4 py-3">
        <label className="block text-sm">
          <span className="text-canvas-text-muted">描述</span>
          <input
            data-testid={`tier-${tid}-description`}
            className="mt-1 w-full rounded border border-canvas-text-muted/30 bg-canvas-bg px-2 py-1"
            value={value.description}
            disabled={disabled}
            onChange={(e) => update({ description: e.target.value })}
          />
        </label>
        <div className="flex items-center gap-3">
          <label className="text-sm">
            <span className="text-canvas-text-muted">默认模型</span>
            <select
              data-testid={`tier-${tid}-default`}
              className="ml-1 rounded border border-canvas-text-muted/30 bg-canvas-bg px-2 py-1 text-sm"
              disabled={disabled}
              value={value.default}
              onChange={(e) => update({ default: e.target.value })}
            >
              {isTier0 && <option value="none">none</option>}
              {catalog.map((m) => (
                <option key={m.id} value={m.id}>{m.id}</option>
              ))}
              {value.models.map((mid) => (
                <option key={mid} value={mid}>{mid}</option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="text-canvas-text-muted">回退模型</span>
            <select
              data-testid={`tier-${tid}-fallback`}
              className="ml-1 rounded border border-canvas-text-muted/30 bg-canvas-bg px-2 py-1 text-sm"
              disabled={disabled}
              value={value.fallback ?? ''}
              onChange={(e) => update({ fallback: e.target.value || null })}
            >
              <option value="">（无）</option>
              {catalog.map((m) => (
                <option key={m.id} value={m.id}>{m.id}</option>
              ))}
              {value.models.map((mid) => (
                <option key={mid} value={mid}>{mid}</option>
              ))}
            </select>
          </label>
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm text-canvas-text-muted">模型 ({value.models.length})</span>
            {!disabled && (
              <div className="flex items-center gap-2">
                <select
                  data-testid={`tier-${tid}-new-model-select`}
                  className="rounded border border-canvas-text-muted/30 bg-canvas-bg px-2 py-0.5 text-xs"
                  value={pendingModel}
                  onChange={(e) => setPendingModel(e.target.value)}
                >
                  <option value="">选择模型…</option>
                  {catalog
                    .filter((m) => !value.models.includes(m.id))
                    .map((m) => (
                      <option key={m.id} value={m.id}>{m.id} ({m.display_name ?? m.id})</option>
                    ))}
                </select>
                <button
                  type="button"
                  data-testid={`tier-${tid}-new-model-add`}
                  disabled={!pendingModel}
                  onClick={() => {
                    update({ models: [...value.models, pendingModel] });
                    setPendingModel('');
                  }}
                  className="rounded border border-canvas-accent/40 px-2 py-0.5 text-xs text-canvas-accent disabled:opacity-50"
                >
                  + 加入
                </button>
              </div>
            )}
          </div>
          <div className="space-y-2">
            {value.models.map((mid, idx) => (
              <div key={mid} className="flex items-center justify-between rounded border border-canvas-text-muted/10 bg-canvas-surface px-3 py-2 text-sm">
                <span className="font-mono text-xs">{mid}</span>
                {!disabled && (
                  <button
                    type="button"
                    data-testid={`tier-${tid}-model-${idx}-remove`}
                    onClick={() => update({ models: value.models.filter((_, i) => i !== idx) })}
                    className="rounded border border-rose-500/40 px-2 py-0.5 text-xs text-rose-600"
                  >
                    删除
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}