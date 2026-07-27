import { useState } from 'react';
import { llmConsole, type ProviderEntry, type ProviderStatus } from '../../api/llmConsole';
import type { ModelEntry } from '../../api/client';

interface Props {
  providers: ProviderStatus[];
  dirty: boolean;
  onChange: () => void;
  onReload: () => Promise<void> | void;
}

interface ErrorState {
  message: string;
  paths?: string[];
}

function ApiKeyModal({ providerId, onClose, onSaved }: { providerId: string; onClose: () => void; onSaved: () => void }) {
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div data-testid="provider-apikey-modal" className="fixed inset-0 z-30 flex items-center justify-center bg-black/40">
      <div className="rounded bg-canvas-bg p-6 shadow-xl">
        <h4 className="mb-3 text-sm font-semibold">设置 {providerId} API Key</h4>
        <input data-testid="provider-apikey-input" type="password" className="w-80 rounded border border-canvas-text-muted/40 bg-canvas-surface px-2 py-1 text-sm" value={value} onChange={(e) => setValue(e.target.value)} />
        {error && <div data-testid="provider-apikey-error" className="mt-2 text-xs text-rose-600">{error}</div>}
        <div className="mt-3 flex justify-end gap-2">
          <button type="button" className="rounded border px-3 py-1 text-sm" onClick={onClose}>取消</button>
          <button type="button" data-testid="provider-apikey-save" disabled={!value || saving} className="rounded bg-canvas-accent px-3 py-1 text-sm text-white disabled:opacity-50" onClick={async () => {
            setSaving(true);
            setError(null);
            try {
              await llmConsole.setProviderApiKey(providerId, value);
              await onSaved();
              onClose();
            } catch (e) {
              setError(e instanceof Error ? e.message : '保存失败');
            } finally {
              setSaving(false);
            }
          }}>保存</button>
        </div>
      </div>
    </div>
  );
}

interface ProviderFormModalProps {
  initial?: { id: string; display_name: string; type: ProviderEntry['type']; base_url: string; api_key_env: string; enabled: boolean } | null;
  onClose: () => void;
  onSaved: () => void;
}

