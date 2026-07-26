import { type TierConfig, type ModelEntry } from '../../api/client';

export type { TierConfig };

interface Props {
  tierName: string;
  value: TierConfig;
  onChange: (next: TierConfig) => void;
  readOnly?: boolean;
}

const DEFAULT_NEW_MODEL: ModelEntry = {
  id: '',
  provider: 'anthropic',
  cost_per_1k_input: 0,
  cost_per_1k_output: 0,
  max_tokens: 4096,
};

export default function TierPanel({ tierName, value, onChange, readOnly = false }: Props) {
  const isTier0 = tierName === 'tier_0';
  const disabled = readOnly || isTier0;

  // testid prefix mirrors the asserted shape used in tests: e.g. tier-1-description, tier-0-readonly-note
  const tid = tierName === 'tier_0' ? '0' : tierName.replace(/^tier_/, '');

  const update = (patch: Partial<TierConfig>) => onChange({ ...value, ...patch });

  const updateModel = (idx: number, patch: Partial<ModelEntry>) => {
    const models = value.models.map((m, i) => (i === idx ? { ...m, ...patch } : m));
    update({ models });
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
              disabled={disabled}
              value={value.default}
              onChange={(e) => update({ default: e.target.value })}
            >
              {isTier0 && <option value="none">none</option>}
              {value.models.map((m) => (
                <option key={m.id} value={m.id}>{m.id}</option>
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
              {value.models.map((m) => (
                <option key={m.id} value={m.id}>{m.id}</option>
              ))}
            </select>
          </label>
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm text-canvas-text-muted">模型 ({value.models.length})</span>
            {!disabled && (
              <button
                type="button"
                data-testid={`tier-${tid}-add-model`}
                onClick={() => update({ models: [...value.models, { ...DEFAULT_NEW_MODEL }] })}
                className="rounded border border-canvas-accent/40 px-2 py-0.5 text-xs text-canvas-accent"
              >
                + 新增模型
              </button>
            )}
          </div>
          <div className="space-y-2">
            {value.models.map((m, idx) => (
              <div key={idx} className="rounded border border-canvas-text-muted/10 bg-canvas-surface px-3 py-2">
                <div className="grid grid-cols-12 gap-2 text-sm">
                  <input
                    data-testid={`tier-${tid}-model-${idx}-id`}
                    className="col-span-4 rounded border border-canvas-text-muted/30 bg-canvas-bg px-2 py-1 font-mono text-xs"
                    value={m.id}
                    disabled={disabled}
                    onChange={(e) => updateModel(idx, { id: e.target.value })}
                    placeholder="model id"
                  />
                  <select
                    data-testid={`tier-${tid}-model-${idx}-provider`}
                    className="col-span-3 rounded border border-canvas-text-muted/30 bg-canvas-bg px-2 py-1 text-xs"
                    value={m.provider}
                    disabled={disabled}
                    onChange={(e) => updateModel(idx, { provider: e.target.value as ModelEntry['provider'] })}
                  >
                    <option value="anthropic">anthropic</option>
                    <option value="deepseek">deepseek</option>
                    <option value="minimax">minimax</option>
                  </select>
                  <input
                    type="number"
                    data-testid={`tier-${tid}-model-${idx}-input-cost`}
                    className="col-span-2 rounded border border-canvas-text-muted/30 bg-canvas-bg px-2 py-1 text-xs"
                    value={m.cost_per_1k_input}
                    disabled={disabled}
                    onChange={(e) => updateModel(idx, { cost_per_1k_input: Number(e.target.value) })}
                  />
                  <input
                    type="number"
                    data-testid={`tier-${tid}-model-${idx}-output-cost`}
                    className="col-span-2 rounded border border-canvas-text-muted/30 bg-canvas-bg px-2 py-1 text-xs"
                    value={m.cost_per_1k_output}
                    disabled={disabled}
                    onChange={(e) => updateModel(idx, { cost_per_1k_output: Number(e.target.value) })}
                  />
                  <button
                    type="button"
                    data-testid={`tier-${tid}-model-${idx}-remove`}
                    disabled={disabled}
                    onClick={() => update({ models: value.models.filter((_, i) => i !== idx) })}
                    className="col-span-1 rounded border border-rose-500/40 px-2 py-1 text-xs text-rose-600"
                  >
                    删除
                  </button>
                </div>
                <div className="mt-2 text-xs text-canvas-text-muted">
                  max_tokens:
                  <input
                    type="number"
                    data-testid={`tier-${tid}-model-${idx}-max-tokens`}
                    className="ml-2 w-24 rounded border border-canvas-text-muted/30 bg-canvas-bg px-2 py-0.5 text-xs"
                    value={m.max_tokens}
                    disabled={disabled}
                    onChange={(e) => updateModel(idx, { max_tokens: Number(e.target.value) })}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
