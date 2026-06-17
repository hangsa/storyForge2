import { useState, useEffect, useCallback } from "react";
import { useParams } from "react-router-dom";
import api, { RegistryAsset } from "../api/client";
import GlassPanel from "../components/shared/GlassPanel";
import RegistryCard from "../components/storyos/RegistryCard";

const TABS: Array<{ key: string; label: string; icon: string }> = [
  { key: "conflict", label: "冲突", icon: "bolt" },
  { key: "mystery", label: "谜团", icon: "help" },
  { key: "twist", label: "转折", icon: "autorenew" },
  { key: "goal", label: "目标", icon: "flag" },
];

export default function StoryOSPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const [activeTab, setActiveTab] = useState("conflict");
  const [data, setData] = useState<RegistryAsset[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const loadRegistry = useCallback(async (type: string) => {
    if (!projectId) return;
    setLoading(true);
    setError("");
    try {
      const result = await api.getRegistry(projectId, type);
      setData(Array.isArray(result?.items) ? result.items : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载注册表数据失败");
      setData([]);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    loadRegistry(activeTab);
  }, [activeTab, loadRegistry]);

  if (!projectId) return null;

  return (
    <div className="max-w-6xl mx-auto py-8 space-y-6">
      <div>
        <h1 className="text-4xl font-bold text-primary-container">叙事资产注册中心</h1>
        <p className="font-body-ui text-system-log mt-1">
          StoryOS 注册表：查看冲突、谜团、转折与目标资产的实时状态
        </p>
      </div>

      {error && (
        <div className="p-4 bg-error-container/20 border border-error rounded-lg text-error font-body-ui text-sm">
          {error}
        </div>
      )}

      {/* Tab bar */}
      <div className="flex gap-2 p-1.5 bg-surface-container rounded-lg w-fit">
        {TABS.map(({ key, label, icon }) => (
          <button
            key={key}
            onClick={() => setActiveTab(key)}
            className={`flex items-center gap-2 px-4 py-2 rounded-md font-body-ui text-sm transition-colors ${
              activeTab === key
                ? "bg-primary-container text-surface-container-low"
                : "text-system-log hover:text-primary hover:bg-surface-container-low"
            }`}
          >
            <span className="material-symbols-outlined text-lg">{icon}</span>
            {label}
          </button>
        ))}
      </div>

      {/* Content */}
      <GlassPanel>
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <span className="material-symbols-outlined text-3xl text-system-log/30 animate-spin">
              progress_activity
            </span>
          </div>
        ) : data.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-system-log/40">
            <span className="material-symbols-outlined text-5xl mb-3">
              {TABS.find((t) => t.key === activeTab)?.icon || "inventory"}
            </span>
            <p className="text-sm">暂无{TABS.find((t) => t.key === activeTab)?.label}资产</p>
            <p className="text-xs mt-1">完成场景写作后，系统将自动创建叙事资产</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {data.map((asset) => (
              <RegistryCard
                key={asset.id}
                asset={asset}
                registryType={activeTab}
              />
            ))}
          </div>
        )}
      </GlassPanel>
    </div>
  );
}