function ProviderFormModal({ initial, onClose, onSaved }: ProviderFormModalProps) {
  const isEdit = !!initial;
  const [id, setId] = useState(initial?.id ?? '');
  const [displayName, setDisplayName] = useState(initial?.display_name ?? '');
  const [type, setType] = useState<ProviderEntry['type']>(initial?.type ?? 'openai_compatible');
  const [baseUrl, setBaseUrl] = useState(initial?.base_url ?? '');
  const [apiKeyEnv, setApiKeyEnv] = useState(initial?.api_key_env ?? '');
  const [enabled, setEnabled] = useState(initial?.enabled ?? true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <div data-testid="provider-form-modal" className="fixed inset-0 z-30 flex items-center justify-center bg-black/40">
      <div className="w-[480px] rounded bg-canvas-bg p-6 shadow-xl">
        <h4 className="mb-3 text-sm font-semibold">{isEdit ? `编辑 provider '${initial!.id}'` : '新增 Provider'}</h4>
        <div className="space-y-3 text-sm">
          <label className="block"><span className="text-canvas-text-muted">ID（仅新建可设）</span><input data-testid="provider-form-id" disabled={isEdit} value={id} onChange={(e) => { setId(e.target.value); setError(null); }} className="mt-1 w-full rounded border border-canvas-text-muted/30 bg-canvas-surface px-2 py-1 disabled:opacity-50" /></label>
          <label className="block"><span className="text-canvas-text-muted">显示名</span><input data-testid="provider-form-displayname" value={displayName} onChange={(e) => { setDisplayName(e.target.value); setError(null); }} className="mt-1 w-full rounded border border-canvas-text-muted/30 bg-canvas-surface px-2 py-1" /></label>
          <label className="block"><span className="text-canvas-text-muted">类型</span><select data-testid="provider-form-type" value={type} onChange={(e) => setType(e.target.value as ProviderEntry['type'])} className="mt-1 w-full rounded border border-canvas-text-muted/30 bg-canvas-surface px-2 py-1"><option value="anthropic">anthropic</option><option value="openai_compatible">openai_compatible</option><option value="mock">mock</option></select></label>
          <label className="block"><span className="text-canvas-text-muted">Base URL</span><input data-testid="provider-form-baseurl" value={baseUrl} onChange={(e) => { setBaseUrl(e.target.value); setError(null); }} className="mt-1 w-full rounded border border-canvas-text-muted/30 bg-canvas-surface px-2 py-1" /></label>
          <label className="block"><span className="text-canvas-text-muted">API Key 环境变量名</span><input data-testid="provider-form-apikeyenv" value={apiKeyEnv} onChange={(e) => { setApiKeyEnv(e.target.value); setError(null); }} placeholder="如：ANTHROPIC_API_KEY" className="mt-1 w-full rounded border border-canvas-text-muted/30 bg-canvas-surface px-2 py-1" /></label>
          <label className="flex items-center gap-2"><input data-testid="provider-form-enabled" type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} /><span>启用</span></label>
        </div>
        {error && <div data-testid="provider-form-error" className="mt-3 rounded border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-700">{error}</div>}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded border border-canvas-text-muted/40 px-3 py-1 text-sm">取消</button>
          <button type="button" data-testid="provider-form-save" disabled={!id || !displayName || saving} className="rounded bg-canvas-accent px-3 py-1 text-sm text-white disabled:opacity-50" onClick={async () => {
            setSaving(true);
            setError(null);
            try {
              const provider = { type, display_name: displayName, base_url: baseUrl, api_key_env: apiKeyEnv, enabled };
              await llmConsole.upsertProvider(id, isEdit ? provider : { ...provider, models: {} });
              await onSaved();
              onClose();
            } catch (e) {
              setError(e instanceof Error ? e.message : '保存失败');
            } finally {
              setSaving(false);
            }
          }}>保存</button>
        </div>
      </div>
    </div>
  );
}

interface ModelFormModalProps {
  providerId: string;
  modelId?: string;
  initial?: Partial<ModelEntry>;
  onClose: () => void;
  onSaved: () => void;
}

