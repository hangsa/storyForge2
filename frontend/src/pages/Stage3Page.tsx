import { useState, useCallback, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import api, { Outline, NovelOutline, ScenePlan } from "../api/client";
import GlassPanel from "../components/shared/GlassPanel";
import NovelOutlinePanel from "../components/stage3/NovelOutlinePanel";

interface Stage3PageProps {
  initialTab?: "novel-outline" | "outline";
}

export default function Stage3Page({ initialTab = "novel-outline" }: Stage3PageProps) {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();

  const [outline, setOutline] = useState<Outline | null>(null);
  const [novelOutline, setNovelOutline] = useState<NovelOutline | null>(null);
  const [loading, setLoading] = useState(false);
  const [advancing, setAdvancing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedScene, setExpandedScene] = useState<string | null>(null);
  const [editingField, setEditingField] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<"novel-outline" | "outline">(initialTab);

  useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab]);

  // Load existing outline on mount
  useEffect(() => {
    if (!projectId) return;
    api.getOutline(projectId)
      .then((data) => { if (data && Object.keys(data).length > 0) setOutline(data); })
      .catch(() => {});
    api.getNovelOutline(projectId)
      .then((data) => {
        if (data && Object.keys(data).length > 0) setNovelOutline(data);
      })
      .catch(() => {});
  }, [projectId]);

  const nextChapterNumber = outline ? outline.chapters.length + 1 : 1;

  const handleGenerate = useCallback(async (chapterNumber?: number) => {
    if (!projectId) return;
    setLoading(true);
    setError(null);
    try {
      const chapterNum = chapterNumber ?? nextChapterNumber;
      const result = await api.generateOutline(projectId, chapterNum);
      setOutline(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : "大纲生成失败");
    } finally {
      setLoading(false);
    }
  }, [projectId, nextChapterNumber]);

  const handleEditStart = (field: string, value: string) => {
    setEditingField(field);
    setEditValue(value || "");
  };

  const handleOutlineEditSave = async () => {
    if (!outline || !editingField || !projectId) return;
    const parts = editingField.split(":");
    const updated = structuredClone(outline);

    if (parts[0] === "chapter" && parts.length === 3) {
      const chapterNum = parseInt(parts[1]);
      const chapter = updated.chapters.find(c => c.chapter_number === chapterNum);
      if (chapter && parts[2] === "title") {
        chapter.title = editValue;
      }
    } else if (parts[0] === "scene" && parts.length === 4) {
      const chapterNum = parseInt(parts[1]);
      const sceneNum = parseInt(parts[2]);
      const field = parts[3] as "goal" | "conflict" | "emotional_arc" | "beat_type";
      const chapter = updated.chapters.find(c => c.chapter_number === chapterNum);
      const scene = chapter?.scene_plan.find(s => s.scene_number === sceneNum);
      if (scene) {
        scene[field] = editValue;
      }
    }

    setOutline(updated);
    setEditingField(null);
    setSaving(true);
    try {
      await api.updateOutline(projectId, updated);
    } finally {
      setSaving(false);
    }
  };

  const handleAdvance = async () => {
    if (!projectId) return;
    setAdvancing(true);
    setError(null);
    try {
      await api.advance(projectId, "STAGE4");
      navigate(`/project/${projectId}/stage4`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "阶段推进失败");
    } finally {
      setAdvancing(false);
    }
  };

  if (!projectId) return null;

  const hasNovelOutline =
    novelOutline !== null &&
    (novelOutline.core_conflict_theme.length > 0 || novelOutline.volumes.length > 0);
  const canAdvance = outline && outline.chapters.length > 0 && hasNovelOutline;

  const narrativeRoleLabels: Record<ScenePlan["narrative_role"], string> = {
    setup: "铺垫",
    mini_payoff: "小高潮",
    cliffhanger: "悬念",
    major_reveal: "重大揭示",
  };

  const narrativeRoleColors: Record<ScenePlan["narrative_role"], string> = {
    setup: "bg-blue-500/20 text-blue-300",
    mini_payoff: "bg-amber-500/20 text-amber-300",
    cliffhanger: "bg-red-500/20 text-red-300",
    major_reveal: "bg-purple-500/20 text-purple-300",
  };

  return (
    <div className="space-y-4">
      {canAdvance && (
        <div className="flex justify-end">
          <button
            onClick={handleAdvance}
            disabled={advancing}
            className="px-5 py-2.5 bg-tertiary-container text-surface-container-low font-body-ui
                       rounded-lg hover:opacity-90 transition-opacity disabled:opacity-40"
          >
            {advancing ? "推进中..." : "进入写作中心 →"}
          </button>
        </div>
      )}

      {error && (
        <div className="p-4 bg-error-container/20 border border-error rounded-lg text-error font-body-ui text-sm">
          {error}
        </div>
      )}

      {activeTab === "novel-outline" && (
        <NovelOutlinePanel
          projectId={projectId}
          data={novelOutline}
          onChange={setNovelOutline}
          onError={(msg) => setError(msg || null)}
        />
      )}

      {activeTab === "outline" && (
        <>
          {!hasNovelOutline && (
            <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded text-amber-300 font-body-ui text-xs">
              建议先生成"全书大纲"以让后续章节与全本骨架保持一致。完成后即可进入写作中心。
            </div>
          )}

          <div className="flex items-center justify-end gap-3">
            {outline && outline.chapters.length > 0 && (
              <span className="font-label-mono text-system-log text-xs">
                已生成 {outline.chapters.length} 章
              </span>
            )}
            <button
              onClick={() => handleGenerate()}
              disabled={loading}
              className="px-5 py-2.5 bg-primary-container text-surface-container-low font-body-ui
                         rounded-lg hover:opacity-90 transition-opacity disabled:opacity-40"
            >
              {loading
                ? `正在生成第${nextChapterNumber}章...`
                : outline
                  ? `生成第${nextChapterNumber}章`
                  : "生成大纲"}
            </button>
          </div>

          {outline && outline.chapters.length > 0 ? (
        <div className="space-y-8">
          {outline.chapters.map((chapter) => (
            <div key={chapter.chapter_number}>
              {/* Chapter header */}
              <div className="flex items-center gap-3 mb-4">
                <div className="w-9 h-9 rounded-full bg-primary-container flex items-center justify-center">
                  <span className="font-label-mono text-sm text-surface-container-low">
                    {chapter.chapter_number}
                  </span>
                </div>
                {editingField === `chapter:${chapter.chapter_number}:title` ? (
                  <div className="flex gap-2 items-center">
                    <input value={editValue} onChange={(e) => setEditValue(e.target.value)}
                      className="flex-1 input-underline text-lg font-display" autoFocus
                      onKeyDown={(e) => e.key === "Enter" && handleOutlineEditSave()} />
                    <button onClick={handleOutlineEditSave} disabled={saving}
                      className="px-3 py-1.5 bg-primary-container text-surface-container-low rounded text-sm">
                      {saving ? "保存中..." : "保存"}
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <h2 className="font-display-md text-primary">{chapter.title || "未命名"}</h2>
                    <button onClick={() => handleEditStart(`chapter:${chapter.chapter_number}:title`, chapter.title)} className="font-body-ui text-xs text-tertiary-container hover:text-primary-container">
                      <span className="material-symbols-outlined text-sm">edit</span>
                    </button>
                  </div>
                )}
                <span className="font-label-mono text-system-log text-xs">
                  {chapter.scene_plan.length} 个场景
                </span>
              </div>

              {/* Scene grid — 3 columns on large screens */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 ml-12">
                {chapter.scene_plan.map((scene) => {
                  const sceneKey = `${chapter.chapter_number}-${scene.scene_number}`;
                  const isExpanded = expandedScene === sceneKey;

                  return (
                    <GlassPanel key={sceneKey}>
                      {/* Scene header */}
                      <button
                        onClick={() => setExpandedScene(isExpanded ? null : sceneKey)}
                        className="w-full text-left"
                      >
                        <div className="flex items-center justify-between mb-2">
                          <span className="font-label-mono text-system-log text-xs">
                            场景 {scene.scene_number}
                          </span>
                          <div className="flex items-center gap-1.5">
                            <span
                              className={`text-xs px-1.5 py-0.5 rounded font-label-mono ${narrativeRoleColors[scene.narrative_role]}`}
                            >
                              {narrativeRoleLabels[scene.narrative_role]}
                            </span>
                            <span className="material-symbols-outlined text-system-log text-sm transition-transform"
                              style={{ transform: isExpanded ? "rotate(180deg)" : "rotate(0deg)" }}>
                              expand_more
                            </span>
                          </div>
                        </div>

                        {/* Beat type */}
                        {editingField === `scene:${chapter.chapter_number}:${scene.scene_number}:beat_type` ? (
                          <div className="flex gap-2 items-center mb-2">
                            <input value={editValue} onChange={(e) => setEditValue(e.target.value)}
                              className="flex-1 input-underline text-xs" autoFocus
                              onKeyDown={(e) => e.key === "Enter" && handleOutlineEditSave()} />
                            <button onClick={handleOutlineEditSave} disabled={saving}
                              className="px-2 py-0.5 bg-primary-container text-surface-container-low rounded text-xs">
                              {saving ? "..." : "保存"}
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2 mb-2">
                            <span className="text-xs px-1.5 py-0.5 bg-surface-container rounded text-system-log font-body-ui">
                              {scene.beat_type || "未设置"}
                            </span>
                            <button onClick={() => handleEditStart(`scene:${chapter.chapter_number}:${scene.scene_number}:beat_type`, scene.beat_type)}
                              className="text-tertiary-container hover:text-primary-container">
                              <span className="material-symbols-outlined text-xs">edit</span>
                            </button>
                          </div>
                        )}

                        {/* Emotional arc */}
                        {editingField === `scene:${chapter.chapter_number}:${scene.scene_number}:emotional_arc` ? (
                          <div className="flex gap-2 items-center mb-2">
                            <input value={editValue} onChange={(e) => setEditValue(e.target.value)}
                              className="flex-1 input-underline text-xs" autoFocus
                              onKeyDown={(e) => e.key === "Enter" && handleOutlineEditSave()} />
                            <button onClick={handleOutlineEditSave} disabled={saving}
                              className="px-2 py-0.5 bg-primary-container text-surface-container-low rounded text-xs">
                              {saving ? "..." : "保存"}
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2 mb-2">
                            <p className="font-body-ui text-system-log text-xs">
                              情绪弧线: {scene.emotional_arc || "未设置"}
                            </p>
                            <button onClick={() => handleEditStart(`scene:${chapter.chapter_number}:${scene.scene_number}:emotional_arc`, scene.emotional_arc)}
                              className="text-tertiary-container hover:text-primary-container">
                              <span className="material-symbols-outlined text-xs">edit</span>
                            </button>
                          </div>
                        )}

                        {/* Goal */}
                        {editingField === `scene:${chapter.chapter_number}:${scene.scene_number}:goal` ? (
                          <div className="flex gap-2 items-center mb-1">
                            <input value={editValue} onChange={(e) => setEditValue(e.target.value)}
                              className="flex-1 input-underline text-sm" autoFocus
                              onKeyDown={(e) => e.key === "Enter" && handleOutlineEditSave()} />
                            <button onClick={handleOutlineEditSave} disabled={saving}
                              className="px-2 py-0.5 bg-primary-container text-surface-container-low rounded text-xs">
                              {saving ? "..." : "保存"}
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-start gap-1 mb-1">
                            <p className="font-body-narrative text-primary text-sm line-clamp-2 flex-1">
                              <span className="font-label-mono text-system-log text-xs">目标: </span>
                              {scene.goal || "未设置"}
                            </p>
                            <button onClick={() => handleEditStart(`scene:${chapter.chapter_number}:${scene.scene_number}:goal`, scene.goal)}
                              className="text-tertiary-container hover:text-primary-container shrink-0">
                              <span className="material-symbols-outlined text-xs">edit</span>
                            </button>
                          </div>
                        )}

                        {/* Conflict */}
                        {editingField === `scene:${chapter.chapter_number}:${scene.scene_number}:conflict` ? (
                          <div className="flex gap-2 items-center">
                            <input value={editValue} onChange={(e) => setEditValue(e.target.value)}
                              className="flex-1 input-underline text-sm" autoFocus
                              onKeyDown={(e) => e.key === "Enter" && handleOutlineEditSave()} />
                            <button onClick={handleOutlineEditSave} disabled={saving}
                              className="px-2 py-0.5 bg-primary-container text-surface-container-low rounded text-xs">
                              {saving ? "..." : "保存"}
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-start gap-1">
                            <p className="font-body-narrative text-primary text-sm line-clamp-2 flex-1">
                              <span className="font-label-mono text-system-log text-xs">冲突: </span>
                              {scene.conflict || "未设置"}
                            </p>
                            <button onClick={() => handleEditStart(`scene:${chapter.chapter_number}:${scene.scene_number}:conflict`, scene.conflict)}
                              className="text-tertiary-container hover:text-primary-container shrink-0">
                              <span className="material-symbols-outlined text-xs">edit</span>
                            </button>
                          </div>
                        )}
                      </button>

                      {/* Expanded details */}
                      {isExpanded && (
                        <div className="mt-4 pt-4 border-t border-outline-variant space-y-3">
                          {/* Required logs */}
                          {scene.required_logs.length > 0 && (
                            <div>
                              <span className="font-label-mono text-system-log text-xs">
                                必需日志标签
                              </span>
                              <div className="flex flex-wrap gap-1 mt-1">
                                {scene.required_logs.map((log, i) => (
                                  <code
                                    key={i}
                                    className="text-xs px-1.5 py-0.5 bg-surface-container rounded font-mono text-system-log"
                                  >
                                    {log}
                                  </code>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* Registry changes — created */}
                          {scene.registry_changes.created.length > 0 && (
                            <div>
                              <span className="font-label-mono text-system-log text-xs">
                                需要创建 ({scene.registry_changes.created.length})
                              </span>
                              <div className="space-y-1.5 mt-1">
                                {scene.registry_changes.created.map((c, i) => (
                                  <div key={i} className="p-2 bg-surface-container rounded text-xs">
                                    <div className="flex items-center gap-1.5 mb-0.5">
                                      <span className="font-label-mono text-system-log">{c.type}</span>
                                      <code className="text-system-log/70">{c.id_pattern}</code>
                                    </div>
                                    <p className="font-body-ui text-system-log">{c.description}</p>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* Registry changes — updated */}
                          {scene.registry_changes.updated.length > 0 && (
                            <div>
                              <span className="font-label-mono text-system-log text-xs">
                                需要更新 ({scene.registry_changes.updated.length})
                              </span>
                              <div className="space-y-1 mt-1">
                                {scene.registry_changes.updated.map((u, i) => (
                                  <div key={i} className="flex items-center gap-2 p-1.5 text-xs">
                                    <code className="text-system-log">{u.asset_id}</code>
                                    <span className="text-system-log/50">.</span>
                                    <span className="text-system-log">{u.field}</span>
                                    <span className="material-symbols-outlined text-xs text-system-log">
                                      arrow_forward
                                    </span>
                                    <span className="text-primary font-body-narrative">{u.new_value}</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </GlassPanel>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-center py-8">
          <span className="material-symbols-outlined text-5xl text-system-log/30 mb-4 block">
            account_tree
          </span>
          <p className="font-body-ui text-system-log">大纲为空，请重新生成</p>
        </div>
      )}

      {!outline && !loading && (
        <div className="text-center py-8">
          <span className="material-symbols-outlined text-5xl text-system-log/30 mb-4 block">
            account_tree
          </span>
          <p className="font-body-ui text-system-log">点击"生成大纲"开始阶段 3</p>
        </div>
      )}
        </>
      )}
    </div>
  );
}
