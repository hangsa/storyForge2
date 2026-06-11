import { useState, useCallback } from "react";
import { useParams } from "react-router-dom";
import api, { Concept, StoryDNA } from "../api/client";
import GlassPanel from "../components/shared/GlassPanel";

export default function Stage1Page() {
  const { projectId } = useParams<{ projectId: string }>();

  const [concept, setConcept] = useState<Concept | null>(null);
  const [storyDna, setStoryDna] = useState<StoryDNA | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingField, setEditingField] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");

  const handleGenerate = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    setError(null);
    try {
      const result = await api.generateConcept(projectId);
      setConcept(result.concept);
      setStoryDna(result.story_dna);
    } catch (e) {
      setError(e instanceof Error ? e.message : "概念生成失败");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  const handleEditStart = (field: string, value: string) => {
    setEditingField(field);
    setEditValue(value);
  };

  const handleEditSave = () => {
    if (!concept || !editingField) return;
    setConcept({ ...concept, [editingField]: editValue });
    setEditingField(null);
  };

  if (!projectId) return null;

  return (
    <div className="max-w-5xl mx-auto py-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display-lg text-primary-container">STAGE 1 — 概念讨论</h1>
          <p className="font-body-ui text-system-log mt-1">
            生成故事概念与核心矛盾，构建小说的叙事基础
          </p>
        </div>
        <button
          onClick={handleGenerate}
          disabled={loading}
          className="px-5 py-2.5 bg-primary-container text-surface-container-low font-body-ui
                     rounded-lg hover:opacity-90 transition-opacity disabled:opacity-40"
        >
          {loading ? "生成中..." : concept ? "重新生成" : "生成概念"}
        </button>
      </div>

      {error && (
        <div className="p-4 bg-error-container/20 border border-error rounded-lg text-error font-body-ui text-sm">
          {error}
        </div>
      )}

      {concept && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Concept panel */}
          <GlassPanel>
            <h2 className="font-label-mono text-system-log uppercase tracking-wider mb-4">
              故事概念
            </h2>
            <div className="space-y-4">
              {[
                { key: "title", label: "标题", value: concept.title },
                { key: "genre", label: "类型", value: concept.genre },
                { key: "premise", label: "前提", value: concept.premise },
                { key: "tone", label: "基调", value: concept.tone },
                { key: "theme", label: "主题", value: concept.theme },
                { key: "target_audience", label: "目标读者", value: concept.target_audience },
              ].map(({ key, label, value }) => (
                <div key={key}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-label-mono text-system-log text-xs">{label}</span>
                    <button
                      onClick={() => handleEditStart(key, value)}
                      className="font-body-ui text-xs text-tertiary-container hover:text-primary-container"
                    >
                      <span className="material-symbols-outlined text-sm">edit</span>
                    </button>
                  </div>
                  {editingField === key ? (
                    <div className="flex gap-2">
                      <input
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        className="flex-1 input-underline text-sm"
                        autoFocus
                        onKeyDown={(e) => e.key === "Enter" && handleEditSave()}
                      />
                      <button
                        onClick={handleEditSave}
                        className="px-3 py-1.5 bg-primary-container text-surface-container-low rounded text-sm"
                      >
                        保存
                      </button>
                    </div>
                  ) : (
                    <p className="font-body-narrative text-primary text-sm">
                      {value || <span className="text-system-log/40">待填写</span>}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </GlassPanel>

          {/* Story DNA panel */}
          <GlassPanel>
            <h2 className="font-label-mono text-system-log uppercase tracking-wider mb-4">
              Story DNA
            </h2>
            {storyDna && (
              <div className="space-y-5">
                <div>
                  <h3 className="font-label-mono text-system-log text-xs mb-2">核心矛盾</h3>
                  <p className="font-body-narrative text-primary text-sm leading-relaxed">
                    {storyDna.core_contradiction.statement}
                  </p>
                  <div className="flex gap-4 mt-2">
                    <div className="flex-1 p-3 bg-surface-container rounded">
                      <span className="font-label-mono text-system-log text-xs">立场 A</span>
                      <p className="font-body-ui text-primary text-sm mt-1">
                        {storyDna.core_contradiction.side_a}
                      </p>
                    </div>
                    <div className="flex-1 p-3 bg-surface-container rounded">
                      <span className="font-label-mono text-system-log text-xs">立场 B</span>
                      <p className="font-body-ui text-primary text-sm mt-1">
                        {storyDna.core_contradiction.side_b}
                      </p>
                    </div>
                  </div>
                </div>

                <div>
                  <h3 className="font-label-mono text-system-log text-xs mb-2">价值层级</h3>
                  <div className="space-y-2">
                    {storyDna.value_stack?.map((v, i) => (
                      <div key={i} className="flex items-center gap-2 p-2 bg-surface-container rounded">
                        <span className="font-label-mono text-system-log text-xs">{v.value_a}</span>
                        <span className="text-system-log">vs</span>
                        <span className="font-label-mono text-system-log text-xs">{v.value_b}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </GlassPanel>
        </div>
      )}

      {!concept && !loading && (
        <div className="text-center py-16">
          <span className="material-symbols-outlined text-5xl text-system-log/30 mb-4 block">
            lightbulb
          </span>
          <p className="font-body-ui text-system-log">点击"生成概念"开始阶段 1</p>
        </div>
      )}
    </div>
  );
}