function ModelFormModal({ providerId, modelId, initial, onClose, onSaved }: ModelFormModalProps) {
  const isEdit = !!modelId;
  const [id, setId] = useState(modelId ?? '');
  const [displayName, setDisplayName] = useState(initial?.display_name ?? '');
  const [maxTokens, setMaxTokens] = useState(initial?.max_tokens ?? 8192);
  const [temperature, setTemperature] = useState(initial?.temperature ?? 0.7);
  const [jsonMode, setJsonMode] = useState(initial?.json_mode ?? false);
  const [stream, setStream] = useState(initial?.stream ?? true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <div data-testid="model-form-modal" className="fixed inset-0 z-30 flex items-center justify-center bg-black/40">
      <div className="w-[480px] rounded bg-canvas-bg p-6 shadow-xl">
        <h4 className="mb-3 text-sm font-semibold">{isEdit ? `编辑 model '${modelId}'` : `新增 model (provider: ${providerId})`}</h4>
        <div className="space-y-3 text-sm">
          <label className="block"><span className="text-canvas-text-muted">ID（仅新建可设）</span><input data-testid="model-form-id" disabled={isEdit} value={id} onChange={(e) => { setId(e.target.value); setError(null); }} className="mt-1 w-full rounded border border-canvas-text-muted/30 bg-canvas-surface px-2 py-1 disabled:opacity-50" /></label>
          <label className="block"><span className="text-canvas-text-muted">显示名</span><input data-testid="model-form-displayname" value={displayName} onChange={(e) => { setDisplayName(e.target.value); setError(null); }} className="mt-1 w-full rounded border border-canvas-text-muted/30 bg-canvas-surface px-2 py-1" /></label>
          <label className="block"><span className="text-canvas-text-muted">max_tokens</span><input data-testid="model-form-max-tokens" type="number" value={maxTokens} onChange={(e) => setMaxTokens(parseInt(e.target.value, 10) || 0)} className="mt-1 w-full rounded border border-canvas-text-muted/30 bg-canvas-surface px-2 py-1" /></label>
          <label className="block"><span className="text-canvas-text-muted">temperature</span><input data-testid="model-form-temperature" type="number" step="0.05" min="0" max="2" value={temperature} onChange={(e) => setTemperature(parseFloat(e.target.value) || 0)} className="mt-1 w-full rounded border border-canvas-text-muted/30 bg-canvas-surface px-2 py-1" /></label>
          <label className="flex items-center gap-2"><input data-testid="model-form-json-mode" type="checkbox" checked={jsonMode} onChange={(e) => setJsonMode(e.target.checked)} /><span>json_mode</span></label>
          <label className="flex items-center gap-2"><input data-testid="model-form-stream" type="checkbox" checked={stream} onChange={(e) => setStream(e.target.checked)} /><span>stream</span></label>
        </div>
        {error && <div data-testid="model-form-error" className="mt-3 rounded border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-700">{error}</div>}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded border border-canvas-text-muted/40 px-3 py-1 text-sm">取消</button>
          <button type="button" data-testid="model-form-save" disabled={!id || !displayName || saving} className="rounded bg-canvas-accent px-3 py-1 text-sm text-white disabled:opacity-50" onClick={async () => {
            setSaving(true);
            setError(null);
            try {
              const model: ModelEntry = {
                id,
                provider: providerId,
                display_name: displayName,
                cost_per_1k_input: 0,
                cost_per_1k_output: 0,
                max_tokens: maxTokens,
                temperature,
                json_mode: jsonMode,
                stream,
              };
              await llmConsole.upsertModel(providerId, id, model);
              await onSaved();
              onClose();
            } catch (e) {
              setError(e instanceof Error ? e.message : '保存失败');
            } finally {
              setSaving(false);
            }
          }}>保存</button>
        </div>
      </div>
    </div>
  );
}

