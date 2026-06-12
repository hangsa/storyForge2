import { useState, useCallback, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import api, { World, Character, CharacterSet } from "../api/client";
import GlassPanel from "../components/shared/GlassPanel";

type Tab = "world" | "character";

const CHARACTER_TYPES: { value: string; label: string; icon: string }[] = [
  { value: "protagonist", label: "主角", icon: "star" },
  { value: "antagonist", label: "反派", icon: "bolt" },
  { value: "supporting", label: "配角", icon: "group" },
  { value: "mentor", label: "导师", icon: "school" },
];

const TYPE_STYLES: Record<string, string> = {
  protagonist: "bg-primary-container/20 text-primary-container border-primary-container/30",
  antagonist: "bg-error/10 text-error border-error/30",
  supporting: "bg-tertiary-container/20 text-tertiary-container border-tertiary-container/30",
  mentor: "bg-surface-container-low text-system-log border-system-log/30",
};

function CharacterDetail({ character }: { character: Character }) {
  const safe = {
    ...character,
    personality: {
      core_traits: [] as string[],
      beliefs: [] as string[],
      desires: [] as string[],
      fears: [] as string[],
      values: [] as string[],
      ...(character.personality || {}),
    },
    current_state: {
      location: "",
      physical_condition: "normal",
      emotional: "neutral",
      known_secrets: [] as string[],
      ...(character.current_state || {}),
    },
    voice_signature: {
      speech_style: "",
      thought_patterns: "",
      taboos: [] as string[],
      ...(character.voice_signature || {}),
    },
    unknown_to_character: character.unknown_to_character || [],
    relations: character.relations || {},
  };

  return (
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
            <h2 className="font-display-lg text-primary-container">{safe.name}</h2>
            <div className="flex gap-2 mt-1">
              {safe.is_core_character && (
                <span className="text-xs px-2 py-0.5 bg-primary-container/20 text-primary-container rounded font-label-mono">
                  核心角色
                </span>
              )}
              <span className={`text-xs px-2 py-0.5 rounded font-label-mono border ${TYPE_STYLES[safe.character_type] || TYPE_STYLES.protagonist}`}>
                {CHARACTER_TYPES.find(t => t.value === safe.character_type)?.label || safe.character_type}
              </span>
              <span className="text-xs px-2 py-0.5 bg-surface-container text-system-log rounded font-label-mono">
                ID: {safe.id}
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
            { key: "core_traits", label: "核心特质", items: safe.personality.core_traits },
            { key: "beliefs", label: "信念", items: safe.personality.beliefs },
            { key: "desires", label: "欲望", items: safe.personality.desires },
            { key: "fears", label: "恐惧", items: safe.personality.fears },
            { key: "values", label: "价值观", items: safe.personality.values },
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
              {safe.current_state.location}
            </p>
          </div>
          <div className="p-3 bg-surface-container rounded">
            <span className="font-label-mono text-system-log text-xs">身体状况</span>
            <p className="font-body-narrative text-primary text-sm mt-1">
              {safe.current_state.physical_condition}
            </p>
          </div>
          <div className="p-3 bg-surface-container rounded">
            <span className="font-label-mono text-system-log text-xs">情绪状态</span>
            <p className="font-body-narrative text-primary text-sm mt-1">
              {safe.current_state.emotional}
            </p>
          </div>
          {safe.current_state.known_secrets.length > 0 && (
            <div>
              <span className="font-label-mono text-system-log text-xs">已知秘密</span>
              <div className="space-y-1 mt-1">
                {safe.current_state.known_secrets.map((s, i) => (
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
              {safe.voice_signature.speech_style}
            </p>
          </div>
          <div className="p-3 bg-surface-container rounded">
            <span className="font-label-mono text-system-log text-xs">思维模式</span>
            <p className="font-body-narrative text-primary text-sm mt-1">
              {safe.voice_signature.thought_patterns}
            </p>
          </div>
          {safe.voice_signature.taboos.length > 0 && (
            <div>
              <span className="font-label-mono text-system-log text-xs">行为禁忌</span>
              <div className="space-y-1 mt-1">
                {safe.voice_signature.taboos.map((t, i) => (
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
        {safe.unknown_to_character.length > 0 ? (
          <div className="space-y-1">
            {safe.unknown_to_character.map((item, i) => (
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

      {/* Relations */}
      {Object.keys(safe.relations).length > 0 && (
        <GlassPanel className="lg:col-span-2">
          <h2 className="font-label-mono text-system-log uppercase tracking-wider mb-4">
            角色关系
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {Object.entries(safe.relations).map(([targetId, rel]) => (
              <div key={targetId} className="p-3 bg-surface-container rounded flex items-center justify-between">
                <div>
                  <span className="font-label-mono text-primary text-sm">{targetId}</span>
                  <p className="font-body-ui text-system-log text-xs mt-0.5">
                    最后更新: 第{rel.last_update_chapter}章
                  </p>
                </div>
                <span className={`text-xs px-2 py-1 rounded font-body-ui ${
                  rel.status === "ally" ? "bg-primary-container/20 text-primary-container" :
                  rel.status === "enemy" ? "bg-error/10 text-error" :
                  "bg-surface-container-low text-system-log"
                }`}>
                  {rel.status}
                </span>
              </div>
            ))}
          </div>
        </GlassPanel>
      )}
    </div>
  );
}

export default function Stage2Page() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();

  const [activeTab, setActiveTab] = useState<Tab>("world");
  const [world, setWorld] = useState<World | null>(null);
  const [characters, setCharacters] = useState<Character[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [loadingWorld, setLoadingWorld] = useState(false);
  const [loadingCharacter, setLoadingCharacter] = useState(false);
  const [generatingType, setGeneratingType] = useState("");
  const [advancing, setAdvancing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load existing data on mount
  useEffect(() => {
    if (!projectId) return;
    api.getWorld(projectId)
      .then((data) => { if (data && Object.keys(data).length > 0) setWorld(data); })
      .catch(() => {});
    loadCharacters();
  }, [projectId]);

  const loadCharacters = useCallback(async () => {
    if (!projectId) return;
    try {
      const data = await api.getCharacter(projectId);
      if (data && data.characters && data.characters.length > 0) {
        setCharacters(data.characters);
        const curIdx = data.characters.findIndex(c => c.id === data.current?.id);
        setSelectedIndex(curIdx >= 0 ? curIdx : 0);
      }
    } catch { /* no existing characters yet */ }
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

  const handleGenerateCharacter = useCallback(async (characterType: string) => {
    if (!projectId) return;
    setLoadingCharacter(true);
    setGeneratingType(characterType);
    setError(null);
    try {
      const result = await api.generateCharacter(projectId, characterType);
      if (result && result.characters) {
        setCharacters(result.characters);
        setSelectedIndex(result.characters.length - 1);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "角色生成失败");
    } finally {
      setLoadingCharacter(false);
      setGeneratingType("");
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

  const canAdvance = world && characters.length > 0;
  const selectedCharacter = characters[selectedIndex];

  const tabs: { key: Tab; label: string; icon: string }[] = [
    { key: "world", label: "世界观", icon: "public" },
    { key: "character", label: "角色设定", icon: "person" },
  ];

  return (
    <div className="max-w-5xl mx-auto py-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-4xl font-bold text-primary-container">世界观与角色</h1>
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
          {characters.length === 0 ? (
            <div className="text-center py-16">
              <span className="material-symbols-outlined text-5xl text-system-log/30 mb-4 block">
                person
              </span>
              <p className="font-body-ui text-system-log mb-6">尚未生成角色设定</p>
              <div className="flex flex-wrap justify-center gap-3">
                {CHARACTER_TYPES.map(({ value, label, icon }) => (
                  <button
                    key={value}
                    onClick={() => handleGenerateCharacter(value)}
                    disabled={loadingCharacter}
                    className="flex items-center gap-2 px-4 py-2.5 bg-surface-container text-primary font-body-ui
                               rounded-lg hover:bg-surface-container-low transition-colors disabled:opacity-40 border border-surface-container-low"
                  >
                    <span className="material-symbols-outlined text-lg">{icon}</span>
                    {loadingCharacter && generatingType === value ? "生成中..." : `生成${label}`}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <>
              {/* Character card list + add button */}
              <div className="flex items-start gap-3 flex-wrap">
                {characters.map((char, idx) => (
                  <button
                    key={char.id}
                    onClick={() => setSelectedIndex(idx)}
                    className={`flex items-center gap-3 px-4 py-3 rounded-lg border transition-colors text-left ${
                      idx === selectedIndex
                        ? "bg-primary-container/20 border-primary-container"
                        : "bg-surface-container border-surface-container-low hover:bg-surface-container-low"
                    }`}
                  >
                    <div className="w-9 h-9 rounded-full bg-primary-container flex items-center justify-center shrink-0">
                      <span className="material-symbols-outlined text-lg text-surface-container-low">
                        person
                      </span>
                    </div>
                    <div>
                      <span className={`font-label-mono text-sm ${
                        idx === selectedIndex ? "text-primary-container" : "text-primary"
                      }`}>
                        {char.name}
                      </span>
                      <div className="flex gap-1.5 mt-0.5">
                        <span className={`text-[10px] px-1.5 py-0.5 rounded border font-body-ui ${
                          TYPE_STYLES[char.character_type] || TYPE_STYLES.protagonist
                        }`}>
                          {CHARACTER_TYPES.find(t => t.value === char.character_type)?.label || char.character_type}
                        </span>
                      </div>
                    </div>
                  </button>
                ))}

                {/* Add character dropdown */}
                <div className="relative group">
                  <button
                    disabled={loadingCharacter}
                    className="flex items-center gap-2 px-4 py-3 rounded-lg border-2 border-dashed
                               border-system-log/30 text-system-log font-body-ui text-sm
                               hover:border-primary-container/50 hover:text-primary-container transition-colors
                               disabled:opacity-40 h-full min-h-[64px]"
                  >
                    <span className="material-symbols-outlined">add</span>
                    添加角色
                  </button>
                  <div className="absolute top-full left-0 mt-1 bg-surface-container-low border border-surface-container
                                  rounded-lg p-1.5 hidden group-hover:block z-10 shadow-lg min-w-[140px]">
                    {CHARACTER_TYPES.map(({ value, label, icon }) => (
                      <button
                        key={value}
                        onClick={() => handleGenerateCharacter(value)}
                        disabled={loadingCharacter}
                        className="flex items-center gap-2 w-full px-3 py-2 rounded text-sm font-body-ui
                                   text-primary hover:bg-surface-container transition-colors disabled:opacity-40"
                      >
                        <span className="material-symbols-outlined text-base">{icon}</span>
                        {loadingCharacter && generatingType === value ? "生成中..." : label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Selected character detail */}
              {selectedCharacter && <CharacterDetail character={selectedCharacter} />}
            </>
          )}
        </div>
      )}
    </div>
  );
}
