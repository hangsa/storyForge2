import { useState } from 'react';
import { llmConsole, type ProviderStatus } from '../../api/llmConsole';

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
  return (
    <div data-testid="provider-apikey-modal" className="fixed inset-0 z-30 flex items-center justify-center bg-black/40">
      <div className="rounded bg-canvas-bg p-6 shadow-xl">
        <h4 className="mb-3 text-sm font-semibold">设置 {providerId} API Key</h4>
        <input data-testid="provider-apikey-input" type="password" className="w-80 rounded border border-canvas-text-muted/40 bg-canvas-surface px-2 py-1 text-sm" value={value} onChange={(e) => setValue(e.target.value)} />
        <div className="mt-3 flex justify-end gap-2">
          <button type="button" className="rounded border px-3 py-1 text-sm" onClick={onClose}>取消</button>
          <button type="button" data-testid="provider-apikey-save" disabled={!value || saving} className="rounded bg-canvas-accent px-3 py-1 text-sm text-white disabled:opacity-50" onClick={async () => {
            setSaving(true);
            try {
              await llmConsole.setProviderApiKey(providerId, value);
              onSaved();
              onClose();
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
  const [editing, setEditing] = useState<string | null>(null);
  const [apikeyFor, setApikeyFor] = useState<string | null>(null);
  const [error, setError] = useState<ErrorState | null>(null);

  const handleApiKeySaved = async () => {
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
        <button type="button" data-testid="provider-add" className="rounded border border-canvas-accent/40 px-2 py-0.5 text-xs text-canvas-accent">+ 新增 Provider</button>
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
              <button type="button" data-testid={`provider-${p.provider}-edit`} className="rounded border px-2 py-0.5 text-xs" onClick={() => setEditing(p.provider)}>编辑</button>
              <button type="button" data-testid={`provider-${p.provider}-apikey`} className="rounded border px-2 py-0.5 text-xs" onClick={() => setApikeyFor(p.provider)}>API Key</button>
              <button type="button" data-testid={`provider-${p.provider}-delete`} className="rounded border border-rose-500/40 px-2 py-0.5 text-xs text-rose-600" onClick={() => handleDelete(p.provider)}>删除</button>
            </div>
            <div className="mt-3 space-y-1">
              {p.models.length === 0 && <span className="text-xs text-canvas-text-muted">（无模型）</span>}
              {p.models.map((m) => (
                <div key={m.id} className="flex items-center justify-between rounded bg-canvas-bg px-2 py-1 text-xs">
                  <span className="font-mono">{m.id}</span>
                  <button type="button" data-testid={`provider-${p.provider}-model-${m.id}-delete`} className="text-rose-600" onClick={() => handleDeleteModel(p.provider, m.id)}>删除</button>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
      {error && <div data-testid="provider-error-toast" className="rounded border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-700">{error.message}{error.paths && <ul className="mt-1 list-disc pl-5 text-xs">{error.paths.map((p) => <li key={p}>{p}</li>)}</ul>}</div>}
      {apikeyFor && <ApiKeyModal providerId={apikeyFor} onClose={() => setApikeyFor(null)} onSaved={handleApiKeySaved} />}
      {editing && <span data-testid={`provider-${editing}-editing`} className="sr-only" />}
    </div>
  );
}
