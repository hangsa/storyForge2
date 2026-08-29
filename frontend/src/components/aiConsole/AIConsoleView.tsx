import { useCallback, useEffect, useState } from 'react';
import type { LLMRouterSummary, ModelEntry, ModelTiersConfig, ProviderStatus } from '../../api/client';
import { llmConsole } from '../../api/llmConsole';
import ProviderPanel from './ProviderPanel';
import TierPanel from './TierPanel';
import AgentMappingPanel from './AgentMappingPanel';
import UsagePanel from './UsagePanel';

interface Props {
  onClose: () => void;
}

function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

type TabKey = 'provider' | 'tier' | 'agent' | 'usage';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'provider', label: 'Provider / 模型' },
  { key: 'tier', label: 'Tier 配置' },
  { key: 'agent', label: 'Agent 映射' },
  { key: 'usage', label: '最近调用统计' },
];

const BUILTIN_PROVIDERS = ['anthropic', 'deepseek', 'minimax'] as const;

function isBuiltinMissing(cfg: ModelTiersConfig | null): boolean {
  if (!cfg?.providers) return true;
  const ids = Object.keys(cfg.providers);
  return BUILTIN_PROVIDERS.some((pid) => !ids.includes(pid));
}

export default function AIConsoleView({ onClose }: Props) {
  const [config, setConfig] = useState<ModelTiersConfig | null>(null);
  const [draft, setDraft] = useState<ModelTiersConfig | null>(null);
  const [providers, setProviders] = useState<ProviderStatus[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDirty, setConfirmDirty] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [showMigrate, setShowMigrate] = useState(false);
  const [providerDirty, setProviderDirty] = useState(false);
  const [activeTab, setActiveTab] = useState<TabKey>('provider');
  const [usageRefreshSignal, setUsageRefreshSignal] = useState(0);

  const dirty = (!!config && !!draft && !deepEqual(config, draft)) || providerDirty;

  const refresh = useCallback(async () => {
    const [cfg, prov] = await Promise.all([
      llmConsole.getConfig(),
      llmConsole.getProviders(),
    ]);
    setConfig(cfg);
    setDraft(cfg);
    setProviders(prov);
    setShowMigrate(isBuiltinMissing(cfg));
    setProviderDirty(false);
  }, []);

  useEffect(() => {
    setError(null);
    refresh().catch((e) => setError(e instanceof Error ? e.message : '加载失败'));
  }, [refresh]);

  const closeOrConfirm = useCallback(() => {
    if (dirty) setConfirmDirty(true);
    else onClose();
  }, [dirty, onClose]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeOrConfirm();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [closeOrConfirm]);

  const handleSave = async () => {
    if (!draft) return;
    setSaving(true);
    setError(null);
    try {
      const summary: LLMRouterSummary = await llmConsole.saveConfig(draft);
      setToast(`配置已热重载，${summary.tiers} 个 tier、${summary.agents} 个 agent 已加载`);
      setConfig(draft);
      setProviderDirty(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存失败');
    } finally {
      setSaving(false);
      setTimeout(() => setToast(null), 3000);
    }
  };

  const handleReload = async () => {
    if (dirty) {
      const ok = window.confirm('当前修改未保存，刷新将丢弃，继续？');
      if (!ok) return;
    }
    try {
      await llmConsole.reload();
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : '重载失败');
    }
  };

  return (
    <div className="relative flex h-full flex-col overflow-hidden rounded-lg bg-canvas-bg shadow-xl">
      <header className="flex items-center justify-between border-b border-canvas-text-muted/20 bg-canvas-surface px-6 py-3">
        <h2 className="text-lg font-semibold">AI 控制台</h2>
        <div className="flex items-center gap-2">
          {showMigrate && (
            <button
              type="button"
              data-testid="modal-migrate"
              onClick={async () => {
                try {
                  const result = await llmConsole.migrateConfig();
                  await refresh();
                  const added = result.added ?? [];
                  setToast(
                    added.length > 0
                      ? `已补种 ${added.length} 个内置 provider：${added.join(', ')}`
                      : '迁移完成',
                  );
                  setShowMigrate(false);
                  setTimeout(() => setToast(null), 3000);
                } catch (e) {
                  setError(e instanceof Error ? e.message : '迁移失败');
                }
              }}
              className="rounded border border-amber-500/40 px-3 py-1 text-sm text-amber-700"
            >
              {config?.providers ? '⚠ 补种内置 provider' : '⚠ 迁移 providers 到新结构'}
            </button>
          )}
          <button
            type="button"
            data-testid="modal-reload"
            onClick={handleReload}
            className="rounded border border-canvas-text-muted/40 px-3 py-1 text-sm"
          >
            ↻ 重新加载
          </button>
          <button
            type="button"
            data-testid="modal-close"
            onClick={closeOrConfirm}
            className="rounded border border-canvas-text-muted/40 px-3 py-1 text-sm"
          >
            × 关闭
          </button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-6 py-4">
        <div role="tablist" aria-label="AI 控制台分区" className="mb-4 flex gap-1 border-b border-canvas-text-muted/20">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={activeTab === t.key}
              data-testid={`tab-${t.key}`}
              onClick={() => setActiveTab(t.key)}
              className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
                activeTab === t.key
                  ? 'border-canvas-accent text-canvas-accent'
                  : 'border-transparent text-canvas-text-muted hover:text-canvas-text'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {activeTab === 'provider' && (
          <section data-testid="tab-panel-provider" className="mb-6">
            <ProviderPanel providers={providers} dirty={dirty} onChange={() => setProviderDirty(true)} onReload={refresh} />
          </section>
        )}

        {activeTab === 'tier' && draft && (
          <section data-testid="tab-panel-tier" className="mb-6">
            <div className="space-y-3">
              {(() => {
                const catalog: ModelEntry[] = draft.providers
                  ? Object.entries(draft.providers).flatMap(([pid, p]) =>
                      Object.entries(p.models).map(([mid, m]) => ({
                        ...m,
                        id: mid,
                        provider: pid,
                      }))
                    )
                  : providers.flatMap((p) => p.models);
                return Object.entries(draft.tiers).map(([name, tier]) => (
                  <TierPanel
                    key={name}
                    tierName={name}
                    value={tier}
                    catalog={catalog}
                    onChange={(next) =>
                      setDraft({ ...draft, tiers: { ...draft.tiers, [name]: next } })
                    }
                  />
                ));
              })()}
            </div>
          </section>
        )}

        {activeTab === 'agent' && draft && (
          <section data-testid="tab-panel-agent" className="mb-6">
            {(() => {
              const catalog: ModelEntry[] = draft.providers
                ? Object.entries(draft.providers).flatMap(([pid, p]) =>
                    Object.entries(p.models).map(([mid, m]) => ({
                      ...m,
                      id: mid,
                      provider: pid,
                    }))
                  )
                : providers.flatMap((p) => p.models);
              return (
                <AgentMappingPanel
                  value={draft.agent_mapping}
                  tiers={draft.tiers}
                  catalog={catalog}
                  onChange={(next) =>
                    setDraft({ ...draft, agent_mapping: next as ModelTiersConfig['agent_mapping'] })
                  }
                />
              );
            })()}
          </section>
        )}

        {activeTab === 'usage' && (
          <UsagePanel refreshSignal={usageRefreshSignal} />
        )}

        {error && (
          <div data-testid="modal-error" className="mb-4 rounded border border-rose-500/40 bg-rose-500/10 px-4 py-2 text-sm text-rose-700">
            {error}
          </div>
        )}
        {toast && (
          <div data-testid="modal-toast" className="fixed bottom-20 left-1/2 z-10 -translate-x-1/2 rounded bg-emerald-600 px-4 py-2 text-sm text-white shadow">
            {toast}
          </div>
        )}
      </div>

      <footer className="flex items-center justify-end gap-3 border-t border-canvas-text-muted/20 bg-canvas-surface px-6 py-3">
        <button
          type="button"
          data-testid="modal-cancel"
          disabled={!dirty || saving}
          onClick={() => setDraft(config)}
          className="rounded border border-canvas-text-muted/40 px-4 py-1 text-sm disabled:opacity-50"
        >
          取消修改
        </button>
        <button
          type="button"
          data-testid="modal-save"
          disabled={!dirty || saving}
          onClick={handleSave}
          className="rounded bg-canvas-accent px-4 py-1 text-sm text-white disabled:opacity-50"
        >
          {saving ? '保存中…' : '保存并热重载'}
        </button>
      </footer>

      {confirmDirty && (
        <div data-testid="dirty-confirm" className="absolute inset-0 z-10 flex items-center justify-center bg-black/40">
          <div className="rounded-lg bg-canvas-bg p-6 shadow-xl">
            <p className="mb-4">有未保存的修改，确定关闭？</p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                data-testid="dirty-confirm-cancel"
                onClick={() => setConfirmDirty(false)}
                className="rounded border border-canvas-text-muted/40 px-3 py-1 text-sm"
              >
                继续编辑
              </button>
              <button
                type="button"
                data-testid="dirty-confirm-discard"
                onClick={() => {
                  setConfirmDirty(false);
                  onClose();
                }}
                className="rounded bg-rose-500 px-3 py-1 text-sm text-white"
              >
                放弃修改
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}