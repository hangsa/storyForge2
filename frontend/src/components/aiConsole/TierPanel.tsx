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

  const noOptions = catalog.length === 0 && value.models.length === 0;
  // Whitelist items not in the catalog (so old refs stay selectable after model removal)
  const whitelistOnly = value.models.filter((mid) => !catalog.some((c) => c.id === mid));

  const handleDefaultChange = (mid: string) => {
    if (!mid) return;
    const needsWhitelistAdd = !value.models.includes(mid);
    update({
      default: mid,
      models: needsWhitelistAdd ? [...value.models, mid] : value.models,
    });
  };

  const handleFallbackChange = (mid: string) => {
    if (!mid) {
      update({ fallback: null });
      return;
    }
    const needsWhitelistAdd = !value.models.includes(mid);
    update({
      fallback: mid,
      models: needsWhitelistAdd ? [...value.models, mid] : value.models,
    });
  };

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
              disabled={disabled || noOptions}
              value={value.default || ''}
              onChange={(e) => handleDefaultChange(e.target.value)}
            >
              {noOptions ? (
                <option value="" disabled>无可用模型</option>
              ) : (
                <>
                  {catalog.map((m) => (
                    <option key={m.id} value={m.id}>{m.id}</option>
                  ))}
                  {whitelistOnly.map((mid) => (
                    <option key={mid} value={mid}>{mid}</option>
                  ))}
                </>
              )}
            </select>
          </label>
          <label className="text-sm">
            <span className="text-canvas-text-muted">回退模型</span>
            <select
              data-testid={`tier-${tid}-fallback`}
              className="ml-1 rounded border border-canvas-text-muted/30 bg-canvas-bg px-2 py-1 text-sm"
              disabled={disabled}
              value={value.fallback ?? ''}
              onChange={(e) => handleFallbackChange(e.target.value)}
            >
              <option value="">（无）</option>
              {catalog.map((m) => (
                <option key={m.id} value={m.id}>{m.id}</option>
              ))}
              {whitelistOnly.map((mid) => (
                <option key={mid} value={mid}>{mid}</option>
              ))}
            </select>
          </label>
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm text-canvas-text-muted">白名单模型 ({value.models.length})</span>
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
            {value.models.length === 0 && (
              <div className="text-xs text-canvas-text-muted">（从上方下拉选择默认/回退模型即可自动加入白名单）</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