export default function ProviderPanel({ providers, dirty, onChange, onReload }: Props) {
  const [editingProvider, setEditingProvider] = useState<ProviderFormModalProps['initial'] | Record<string, never> | null>(null);
  const [apikeyFor, setApikeyFor] = useState<string | null>(null);
  const [addingModelFor, setAddingModelFor] = useState<string | null>(null);
  const [editingModelFor, setEditingModelFor] = useState<{ providerId: string; modelId: string } | null>(null);
  const [error, setError] = useState<ErrorState | null>(null);

  const handleProviderSaved = async () => {
    await onReload();
    onChange();
  };

  const handleApiKeySaved = async () => {
    await onReload();
    onChange();
  };

  const handleModelSaved = async () => {
    await onReload();
    onChange();
  };

  const handleDelete = async (providerId: string) => {
    if (!window.confirm(`删除 provider '${providerId}' 及其全部模型？`)) return;
    try {
      await llmConsole.deleteProvider(providerId);
      await onReload();
      onChange();
    } catch (e) {
      setError({ message: e instanceof Error ? e.message : '删除失败' });
    }
  };

  const handleDeleteModel = async (providerId: string, modelId: string) => {
    try {
      await llmConsole.deleteModel(providerId, modelId);
      await onReload();
      onChange();
    } catch (e) {
      const paths = (e as { detail?: { invalid_paths?: unknown } })?.detail?.invalid_paths;
      setError({ message: '无法删除 — 仍有引用', paths: Array.isArray(paths) ? paths.filter((p): p is string => typeof p === 'string') : undefined });
    }
  };

  return (
    <div data-testid="provider-panel" className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm text-canvas-text-muted">Provider ({providers.length})</span>
        <button type="button" data-testid="provider-add" className="rounded border border-canvas-accent/40 px-2 py-0.5 text-xs text-canvas-accent" onClick={() => setEditingProvider({})}>+ 新增 Provider</button>
      </div>
      <div className={`grid gap-3 ${providers.length > 6 ? '' : 'sm:grid-cols-3'}`}>
        {providers.map((p) => (
          <div key={p.provider} data-testid={`provider-${p.provider}`} className="rounded-lg border border-canvas-text-muted/20 bg-canvas-surface px-4 py-3">
            <div className="flex items-center justify-between">
              <div><span className="text-sm font-semibold">{p.display_name}</span><span className="ml-2 text-xs text-canvas-text-muted">{p.type}</span></div>
              <span className={`text-xs ${p.api_key_configured ? 'text-emerald-600' : 'text-rose-600'}`}>{p.api_key_configured ? '✓ 已配置' : '✗ 未配置'}</span>
            </div>
            <div className="mt-2 truncate text-xs text-canvas-text-muted" title={p.base_url}>{p.base_url || '(无 base_url)'}</div>
            <div className="mt-3 flex flex-wrap gap-1">
              <button type="button" data-testid={`provider-${p.provider}-edit`} className="rounded border px-2 py-0.5 text-xs" onClick={() => setEditingProvider({ id: p.provider, display_name: p.display_name, type: p.type, base_url: p.base_url, api_key_env: p.api_key_env, enabled: p.enabled })}>编辑</button>
              <button type="button" data-testid={`provider-${p.provider}-apikey`} className="rounded border px-2 py-0.5 text-xs" onClick={() => setApikeyFor(p.provider)}>API Key</button>
              <button type="button" data-testid={`provider-${p.provider}-delete`} className="rounded border border-rose-500/40 px-2 py-0.5 text-xs text-rose-600" onClick={() => handleDelete(p.provider)}>删除</button>
            </div>
            <div className="mt-3 space-y-1">
              <div className="mb-1 flex items-center justify-between">
                <span className="text-xs text-canvas-text-muted">模型 ({p.models.length})</span>
                <button type="button" data-testid={`provider-${p.provider}-add-model`} className="rounded border border-canvas-accent/40 px-2 py-0.5 text-xs text-canvas-accent" onClick={() => setAddingModelFor(p.provider)}>+ 新增模型</button>
              </div>
              {p.models.length === 0 && <span className="text-xs text-canvas-text-muted">（无模型）</span>}
              {p.models.map((m) => (
                <div key={m.id} className="flex items-center justify-between rounded bg-canvas-bg px-2 py-1 text-xs">
                  <span className="font-mono">{m.id}</span>
                  <div className="flex gap-1">
                    <button type="button" data-testid={`provider-${p.provider}-model-${m.id}-edit`} className="text-canvas-accent" onClick={() => setEditingModelFor({ providerId: p.provider, modelId: m.id })}>编辑</button>
                    <button type="button" data-testid={`provider-${p.provider}-model-${m.id}-delete`} className="text-rose-600" onClick={() => handleDeleteModel(p.provider, m.id)}>删除</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
      {error && <div data-testid="provider-error-toast" className="rounded border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-700">{error.message}{error.paths && <ul className="mt-1 list-disc pl-5 text-xs">{error.paths.map((p) => <li key={p}>{p}</li>)}</ul>}</div>}
      {apikeyFor && <ApiKeyModal providerId={apikeyFor} onClose={() => setApikeyFor(null)} onSaved={handleApiKeySaved} />}
      {editingProvider !== null && <ProviderFormModal initial={Object.keys(editingProvider).length ? editingProvider as NonNullable<ProviderFormModalProps['initial']> : null} onClose={() => setEditingProvider(null)} onSaved={handleProviderSaved} />}
      {addingModelFor && <ModelFormModal providerId={addingModelFor} onClose={() => setAddingModelFor(null)} onSaved={handleModelSaved} />}
      {editingModelFor && (() => {
        const provider = providers.find((pp) => pp.provider === editingModelFor.providerId);
        const model = provider?.models.find((mm) => mm.id === editingModelFor.modelId);
        return <ModelFormModal providerId={editingModelFor.providerId} modelId={editingModelFor.modelId} initial={model} onClose={() => setEditingModelFor(null)} onSaved={handleModelSaved} />;
      })()}
    </div>
  );
}
