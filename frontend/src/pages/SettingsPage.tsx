import { useState, useEffect, useCallback } from "react";
import { useParams } from "react-router-dom";
import api, { GenreThresholds, ModelConfig, ApiError } from "../api/client";
import GlassPanel from "../components/shared/GlassPanel";
import NarrativeChip from "../components/shared/NarrativeChip";

type TabKey = "thresholds" | "model";

export default function SettingsPage() {
  const { projectId } = useParams<{ projectId: string }>();

  const [activeTab, setActiveTab] = useState<TabKey>("thresholds");
  const [error, setError] = useState("");

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <h2 className="text-3xl font-display text-white">项目设置</h2>
        <p className="text-system-log/50 mt-1 text-sm">
          调整项目流派的读者阈值、查看模型路由配置
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-2">
        {([
          { key: "thresholds" as TabKey, label: "流派阈值" },
          { key: "model" as TabKey, label: "模型配置" },
        ]).map(({ key, label }) => (
          <button
            key={key}
            onClick={() => { setActiveTab(key); setError(""); }}
            className={`rounded-lg px-4 py-2 text-sm transition ${
              activeTab === key
                ? "bg-accent-purple/20 text-accent-purple border border-accent-purple/30"
                : "text-system-log/50 hover:text-system-log/80 border border-transparent"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {activeTab === "thresholds" ? (
        <ThresholdsTab projectId={projectId!} onError={setError} />
      ) : (
        <ModelConfigTab onError={setError} />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Thresholds Tab                                                      */
/* ------------------------------------------------------------------ */

function ThresholdsTab({ projectId, onError }: { projectId: string; onError: (e: string) => void }) {
  const [thresholds, setThresholds] = useState<GenreThresholds | null>(null);
  const [overrides, setOverrides] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [successMsg, setSuccessMsg] = useState("");

  const load = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    try {
      const t = await api.getThresholds(projectId);
      setThresholds(t);
      setOverrides({ ...t.overrides });
    } catch (e) {
      onError(e instanceof ApiError ? e.message : "加载阈值失败");
    } finally {
      setLoading(false);
    }
  }, [projectId, onError]);

  useEffect(() => { load(); }, [load]);

  const handleSave = async () => {
    if (!projectId) return;
    setSaving(true);
    setSuccessMsg("");
    try {
      await api.updateThresholds(projectId, overrides);
      setSuccessMsg("阈值已保存");
    } catch (e) {
      onError(e instanceof ApiError ? e.message : "保存失败");
      setSaving(false);
      return;
    }
    try {
      await load();
    } catch {
      onError("保存成功，但刷新数据失败");
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    setOverrides({});
    if (!projectId) return;
    setSaving(true);
    try {
      await api.updateThresholds(projectId, {});
      setSuccessMsg("已重置为默认值");
    } catch (e) {
      onError(e instanceof ApiError ? e.message : "重置失败");
      setSaving(false);
      return;
    }
    try {
      await load();
    } catch {
      onError("重置成功，但刷新数据失败");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <GlassPanel>
        <div className="flex items-center justify-center py-16">
          <span className="material-symbols-outlined text-3xl text-system-log/30 animate-spin">
            progress_activity
          </span>
        </div>
      </GlassPanel>
    );
  }

  if (!thresholds) return null;

  const defaultEntries = Object.entries(thresholds.defaults);

  return (
    <div className="space-y-4">
      {/* Genre info */}
      <GlassPanel>
        <div className="flex items-center gap-3 mb-4">
          <span className="text-sm text-system-log/50">当前流派</span>
          <NarrativeChip label="流派" value={thresholds.genre} color="primary" />
          {thresholds.fallback_genre && (
            <NarrativeChip label="回退至" value={thresholds.fallback_genre} color="warning" />
          )}
        </div>
        <p className="text-xs text-system-log/40">
          以下阈值用于 ReaderOS 计算器的上瘾度/疲劳度警告触发判断。覆盖值会替代默认值。
        </p>
      </GlassPanel>

      {/* Editable thresholds */}
      <GlassPanel>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-system-log/50 border-b border-outline-variant">
                <th className="pb-3 pr-4 font-medium">阈值键</th>
                <th className="pb-3 pr-4 font-medium">默认值</th>
                <th className="pb-3 font-medium">覆盖值</th>
              </tr>
            </thead>
            <tbody>
              {defaultEntries.map(([key, defaultValue]) => {
                const currentOverride = overrides[key];
                const isOverridden = currentOverride !== undefined;
                return (
                  <tr key={key} className="border-b border-system-log/10">
                    <td className="py-3 pr-4">
                      <span className="text-system-log/80 font-mono text-xs">{key}</span>
                    </td>
                    <td className="py-3 pr-4">
                      {typeof defaultValue === "object" ? (
                        <span className="text-system-log/60 text-xs font-mono">
                          threshold={defaultValue.threshold}, decay={defaultValue.decay}
                        </span>
                      ) : (
                        <span className="text-system-log/60 font-mono text-xs">{String(defaultValue)}</span>
                      )}
                    </td>
                    <td className="py-3">
                      {typeof defaultValue === "object" ? (
                        <div className="flex items-center gap-2 flex-wrap">
                          <input
                            type="number"
                            step="0.1"
                            className="w-24 rounded border border-outline-variant bg-surface-container px-2 py-1 text-xs text-white font-mono"
                            placeholder={String(defaultValue.threshold)}
                            value={overrides[key]?.threshold ?? ""}
                            onChange={(e) => {
                              const v = e.target.value;
                              setOverrides((prev) => {
                                const next = { ...prev };
                                if (v === "" && (prev[key]?.decay === undefined || prev[key]?.decay === "")) {
                                  delete next[key];
                                } else {
                                  next[key] = { ...prev[key], threshold: v === "" ? 0 : (parseFloat(v) || 0) };
                                }
                                return next;
                              });
                            }}
                          />
                          <input
                            type="number"
                            step="0.1"
                            className="w-24 rounded border border-outline-variant bg-surface-container px-2 py-1 text-xs text-white font-mono"
                            placeholder={String(defaultValue.decay)}
                            value={overrides[key]?.decay ?? ""}
                            onChange={(e) => {
                              const v = e.target.value;
                              setOverrides((prev) => {
                                const next = { ...prev };
                                if (v === "" && (prev[key]?.threshold === undefined || prev[key]?.threshold === "" || prev[key]?.threshold === 0)) {
                                  delete next[key];
                                } else {
                                  next[key] = { ...prev[key], decay: v === "" ? 0 : (parseFloat(v) || 0) };
                                }
                                return next;
                              });
                            }}
                          />
                          {isOverridden && (
                            <button
                              onClick={() => {
                                setOverrides((prev) => {
                                  const next = { ...prev };
                                  delete next[key];
                                  return next;
                                });
                              }}
                              className="text-system-log/40 hover:text-red-400 transition"
                              title="重置"
                            >
                              <span className="material-symbols-outlined text-sm">close</span>
                            </button>
                          )}
                        </div>
                      ) : (
                        <div className="flex items-center gap-2">
                          <input
                            type="number"
                            className="w-24 rounded border border-outline-variant bg-surface-container px-2 py-1 text-xs text-white font-mono"
                            placeholder={String(defaultValue)}
                            value={currentOverride ?? ""}
                            onChange={(e) => {
                              const v = e.target.value;
                              setOverrides((prev) => {
                                const next = { ...prev };
                                if (v === "") {
                                  delete next[key];
                                } else {
                                  next[key] = parseFloat(v) || 0;
                                }
                                return next;
                              });
                            }}
                          />
                          {isOverridden && (
                            <button
                              onClick={() => {
                                setOverrides((prev) => {
                                  const next = { ...prev };
                                  delete next[key];
                                  return next;
                                });
                              }}
                              className="text-system-log/40 hover:text-red-400 transition"
                              title="重置"
                            >
                              <span className="material-symbols-outlined text-sm">close</span>
                            </button>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </GlassPanel>

      {/* Action buttons */}
      <div className="flex items-center justify-between">
        <button
          onClick={handleReset}
          disabled={saving}
          className="rounded-lg border border-system-log/20 px-4 py-2 text-sm text-system-log/60 transition hover:border-system-log/40 hover:text-system-log/80 disabled:opacity-50"
        >
          重置全部为默认值
        </button>
        <div className="flex items-center gap-3">
          {successMsg && (
            <span className="text-xs text-emerald-400">{successMsg}</span>
          )}
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 rounded-lg bg-accent-purple px-5 py-2.5 text-sm font-medium text-white transition hover:bg-accent-purple/80 disabled:opacity-50"
          >
            <span className="material-symbols-outlined text-lg">
              {saving ? "progress_activity" : "save"}
            </span>
            {saving ? "保存中..." : "保存覆盖"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Model Config Tab                                                    */
/* ------------------------------------------------------------------ */

const TIER_LABELS: Record<string, string> = {
  tier_0: "Tier 0 · 确定性",
  tier_1: "Tier 1 · 创作核心",
  tier_2: "Tier 2 · 分析层",
  tier_3: "Tier 3 · 辅助层",
};

function ModelConfigTab({ onError }: { onError: (e: string) => void }) {
  const [config, setConfig] = useState<ModelConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [reloading, setReloading] = useState(false);
  const [reloadMsg, setReloadMsg] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const c = await api.getModelConfig();
      setConfig(c);
    } catch (e) {
      onError(e instanceof ApiError ? e.message : "加载模型配置失败");
    } finally {
      setLoading(false);
    }
  }, [onError]);

  useEffect(() => { load(); }, [load]);

  const handleReload = async () => {
    setReloading(true);
    setReloadMsg("");
    try {
      await api.reloadConfig();
      setReloadMsg("配置已重载");
      await load();
    } catch (e) {
      onError(e instanceof ApiError ? e.message : "重载失败");
    } finally {
      setReloading(false);
    }
  };

  if (loading) {
    return (
      <GlassPanel>
        <div className="flex items-center justify-center py-16">
          <span className="material-symbols-outlined text-3xl text-system-log/30 animate-spin">
            progress_activity
          </span>
        </div>
      </GlassPanel>
    );
  }

  if (!config) return null;

  const tierOrder = ["tier_1", "tier_2", "tier_3", "tier_0"];

  return (
    <div className="space-y-4">
      {/* Reload bar */}
      <div className="flex items-center justify-between">
        <span className="text-sm text-system-log/50">运行时热重载模型配置</span>
        <div className="flex items-center gap-3">
          {reloadMsg && <span className="text-xs text-emerald-400">{reloadMsg}</span>}
          <button
            onClick={handleReload}
            disabled={reloading}
            className="flex items-center gap-2 rounded-lg border border-system-log/20 px-4 py-2 text-sm text-system-log/60 transition hover:border-system-log/40 hover:text-system-log/80 disabled:opacity-50"
          >
            <span className="material-symbols-outlined text-lg">
              {reloading ? "progress_activity" : "refresh"}
            </span>
            {reloading ? "重载中..." : "重载配置"}
          </button>
        </div>
      </div>

      {/* Tier cards */}
      <div className="grid grid-cols-2 gap-4">
        {tierOrder.map((tierName) => {
          const tier = config.tiers[tierName];
          if (!tier) return null;
          return (
            <GlassPanel key={tierName}>
              <div className="flex items-center gap-2 mb-2">
                <span className="text-sm font-medium text-white">
                  {TIER_LABELS[tierName] || tierName}
                </span>
              </div>
              <p className="text-xs text-system-log/50 mb-3">{tier.description}</p>
              <div className="space-y-1.5 text-xs">
                <div className="flex items-center gap-2">
                  <span className="text-system-log/40 w-12 shrink-0">默认</span>
                  <NarrativeChip label="" value={tier.default || "none"} color="primary" />
                </div>
                {tier.fallback && (
                  <div className="flex items-center gap-2">
                    <span className="text-system-log/40 w-12 shrink-0">降级</span>
                    <NarrativeChip label="" value={tier.fallback} color="warning" />
                  </div>
                )}
                <div className="flex items-center gap-2">
                  <span className="text-system-log/40 w-12 shrink-0">重试</span>
                  <span className="text-system-log/60">{tier.max_retries} 次</span>
                </div>
              </div>
              {tier.models.length > 0 && (
                <div className="mt-3 pt-3 border-t border-outline-variant">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-system-log/40">
                        <th className="text-left pb-1 font-medium">模型</th>
                        <th className="text-left pb-1 font-medium">Provider</th>
                        <th className="text-right pb-1 font-medium">Tokens</th>
                      </tr>
                    </thead>
                    <tbody>
                      {tier.models.map((m) => (
                        <tr key={m.id} className="text-system-log/60">
                          <td className="py-0.5 font-mono">{m.id}</td>
                          <td className="py-0.5">{m.provider}</td>
                          <td className="py-0.5 text-right">{m.max_tokens}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </GlassPanel>
          );
        })}
      </div>

      {/* Agent mapping table */}
      <GlassPanel>
        <h3 className="text-sm font-medium text-white mb-3">Agent → Tier 映射</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-system-log/50 border-b border-outline-variant">
                <th className="pb-2 pr-4 font-medium">Agent</th>
                <th className="pb-2 pr-4 font-medium">Task</th>
                <th className="pb-2 pr-4 font-medium">Tier</th>
                <th className="pb-2 font-medium">Model</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(config.agent_mapping).flatMap(([agent, tasks]) =>
                Object.entries(tasks).map(([task, entry]) => (
                  <tr key={`${agent}/${task}`} className="border-b border-system-log/10">
                    <td className="py-2 pr-4 text-system-log/80 font-medium">{agent}</td>
                    <td className="py-2 pr-4 text-system-log/60 font-mono text-xs">{task}</td>
                    <td className="py-2 pr-4">
                      <span className="text-xs font-mono text-primary-container">{entry.tier}</span>
                    </td>
                    <td className="py-2 text-system-log/50 font-mono text-xs">
                      {entry.model || entry.tier === "tier_0" ? entry.model || "none" : "default"}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </GlassPanel>
    </div>
  );
}
