import { useState, useCallback, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import api, { World, Character } from "../api/client";
import GlassPanel from "../components/shared/GlassPanel";

type Tab = "world" | "character";

export default function Stage2Page() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();

  const [activeTab, setActiveTab] = useState<Tab>("world");
  const [world, setWorld] = useState<World | null>(null);
  const [character, setCharacter] = useState<Character | null>(null);
  const [loadingWorld, setLoadingWorld] = useState(false);
  const [loadingCharacter, setLoadingCharacter] = useState(false);
  const [advancing, setAdvancing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load existing data on mount
  useEffect(() => {
    if (!projectId) return;
    api.getWorld(projectId)
      .then((data) => { if (data && Object.keys(data).length > 0) setWorld(data); })
      .catch(() => {});
    api.getCharacter(projectId)
      .then((data) => { if (data && Object.keys(data).length > 0) setCharacter(data); })
      .catch(() => {});
  }, [projectId]);

  const handleGenerateWorld = useCallback(async () => {
    if (!projectId) return;
    setLoadingWorld(true);
    setError(null);
    try {
      const result = await api.generateWorld(projectId);
      setWorld(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : "世界观生成失败");
    } finally {
      setLoadingWorld(false);
    }
  }, [projectId]);

  const handleGenerateCharacter = useCallback(async () => {
    if (!projectId) return;
    setLoadingCharacter(true);
    setError(null);
    try {
      const result = await api.generateCharacter(projectId);
      setCharacter(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : "角色生成失败");
    } finally {
      setLoadingCharacter(false);
    }
  }, [projectId]);

  const handleAdvance = async () => {
    if (!projectId) return;
    setAdvancing(true);
    setError(null);
    try {
      await api.advance(projectId, "STAGE3");
      navigate(`/project/${projectId}/stage3`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "阶段推进失败");
    } finally {
      setAdvancing(false);
    }
  };

  if (!projectId) return null;

  const canAdvance = world && character;

  const tabs: { key: Tab; label: string; icon: string }[] = [
    { key: "world", label: "世界观", icon: "public" },
    { key: "character", label: "角色设定", icon: "person" },
  ];

  return (
    <div className="max-w-5xl mx-auto py-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display-lg text-primary-container">STAGE 2 — 世界观与角色</h1>
          <p className="font-body-ui text-system-log mt-1">
            构建故事世界的基础规则与核心角色设定
          </p>
        </div>
        {canAdvance && (
          <button
            onClick={handleAdvance}
            disabled={advancing}
            className="px-5 py-2.5 bg-tertiary-container text-surface-container-low font-body-ui
                       rounded-lg hover:opacity-90 transition-opacity disabled:opacity-40"
          >
            {advancing ? "推进中..." : "进入情节头脑风暴 →"}
          </button>
        )}
      </div>

      {error && (
        <div className="p-4 bg-error-container/20 border border-error rounded-lg text-error font-body-ui text-sm">
          {error}
        </div>
      )}

      {/* Tab switcher */}
      <div className="flex gap-1 bg-surface-container rounded-lg p-1 w-fit">
        {tabs.map(({ key, label, icon }) => (
          <button
            key={key}
            onClick={() => setActiveTab(key)}
            className={`flex items-center gap-2 px-4 py-2 rounded-md font-body-ui text-sm transition-colors ${
              activeTab === key
                ? "bg-primary-container text-surface-container-low"
                : "text-system-log hover:text-primary"
            }`}
          >
            <span className="material-symbols-outlined text-lg">{icon}</span>
            {label}
          </button>
        ))}
      </div>

      {/* World Tab */}
      {activeTab === "world" && (
        <div className="space-y-6">
          {!world ? (
            <div className="text-center py-16">
              <span className="material-symbols-outlined text-5xl text-system-log/30 mb-4 block">
                public
              </span>
              <p className="font-body-ui text-system-log mb-4">尚未生成世界观</p>
              <button
                onClick={handleGenerateWorld}
                disabled={loadingWorld}
                className="px-5 py-2.5 bg-primary-container text-surface-container-low font-body-ui
                           rounded-lg hover:opacity-90 transition-opacity disabled:opacity-40"
              >
                {loadingWorld ? "生成中..." : "生成世界观"}
              </button>
            </div>
          ) : (
            <>
              <div className="flex justify-end">
                <button
                  onClick={handleGenerateWorld}
                  disabled={loadingWorld}
                  className="px-4 py-2 text-sm bg-surface-container text-system-log font-body-ui
                             rounded-lg hover:bg-surface-container-low transition-colors disabled:opacity-40"
                >
                  {loadingWorld ? "生成中..." : "重新生成"}
                </button>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Era & Geography */}
                <GlassPanel>
                  <h2 className="font-label-mono text-system-log uppercase tracking-wider mb-4">
                    时代与地理
                  </h2>
                  <div className="space-y-4">
                    <div>
                      <span className="font-label-mono text-system-log text-xs">时代背景</span>
                      <p className="font-body-narrative text-primary text-sm mt-1">{world.era}</p>
                    </div>
                    <div>
                      <span className="font-label-mono text-system-log text-xs">地理环境</span>
                      <p className="font-body-narrative text-primary text-sm mt-1">{world.geography}</p>
                    </div>
                  </div>
                </GlassPanel>

                {/* Power System */}
                <GlassPanel>
                  <h2 className="font-label-mono text-system-log uppercase tracking-wider mb-4">
                    力量体系
                  </h2>
                  <div className="space-y-4">
                    <div>
                      <span className="font-label-mono text-system-log text-xs">体系名称</span>
                      <p className="font-body-narrative text-primary text-sm mt-1">
                        {world.power_system.name}
                      </p>
                    </div>
                    <div>
                      <span className="font-label-mono text-system-log text-xs">描述</span>
                      <p className="font-body-narrative text-primary text-sm mt-1">
                        {world.power_system.description}
                      </p>
                    </div>
                    {world.power_system.stages.length > 0 && (
                      <div>
                        <span className="font-label-mono text-system-log text-xs">阶段划分</span>
                        <div className="flex flex-wrap gap-2 mt-1">
                          {world.power_system.stages.map((s, i) => (
                            <span
                              key={i}
                              className="px-2 py-1 bg-surface-container rounded text-xs font-body-ui text-primary"
                            >
                              {s}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                    {world.power_system.cost_system && (
                      <div>
                        <span className="font-label-mono text-system-log text-xs">代价系统</span>
                        <p className="font-body-narrative text-primary text-sm mt-1">
                          {world.power_system.cost_system}
                        </p>
                      </div>
                    )}
                  </div>
                </GlassPanel>

                {/* Core Rules */}
                <GlassPanel>
                  <h2 className="font-label-mono text-system-log uppercase tracking-wider mb-4">
                    世界规则
                  </h2>
                  <div className="space-y-2">
                    {world.core_rules.map((rule, i) => (
                      <div key={i} className="flex items-start gap-2 p-2 bg-surface-container rounded">
                        <span className="material-symbols-outlined text-sm text-system-log mt-0.5">
                          check_circle
                        </span>
                        <p className="font-body-narrative text-primary text-sm">{rule}</p>
                      </div>
                    ))}
                  </div>
                </GlassPanel>

                {/* Ceilings */}
                <GlassPanel>
                  <h2 className="font-label-mono text-system-log uppercase tracking-wider mb-4">
                    力量上限
                  </h2>
                  <div className="space-y-2">
                    {world.power_system.ceilings.map((c, i) => (
                      <div key={i} className="flex items-start gap-2 p-2 bg-surface-container rounded">
                        <span className="material-symbols-outlined text-sm text-system-log mt-0.5">
                          block
                        </span>
                        <p className="font-body-narrative text-primary text-sm">{c}</p>
                      </div>
                    ))}
                  </div>
                </GlassPanel>

                {/* Factions */}
                {world.factions.length > 0 && (
                  <GlassPanel className="lg:col-span-2">
                    <h2 className="font-label-mono text-system-log uppercase tracking-wider mb-4">
                      势力分布
                    </h2>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {world.factions.map((f, i) => (
                        <div key={i} className="p-3 bg-surface-container rounded">
                          <div className="flex items-center justify-between mb-2">
                            <span className="font-label-mono text-primary text-sm">{f.name}</span>
                            <span className="text-xs px-2 py-0.5 bg-surface-container-low rounded text-system-log font-body-ui">
                              {f.type}
                            </span>
                          </div>
                          <p className="font-body-narrative text-primary text-xs mb-2">{f.goal}</p>
                          <p className="font-body-ui text-system-log text-xs">{f.relations}</p>
                        </div>
                      ))}
                    </div>
                  </GlassPanel>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {/* Character Tab */}
      {activeTab === "character" && (
        <div className="space-y-6">
          {!character ? (
            <div className="text-center py-16">
              <span className="material-symbols-outlined text-5xl text-system-log/30 mb-4 block">
                person
              </span>
              <p className="font-body-ui text-system-log mb-4">尚未生成角色设定</p>
              <button
                onClick={handleGenerateCharacter}
                disabled={loadingCharacter}
                className="px-5 py-2.5 bg-primary-container text-surface-container-low font-body-ui
                           rounded-lg hover:opacity-90 transition-opacity disabled:opacity-40"
              >
                {loadingCharacter ? "生成中..." : "生成角色"}
              </button>
            </div>
          ) : (
            <>
              <div className="flex justify-end">
                <button
                  onClick={handleGenerateCharacter}
                  disabled={loadingCharacter}
                  className="px-4 py-2 text-sm bg-surface-container text-system-log font-body-ui
                             rounded-lg hover:bg-surface-container-low transition-colors disabled:opacity-40"
                >
                  {loadingCharacter ? "生成中..." : "重新生成"}
                </button>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Character Header */}
                <GlassPanel className="lg:col-span-2">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-full bg-primary-container flex items-center justify-center">
                      <span className="material-symbols-outlined text-2xl text-surface-container-low">
                        person
                      </span>
                    </div>
                    <div>
                      <h2 className="font-display-lg text-primary-container">{character.name}</h2>
                      <div className="flex gap-2 mt-1">
                        {character.is_core_character && (
                          <span className="text-xs px-2 py-0.5 bg-primary-container/20 text-primary-container rounded font-label-mono">
                            核心角色
                          </span>
                        )}
                        <span className="text-xs px-2 py-0.5 bg-surface-container text-system-log rounded font-label-mono">
                          ID: {character.id}
                        </span>
                      </div>
                    </div>
                  </div>
                </GlassPanel>

                {/* Personality */}
                <GlassPanel>
                  <h2 className="font-label-mono text-system-log uppercase tracking-wider mb-4">
                    人格层
                  </h2>
                  <div className="space-y-4">
                    {[
                      { key: "core_traits", label: "核心特质", items: character.personality.core_traits },
                      { key: "beliefs", label: "信念", items: character.personality.beliefs },
                      { key: "desires", label: "欲望", items: character.personality.desires },
                      { key: "fears", label: "恐惧", items: character.personality.fears },
                      { key: "values", label: "价值观", items: character.personality.values },
                    ].map(({ key, label, items }) => (
                      <div key={key}>
                        <span className="font-label-mono text-system-log text-xs">{label}</span>
                        <div className="flex flex-wrap gap-1.5 mt-1">
                          {items.map((item, i) => (
                            <span
                              key={i}
                              className="px-2 py-1 bg-surface-container rounded text-xs font-body-narrative text-primary"
                            >
                              {item}
                            </span>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </GlassPanel>

                {/* Current State */}
                <GlassPanel>
                  <h2 className="font-label-mono text-system-log uppercase tracking-wider mb-4">
                    当前状态
                  </h2>
                  <div className="space-y-3">
                    <div className="p-3 bg-surface-container rounded">
                      <span className="font-label-mono text-system-log text-xs">位置</span>
                      <p className="font-body-narrative text-primary text-sm mt-1">
                        {character.current_state.location}
                      </p>
                    </div>
                    <div className="p-3 bg-surface-container rounded">
                      <span className="font-label-mono text-system-log text-xs">身体状况</span>
                      <p className="font-body-narrative text-primary text-sm mt-1">
                        {character.current_state.physical_condition}
                      </p>
                    </div>
                    <div className="p-3 bg-surface-container rounded">
                      <span className="font-label-mono text-system-log text-xs">情绪状态</span>
                      <p className="font-body-narrative text-primary text-sm mt-1">
                        {character.current_state.emotional}
                      </p>
                    </div>
                    {character.current_state.known_secrets.length > 0 && (
                      <div>
                        <span className="font-label-mono text-system-log text-xs">已知秘密</span>
                        <div className="space-y-1 mt-1">
                          {character.current_state.known_secrets.map((s, i) => (
                            <div key={i} className="flex items-center gap-1.5 text-xs text-primary font-body-ui">
                              <span className="material-symbols-outlined text-sm text-system-log">
                                lock_open
                              </span>
                              {s}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </GlassPanel>

                {/* Voice Signature */}
                <GlassPanel>
                  <h2 className="font-label-mono text-system-log uppercase tracking-wider mb-4">
                    声音签名
                  </h2>
                  <div className="space-y-3">
                    <div className="p-3 bg-surface-container rounded">
                      <span className="font-label-mono text-system-log text-xs">语言风格</span>
                      <p className="font-body-narrative text-primary text-sm mt-1">
                        {character.voice_signature.speech_style}
                      </p>
                    </div>
                    <div className="p-3 bg-surface-container rounded">
                      <span className="font-label-mono text-system-log text-xs">思维模式</span>
                      <p className="font-body-narrative text-primary text-sm mt-1">
                        {character.voice_signature.thought_patterns}
                      </p>
                    </div>
                    {character.voice_signature.taboos.length > 0 && (
                      <div>
                        <span className="font-label-mono text-system-log text-xs">行为禁忌</span>
                        <div className="space-y-1 mt-1">
                          {character.voice_signature.taboos.map((t, i) => (
                            <div key={i} className="flex items-center gap-1.5 text-xs text-error font-body-ui">
                              <span className="material-symbols-outlined text-sm">dangerous</span>
                              {t}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </GlassPanel>

                {/* Unknown to Character */}
                <GlassPanel>
                  <h2 className="font-label-mono text-system-log uppercase tracking-wider mb-4">
                    角色未知信息
                  </h2>
                  {character.unknown_to_character.length > 0 ? (
                    <div className="space-y-1">
                      {character.unknown_to_character.map((item, i) => (
                        <div key={i} className="flex items-center gap-1.5 text-xs text-system-log font-body-ui p-2 bg-surface-container rounded">
                          <span className="material-symbols-outlined text-sm">visibility_off</span>
                          {item}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="font-body-ui text-system-log text-sm">无</p>
                  )}
                </GlassPanel>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
