import { useCallback, useEffect, useState } from 'react';
import { llmConsole } from '../../api/llmConsole';
import type {
  LLMRouterSummary,
  ModelEntry,
  ModelTiersConfig,
  ProviderStatus,
  UsageRecord,
} from '../../api/client';
import UsageRecentTable from './UsageRecentTable';
import ProviderPanel from './ProviderPanel';
import TierPanel from './TierPanel';
import AgentMappingPanel from './AgentMappingPanel';

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export default function AIConsoleModal({ isOpen, onClose }: Props) {
  const [config, setConfig] = useState<ModelTiersConfig | null>(null);
  const [draft, setDraft] = useState<ModelTiersConfig | null>(null);
  const [providers, setProviders] = useState<ProviderStatus[]>([]);
  const [usage, setUsage] = useState<UsageRecord[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDirty, setConfirmDirty] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [showMigrate, setShowMigrate] = useState(false);
  const [providerDirty, setProviderDirty] = useState(false);

  const dirty = (!!config && !!draft && !deepEqual(config, draft)) || providerDirty;

  const refresh = useCallback(async () => {
    const [cfg, prov, usg] = await Promise.all([
      llmConsole.getConfig(),
      llmConsole.getProviders(),
      llmConsole.getUsage(50),
    ]);
    setConfig(cfg);
    setDraft(cfg);
    setProviders(prov);
    setUsage(usg);
    setShowMigrate(!cfg.providers);
    setProviderDirty(false);
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    setError(null);
    refresh().catch((e) => setError(e instanceof Error ? e.message : '加载失败'));
  }, [isOpen, refresh]);

  const closeOrConfirm = useCallback(() => {
    if (dirty) setConfirmDirty(true);
    else onClose();
  }, [dirty, onClose]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeOrConfirm();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [isOpen, closeOrConfirm]);

  if (!isOpen) return null;

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
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex bg-black/50"
      onClick={(e) => {
        if (e.target === e.currentTarget) closeOrConfirm();
      }}
    >
      <div className="m-auto flex h-[90vh] w-[min(1200px,96vw)] flex-col overflow-hidden rounded-lg bg-canvas-bg shadow-xl">
        <header className="flex items-center justify-between border-b border-canvas-text-muted/20 bg-canvas-surface px-6 py-3">
          <h2 className="text-lg font-semibold">AI 控制台</h2>
          <div className="flex items-center gap-2">
            {showMigrate && (
              <button
                type="button"
                data-testid="modal-migrate"
                onClick={async () => {
                  try {
                    await llmConsole.migrateConfig();
                    await refresh();
                    setShowMigrate(false);
                    setToast('迁移完成');
                    setTimeout(() => setToast(null), 3000);
                  } catch (e) {
                    setError(e instanceof Error ? e.message : '迁移失败');
                  }
                }}
                className="rounded border border-amber-500/40 px-3 py-1 text-sm text-amber-700"
              >
                ⚠ 迁移 providers 到新结构
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
          <section className="mb-6">
            <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-canvas-text-muted">最近调用 (LLM Usage · 最近 50 条)</h3>
            <UsageRecentTable records={usage} />
          </section>

          <section className="mb-6">
            <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-canvas-text-muted">Provider 状态</h3>
            <ProviderPanel providers={providers} dirty={dirty} onChange={() => setProviderDirty(true)} onReload={refresh} />
          </section>

          {draft && (
            <section className="mb-6">
              <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-canvas-text-muted">Tier 配置</h3>
              <div className="space-y-3">
                {(() => {
                  const catalog: ModelEntry[] = draft.providers
                    ? Object.values(draft.providers).flatMap((p) => Object.values(p.models))
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

          {draft && (
            <section className="mb-6">
              <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-canvas-text-muted">Agent 映射</h3>
              <AgentMappingPanel
                value={draft.agent_mapping}
                tiers={draft.tiers}
                onChange={(next) =>
                  setDraft({ ...draft, agent_mapping: next as ModelTiersConfig['agent_mapping'] })
                }
              />
            </section>
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
    </div>
  );
}