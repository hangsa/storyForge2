import { useState, useCallback, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import api, { World, Character, CharacterSet, GrowthEventType } from "../api/client";
import GlassPanel from "../components/shared/GlassPanel";
import { setNestedValue } from "../utils/nested";
import TagEditor from "../components/shared/TagEditor";
import GrowthWorkshop from "../components/stage2/GrowthWorkshop";

type Tab = "world" | "character" | "workshop";

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

const GROWTH_EVENT_LABELS: Record<string, string> = {
  betrayal_experienced: "经历背叛",
  death_of_loved_one: "至亲离世",
  world_truth_revealed: "世界真相揭露",
  personal_identity_crisis: "身份认同危机",
  irreversible_loss: "不可逆的失去",
  moral_awakening: "道德觉醒",
  accumulated_evidence: "证据积累",
  relationship_transformation: "关系转变",
};

const GROWTH_EVENT_STYLES: Record<string, string> = {
  betrayal_experienced: "bg-error/10 text-error border-error/30",
  death_of_loved_one: "bg-surface-container-low text-system-log border-outline-variant",
  world_truth_revealed: "bg-primary-container/20 text-primary-container border-primary-container/30",
  personal_identity_crisis: "bg-warning/10 text-warning-p1 border-warning-p1/30",
  irreversible_loss: "bg-error-container/20 text-on-error-container border-error-container/30",
  moral_awakening: "bg-tertiary-container/20 text-tertiary-container border-tertiary-container/30",
  accumulated_evidence: "bg-primary-container/10 text-primary border-primary/30",
  relationship_transformation: "bg-secondary-container/20 text-secondary-container border-secondary-container/30",
};

function CharacterDetail({ character, onCharacterUpdate, saving }: {
  character: Character;
  onCharacterUpdate: (updated: Character) => void;
  saving: boolean;
}) {
  const [charEditingField, setCharEditingField] = useState<string | null>(null);
  const [charEditValue, setCharEditValue] = useState("");
  const [stageEditKey, setStageEditKey] = useState<string | null>(null);
  const [stageEditValue, setStageEditValue] = useState("");

  const handleCharEditStart = (field: string, value: string) => {
    setCharEditingField(field);
    setCharEditValue(value || "");
  };

  const handleCharEditSave = () => {
    if (!charEditingField) return;
    const updated = setNestedValue(character, charEditingField, charEditValue) as Character;
    setCharEditingField(null);
    onCharacterUpdate(updated);
  };

  const handleStageEditStart = (index: number, field: string, value: string) => {
    setStageEditKey(`${index}:${field}`);
    setStageEditValue(value || "");
  };

  const handleStageEditSave = () => {
    if (!stageEditKey) return;
    if (stageEditKey === "curve_desc") {
      const updated = structuredClone(character) as Character;
      if (!updated.growth_curve) updated.growth_curve = { curve_description: "", stages: [] };
      updated.growth_curve.curve_description = stageEditValue;
      setStageEditKey(null);
      onCharacterUpdate(updated);
      return;
    }
    const [indexStr, field] = stageEditKey.split(":");
    const index = parseInt(indexStr);
    const updated = structuredClone(character) as Character;
    if (!updated.growth_curve) return;
    (updated.growth_curve.stages[index] as unknown as Record<string, unknown>)[field] = stageEditValue;
    setStageEditKey(null);
    onCharacterUpdate(updated);
  };

  const handleAddStage = () => {
    const updated = structuredClone(character) as Character;
    if (!updated.growth_curve) updated.growth_curve = { curve_description: "", stages: [] };
    const nextNum = updated.growth_curve.stages.length + 1;
    updated.growth_curve.stages.push({
      stage_number: nextNum,
      stage_name: `阶段 ${nextNum}`,
      trigger_event_type: "accumulated_evidence" as GrowthEventType,
      trigger_event_description: "",
      character_change: "",
      target_chapter_range: "",
      bound_chapter: null,
    });
    onCharacterUpdate(updated);
  };

  const handleRemoveStage = (index: number) => {
    setStageEditKey(null);
    const updated = structuredClone(character) as Character;
    if (!updated.growth_curve) return;
    updated.growth_curve.stages = updated.growth_curve.stages
      .filter((_, i) => i !== index)
      .map((s, i) => ({ ...s, stage_number: i + 1 }));
    onCharacterUpdate(updated);
  };

  const personality = Object.assign(
    { core_traits: [] as string[], beliefs: [] as string[], desires: [] as string[], fears: [] as string[], values: [] as string[] },
    character.personality,
  );
  const currentState = Object.assign(
    { location: "", physical_condition: "normal", emotional: "neutral", known_secrets: [] as string[] },
    character.current_state,
  );
  const voiceSignature = Object.assign(
    { speech_style: "", thought_patterns: "", taboos: [] as string[] },
    character.voice_signature,
  );

  const safe = {
    ...character,
    personality,
    current_state: currentState,
    voice_signature: voiceSignature,
    unknown_to_character: character.unknown_to_character || [],
    relations: character.relations || {},
    growth_curve: character.growth_curve || null,
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
            {charEditingField === "name" ? (
              <div className="flex gap-2 items-center">
                <input value={charEditValue} onChange={(e) => setCharEditValue(e.target.value)}
                  className="flex-1 input-underline text-xl font-display" autoFocus
                  onKeyDown={(e) => e.key === "Enter" && handleCharEditSave()} />
                <button onClick={handleCharEditSave} disabled={saving}
                  className="px-3 py-1.5 bg-primary-container text-surface-container-low rounded text-sm">
                  {saving ? "保存中..." : "保存"}
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <h2 className="font-display-lg text-primary-container">{safe.name || "未命名"}</h2>
                <button onClick={() => handleCharEditStart("name", safe.name)} className="font-body-ui text-xs text-tertiary-container hover:text-primary-container">
                  <span className="material-symbols-outlined text-sm">edit</span>
                </button>
              </div>
            )}
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
          {[
            { field: "current_state.location", label: "位置", value: safe.current_state.location },
            { field: "current_state.physical_condition", label: "身体状况", value: safe.current_state.physical_condition },
            { field: "current_state.emotional", label: "情绪状态", value: safe.current_state.emotional },
          ].map(({ field, label, value }) => (
            <div key={field} className="p-3 bg-surface-container rounded">
              <div className="flex items-center justify-between">
                <span className="font-label-mono text-system-log text-xs">{label}</span>
                <button onClick={() => handleCharEditStart(field, value)} className="font-body-ui text-xs text-tertiary-container hover:text-primary-container">
                  <span className="material-symbols-outlined text-sm">edit</span>
                </button>
              </div>
              {charEditingField === field ? (
                <div className="flex gap-2 mt-1">
                  <input value={charEditValue} onChange={(e) => setCharEditValue(e.target.value)}
                    className="flex-1 input-underline text-sm" autoFocus
                    onKeyDown={(e) => e.key === "Enter" && handleCharEditSave()} />
                  <button onClick={handleCharEditSave} disabled={saving}
                    className="px-3 py-1.5 bg-primary-container text-surface-container-low rounded text-sm">
                    {saving ? "保存中..." : "保存"}
                  </button>
                </div>
              ) : (
                <p className="font-body-narrative text-primary text-sm mt-1">{value || <span className="text-system-log/40">待填写</span>}</p>
              )}
            </div>
          ))}
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
          {[
            { field: "voice_signature.speech_style", label: "语言风格", value: safe.voice_signature.speech_style },
            { field: "voice_signature.thought_patterns", label: "思维模式", value: safe.voice_signature.thought_patterns },
          ].map(({ field, label, value }) => (
            <div key={field} className="p-3 bg-surface-container rounded">
              <div className="flex items-center justify-between">
                <span className="font-label-mono text-system-log text-xs">{label}</span>
                <button onClick={() => handleCharEditStart(field, value)} className="font-body-ui text-xs text-tertiary-container hover:text-primary-container">
                  <span className="material-symbols-outlined text-sm">edit</span>
                </button>
              </div>
              {charEditingField === field ? (
                <div className="flex gap-2 mt-1">
                  <input value={charEditValue} onChange={(e) => setCharEditValue(e.target.value)}
                    className="flex-1 input-underline text-sm" autoFocus
                    onKeyDown={(e) => e.key === "Enter" && handleCharEditSave()} />
                  <button onClick={handleCharEditSave} disabled={saving}
                    className="px-3 py-1.5 bg-primary-container text-surface-container-low rounded text-sm">
                    {saving ? "保存中..." : "保存"}
                  </button>
                </div>
              ) : (
                <p className="font-body-narrative text-primary text-sm mt-1">{value || <span className="text-system-log/40">待填写</span>}</p>
              )}
            </div>
          ))}
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

      {/* Growth Curve */}
      <GlassPanel className="lg:col-span-2">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-label-mono text-system-log uppercase tracking-wider">
            成长曲线
          </h2>
          <button
            onClick={handleAddStage}
            disabled={saving}
            className="flex items-center gap-1 px-3 py-1.5 text-xs border border-dashed
                       border-system-log/30 rounded text-system-log/50
                       hover:text-primary-container hover:border-primary-container/50
                       transition-colors disabled:opacity-30"
          >
            <span className="material-symbols-outlined text-sm">add</span>
            添加阶段
          </button>
        </div>

        {/* Curve description */}
        {stageEditKey === "curve_desc" ? (
          <div className="mb-6 space-y-2">
            <textarea
              value={stageEditValue}
              onChange={(e) => setStageEditValue(e.target.value)}
              className="w-full bg-surface-container-low border border-outline-variant rounded-lg p-3
                         font-body-narrative text-primary text-sm leading-relaxed resize-y
                         focus:outline-none focus:border-primary-container"
              rows={3}
              autoFocus
            />
            <div className="flex gap-2">
              <button onClick={handleStageEditSave} disabled={saving}
                className="px-3 py-1.5 bg-primary-container text-surface-container-low rounded text-sm">
                {saving ? "保存中..." : "保存"}
              </button>
              <button onClick={() => setStageEditKey(null)}
                className="px-3 py-1.5 bg-surface-container text-system-log rounded text-sm">
                取消
              </button>
            </div>
          </div>
        ) : (
          <div className="p-4 bg-surface-container rounded-lg mb-6 border-l-2 border-primary-container">
            <div className="flex items-start justify-between gap-2">
              <p className="font-body-narrative text-primary text-sm leading-relaxed flex-1">
                {safe.growth_curve?.curve_description || <span className="text-system-log/40">曲线描述</span>}
              </p>
              <button
                onClick={() => {
                  setStageEditKey("curve_desc");
                  setStageEditValue(safe.growth_curve?.curve_description || "");
                }}
                className="font-body-ui text-xs text-tertiary-container hover:text-primary-container shrink-0"
              >
                <span className="material-symbols-outlined text-sm">edit</span>
              </button>
            </div>
          </div>
        )}

        {/* Stages timeline */}
        {safe.growth_curve && safe.growth_curve.stages && safe.growth_curve.stages.length > 0 ? (
          <div className="relative">
            {safe.growth_curve.stages.map((stage, i) => {
              const isEditing = stageEditKey !== null && stageEditKey.startsWith(`${i}:`);
              const editField = isEditing ? stageEditKey!.split(":")[1] : null;
              return (
                <div key={i} className="flex gap-4 pb-6 last:pb-0">
                  <div className="flex flex-col items-center shrink-0">
                    <div className="w-8 h-8 rounded-full bg-primary-container flex items-center justify-center font-label-mono text-sm text-surface-container-low shrink-0">
                      {stage.stage_number}
                    </div>
                    {i < safe.growth_curve!.stages.length - 1 && (
                      <div className="w-px flex-1 bg-outline-variant mt-1 min-h-[20px]" />
                    )}
                  </div>

                  <div className="flex-1 min-w-0 pb-1">
                    <div className="flex items-center gap-2 mb-2 flex-wrap">
                      {/* Stage name */}
                      {editField === "stage_name" ? (
                        <div className="flex gap-2 items-center">
                          <input value={stageEditValue} onChange={(e) => setStageEditValue(e.target.value)}
                            className="w-32 input-underline text-sm" autoFocus
                            onKeyDown={(e) => e.key === "Enter" && handleStageEditSave()} />
                          <button onClick={handleStageEditSave} disabled={saving}
                            className="px-2 py-0.5 bg-primary-container text-surface-container-low rounded text-xs">
                            {saving ? "..." : "保存"}
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1">
                          <h3 className="font-label-mono text-primary-container text-sm">
                            {stage.stage_name}
                          </h3>
                          <button onClick={() => handleStageEditStart(i, "stage_name", stage.stage_name)}
                            className="text-tertiary-container hover:text-primary-container">
                            <span className="material-symbols-outlined text-xs">edit</span>
                          </button>
                        </div>
                      )}

                      {/* Trigger event type */}
                      {editField === "trigger_event_type" ? (
                        <div className="flex gap-2 items-center">
                          <select
                            value={stageEditValue}
                            onChange={(e) => setStageEditValue(e.target.value)}
                            className="bg-surface-container-low border border-outline-variant rounded px-2 py-1
                                       text-xs font-label-mono text-primary focus:outline-none focus:border-primary-container"
                            autoFocus
                          >
                            {Object.entries(GROWTH_EVENT_LABELS).map(([val, label]) => (
                              <option key={val} value={val}>{label}</option>
                            ))}
                          </select>
                          <button onClick={handleStageEditSave} disabled={saving}
                            className="px-2 py-0.5 bg-primary-container text-surface-container-low rounded text-xs">
                            {saving ? "..." : "保存"}
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1">
                          <span className={`text-xs px-2 py-0.5 rounded font-label-mono border ${GROWTH_EVENT_STYLES[stage.trigger_event_type] || "bg-surface-container text-system-log border-surface-container-low"}`}>
                            {GROWTH_EVENT_LABELS[stage.trigger_event_type] || stage.trigger_event_type}
                          </span>
                          <button onClick={() => handleStageEditStart(i, "trigger_event_type", stage.trigger_event_type)}
                            className="text-tertiary-container hover:text-primary-container">
                            <span className="material-symbols-outlined text-xs">edit</span>
                          </button>
                        </div>
                      )}

                      {/* Remove stage */}
                      <button
                        onClick={() => handleRemoveStage(i)}
                        disabled={saving}
                        className="ml-auto text-system-log/30 hover:text-error transition-colors disabled:opacity-30"
                      >
                        <span className="material-symbols-outlined text-sm">close</span>
                      </button>
                    </div>

                    {/* Trigger event description */}
                    <div className="mb-2">
                      <div className="flex items-center justify-between">
                        <span className="font-label-mono text-system-log text-xs">触发事件</span>
                        {!isEditing && (
                          <button onClick={() => handleStageEditStart(i, "trigger_event_description", stage.trigger_event_description)}
                            className="font-body-ui text-xs text-tertiary-container hover:text-primary-container">
                            <span className="material-symbols-outlined text-xs">edit</span>
                          </button>
                        )}
                      </div>
                      {editField === "trigger_event_description" ? (
                        <div className="space-y-2 mt-1">
                          <textarea value={stageEditValue} onChange={(e) => setStageEditValue(e.target.value)}
                            className="w-full bg-surface-container-low border border-outline-variant rounded p-2
                                       font-body-narrative text-primary text-sm leading-relaxed resize-y
                                       focus:outline-none focus:border-primary-container"
                            rows={2} autoFocus />
                          <div className="flex gap-2">
                            <button onClick={handleStageEditSave} disabled={saving}
                              className="px-2 py-0.5 bg-primary-container text-surface-container-low rounded text-xs">
                              {saving ? "..." : "保存"}
                            </button>
                            <button onClick={() => setStageEditKey(null)}
                              className="px-2 py-0.5 bg-surface-container text-system-log rounded text-xs">取消</button>
                          </div>
                        </div>
                      ) : (
                        <p className="font-body-narrative text-primary text-sm mt-0.5 leading-relaxed">
                          {stage.trigger_event_description || <span className="text-system-log/40">待填写</span>}
                        </p>
                      )}
                    </div>

                    {/* Character change */}
                    <div className="mb-2">
                      <div className="flex items-center justify-between">
                        <span className="font-label-mono text-system-log text-xs">角色转变</span>
                        {!isEditing && (
                          <button onClick={() => handleStageEditStart(i, "character_change", stage.character_change)}
                            className="font-body-ui text-xs text-tertiary-container hover:text-primary-container">
                            <span className="material-symbols-outlined text-xs">edit</span>
                          </button>
                        )}
                      </div>
                      {editField === "character_change" ? (
                        <div className="space-y-2 mt-1">
                          <textarea value={stageEditValue} onChange={(e) => setStageEditValue(e.target.value)}
                            className="w-full bg-surface-container-low border border-outline-variant rounded p-2
                                       font-body-narrative text-primary text-sm leading-relaxed resize-y
                                       focus:outline-none focus:border-primary-container"
                            rows={2} autoFocus />
                          <div className="flex gap-2">
                            <button onClick={handleStageEditSave} disabled={saving}
                              className="px-2 py-0.5 bg-primary-container text-surface-container-low rounded text-xs">
                              {saving ? "..." : "保存"}
                            </button>
                            <button onClick={() => setStageEditKey(null)}
                              className="px-2 py-0.5 bg-surface-container text-system-log rounded text-xs">取消</button>
                          </div>
                        </div>
                      ) : (
                        <p className="font-body-narrative text-primary text-sm mt-0.5 leading-relaxed">
                          {stage.character_change || <span className="text-system-log/40">待填写</span>}
                        </p>
                      )}
                    </div>

                    {/* Target chapter range */}
                    <div className="flex items-center gap-4">
                      {editField === "target_chapter_range" ? (
                        <div className="flex gap-2 items-center">
                          <span className="font-label-mono text-system-log text-xs">目标章节:</span>
                          <input value={stageEditValue} onChange={(e) => setStageEditValue(e.target.value)}
                            className="w-24 input-underline text-xs" autoFocus
                            onKeyDown={(e) => e.key === "Enter" && handleStageEditSave()} />
                          <button onClick={handleStageEditSave} disabled={saving}
                            className="px-2 py-0.5 bg-primary-container text-surface-container-low rounded text-xs">
                            {saving ? "..." : "保存"}
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1">
                          <span className="font-label-mono text-system-log text-xs">
                            目标章节: {stage.target_chapter_range || "未定"}
                          </span>
                          <button onClick={() => handleStageEditStart(i, "target_chapter_range", stage.target_chapter_range)}
                            className="text-tertiary-container hover:text-primary-container">
                            <span className="material-symbols-outlined text-xs">edit</span>
                          </button>
                        </div>
                      )}
                      {stage.bound_chapter !== null && stage.bound_chapter !== undefined && (
                        <span className="font-label-mono text-tertiary-container text-xs flex items-center gap-1">
                          <span className="material-symbols-outlined text-sm">link</span>
                          已绑定: 第{stage.bound_chapter}章
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="text-center py-8">
            <span className="material-symbols-outlined text-3xl text-system-log/20 mb-2 block">
              timeline
            </span>
            <p className="font-body-ui text-system-log/50 text-xs">暂无成长阶段，点击上方按钮添加</p>
          </div>
        )}
      </GlassPanel>
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
  const [editingField, setEditingField] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [factionEditingKey, setFactionEditingKey] = useState<string | null>(null);
  const [factionEditValue, setFactionEditValue] = useState("");

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

  const handleEditStart = (field: string, value: string) => {
    setEditingField(field);
    setEditValue(value || "");
  };

  const handleWorldEditSave = async () => {
    if (!world || !editingField || !projectId) return;
    const updated = setNestedValue(world, editingField, editValue);
    setWorld(updated);
    setEditingField(null);
    setSaving(true);
    try {
      await api.updateWorld(projectId, updated);
    } finally {
      setSaving(false);
    }
  };

  const handleArrayChange = (path: string, newItems: string[]) => {
    if (!world || !projectId) return;
    const updated = structuredClone(world);
    const keys = path.split(".");
    let target: any = updated;
    for (let i = 0; i < keys.length - 1; i++) {
      if (target[keys[i]] === undefined || target[keys[i]] === null) return;
      target = target[keys[i]];
    }
    target[keys[keys.length - 1]] = newItems;
    setWorld(updated);
    api.updateWorld(projectId, updated).catch(() => {});
  };

  const handleFactionEditStart = (key: string, value: string) => {
    setFactionEditingKey(key);
    setFactionEditValue(value || "");
  };

  const handleFactionEditSave = async () => {
    if (!world || !factionEditingKey || !projectId) return;
    const [indexStr, field] = factionEditingKey.split(":");
    const index = parseInt(indexStr);
    const updated = structuredClone(world);
    (updated.factions[index] as any)[field] = factionEditValue;
    setWorld(updated);
    setFactionEditingKey(null);
    setSaving(true);
    try {
      await api.updateWorld(projectId, updated);
    } finally {
      setSaving(false);
    }
  };

  const handleAddFaction = async () => {
    if (!world || !projectId) return;
    const newFaction = { name: "新势力", type: "", goal: "", relations: "" };
    const updated = structuredClone(world);
    updated.factions = [...updated.factions, newFaction];
    setWorld(updated);
    setFactionEditingKey(`${updated.factions.length - 1}:name`);
    setFactionEditValue("新势力");
    api.updateWorld(projectId, updated).catch(() => {});
  };

  const handleRemoveFaction = async (index: number) => {
    if (!world || !projectId) return;
    setFactionEditingKey(null);
    const updated = structuredClone(world);
    updated.factions = updated.factions.filter((_, i) => i !== index);
    setWorld(updated);
    api.updateWorld(projectId, updated).catch(() => {});
  };

  const handleCharacterSave = async (updatedChar: Character) => {
    if (!projectId) return;
    const previousCharacters = characters;
    const updatedCharacters = characters.map(c =>
      c.id === updatedChar.id ? updatedChar : c
    );
    setCharacters(updatedCharacters);
    setSaving(true);
    try {
      await api.updateCharacter(projectId, {
        characters: updatedCharacters,
        current: updatedCharacters[selectedIndex] || updatedChar,
      });
    } catch (e) {
      setCharacters(previousCharacters);
      setError(e instanceof Error ? e.message : "角色保存失败");
    } finally {
      setSaving(false);
    }
  };

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
    { key: "workshop", label: "成长工坊", icon: "timeline" },
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
            onClick={() => { setActiveTab(key); setEditingField(null); setEditValue(""); }}
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
                      <div className="flex items-center justify-between">
                        <span className="font-label-mono text-system-log text-xs">时代背景</span>
                        <button onClick={() => handleEditStart("era", world.era)} className="font-body-ui text-xs text-tertiary-container hover:text-primary-container">
                          <span className="material-symbols-outlined text-sm">edit</span>
                        </button>
                      </div>
                      {editingField === "era" ? (
                        <div className="flex gap-2 mt-1">
                          <input value={editValue} onChange={(e) => setEditValue(e.target.value)}
                            className="flex-1 input-underline text-sm" autoFocus
                            onKeyDown={(e) => e.key === "Enter" && handleWorldEditSave()} />
                          <button onClick={handleWorldEditSave} disabled={saving}
                            className="px-3 py-1.5 bg-primary-container text-surface-container-low rounded text-sm">
                            {saving ? "保存中..." : "保存"}
                          </button>
                        </div>
                      ) : (
                        <p className="font-body-narrative text-primary text-sm mt-1">{world.era || <span className="text-system-log/40">待填写</span>}</p>
                      )}
                    </div>
                    <div>
                      <div className="flex items-center justify-between">
                        <span className="font-label-mono text-system-log text-xs">地理环境</span>
                        <button onClick={() => handleEditStart("geography", world.geography)} className="font-body-ui text-xs text-tertiary-container hover:text-primary-container">
                          <span className="material-symbols-outlined text-sm">edit</span>
                        </button>
                      </div>
                      {editingField === "geography" ? (
                        <div className="flex gap-2 mt-1">
                          <input value={editValue} onChange={(e) => setEditValue(e.target.value)}
                            className="flex-1 input-underline text-sm" autoFocus
                            onKeyDown={(e) => e.key === "Enter" && handleWorldEditSave()} />
                          <button onClick={handleWorldEditSave} disabled={saving}
                            className="px-3 py-1.5 bg-primary-container text-surface-container-low rounded text-sm">
                            {saving ? "保存中..." : "保存"}
                          </button>
                        </div>
                      ) : (
                        <p className="font-body-narrative text-primary text-sm mt-1">{world.geography || <span className="text-system-log/40">待填写</span>}</p>
                      )}
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
                      <div className="flex items-center justify-between">
                        <span className="font-label-mono text-system-log text-xs">体系名称</span>
                        <button onClick={() => handleEditStart("power_system.name", world.power_system.name)} className="font-body-ui text-xs text-tertiary-container hover:text-primary-container">
                          <span className="material-symbols-outlined text-sm">edit</span>
                        </button>
                      </div>
                      {editingField === "power_system.name" ? (
                        <div className="flex gap-2 mt-1">
                          <input value={editValue} onChange={(e) => setEditValue(e.target.value)}
                            className="flex-1 input-underline text-sm" autoFocus
                            onKeyDown={(e) => e.key === "Enter" && handleWorldEditSave()} />
                          <button onClick={handleWorldEditSave} disabled={saving}
                            className="px-3 py-1.5 bg-primary-container text-surface-container-low rounded text-sm">
                            {saving ? "保存中..." : "保存"}
                          </button>
                        </div>
                      ) : (
                        <p className="font-body-narrative text-primary text-sm mt-1">{world.power_system.name || <span className="text-system-log/40">待填写</span>}</p>
                      )}
                    </div>
                    <div>
                      <div className="flex items-center justify-between">
                        <span className="font-label-mono text-system-log text-xs">描述</span>
                        <button onClick={() => handleEditStart("power_system.description", world.power_system.description)} className="font-body-ui text-xs text-tertiary-container hover:text-primary-container">
                          <span className="material-symbols-outlined text-sm">edit</span>
                        </button>
                      </div>
                      {editingField === "power_system.description" ? (
                        <div className="flex gap-2 mt-1">
                          <input value={editValue} onChange={(e) => setEditValue(e.target.value)}
                            className="flex-1 input-underline text-sm" autoFocus
                            onKeyDown={(e) => e.key === "Enter" && handleWorldEditSave()} />
                          <button onClick={handleWorldEditSave} disabled={saving}
                            className="px-3 py-1.5 bg-primary-container text-surface-container-low rounded text-sm">
                            {saving ? "保存中..." : "保存"}
                          </button>
                        </div>
                      ) : (
                        <p className="font-body-narrative text-primary text-sm mt-1">{world.power_system.description || <span className="text-system-log/40">待填写</span>}</p>
                      )}
                    </div>
                    <div className="mt-4">
                      <span className="font-label-mono text-system-log text-xs">阶段划分</span>
                      <div className="mt-1">
                        <TagEditor
                          items={world.power_system.stages}
                          onItemsChange={(newItems) => handleArrayChange("power_system.stages", newItems)}
                          saving={saving}
                        />
                      </div>
                    </div>
                    <div className="mt-4">
                      <span className="font-label-mono text-system-log text-xs">体系规则</span>
                      <div className="mt-1">
                        <TagEditor
                          items={world.power_system.core_rules || []}
                          onItemsChange={(newItems) => handleArrayChange("power_system.core_rules", newItems)}
                          saving={saving}
                        />
                      </div>
                    </div>
                    <div>
                      <div className="flex items-center justify-between">
                        <span className="font-label-mono text-system-log text-xs">代价系统</span>
                        <button onClick={() => handleEditStart("power_system.cost_system", world.power_system.cost_system || "")} className="font-body-ui text-xs text-tertiary-container hover:text-primary-container">
                          <span className="material-symbols-outlined text-sm">edit</span>
                        </button>
                      </div>
                      {editingField === "power_system.cost_system" ? (
                        <div className="flex gap-2 mt-1">
                          <input value={editValue} onChange={(e) => setEditValue(e.target.value)}
                            className="flex-1 input-underline text-sm" autoFocus
                            onKeyDown={(e) => e.key === "Enter" && handleWorldEditSave()} />
                          <button onClick={handleWorldEditSave} disabled={saving}
                            className="px-3 py-1.5 bg-primary-container text-surface-container-low rounded text-sm">
                            {saving ? "保存中..." : "保存"}
                          </button>
                        </div>
                      ) : (
                        <p className="font-body-narrative text-primary text-sm mt-1">{world.power_system.cost_system || <span className="text-system-log/40">待填写</span>}</p>
                      )}
                    </div>
                  </div>
                </GlassPanel>

                {/* Core Rules */}
                <GlassPanel>
                  <h2 className="font-label-mono text-system-log uppercase tracking-wider mb-4">
                    世界规则
                  </h2>
                  <TagEditor
                    items={world.core_rules}
                    onItemsChange={(newItems) => handleArrayChange("core_rules", newItems)}
                    saving={saving}
                  />
                </GlassPanel>

                {/* Ceilings */}
                <GlassPanel>
                  <h2 className="font-label-mono text-system-log uppercase tracking-wider mb-4">
                    力量上限
                  </h2>
                  <TagEditor
                    items={world.power_system.ceilings}
                    onItemsChange={(newItems) => handleArrayChange("power_system.ceilings", newItems)}
                    saving={saving}
                  />
                </GlassPanel>

                {/* Factions */}
                <GlassPanel className="lg:col-span-2">
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="font-label-mono text-system-log uppercase tracking-wider">
                      势力分布
                    </h2>
                    <button
                      onClick={handleAddFaction}
                      disabled={saving}
                      className="flex items-center gap-1 px-3 py-1.5 text-xs border border-dashed
                                 border-system-log/30 rounded text-system-log/50
                                 hover:text-primary-container hover:border-primary-container/50
                                 transition-colors disabled:opacity-30"
                    >
                      <span className="material-symbols-outlined text-sm">add</span>
                      添加势力
                    </button>
                  </div>
                  {world.factions.length > 0 ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {world.factions.map((f, i) => (
                        <div key={i} className="p-3 bg-surface-container rounded relative">
                          <button
                            onClick={() => handleRemoveFaction(i)}
                            disabled={saving}
                            className="absolute top-2 right-2 text-system-log/30 hover:text-error
                                       transition-colors disabled:opacity-30"
                          >
                            <span className="material-symbols-outlined text-sm">close</span>
                          </button>

                          {/* Name */}
                          <div className="flex items-center justify-between mb-2 pr-6">
                            {factionEditingKey === `${i}:name` ? (
                              <div className="flex gap-2 items-center">
                                <input value={factionEditValue} onChange={(e) => setFactionEditValue(e.target.value)}
                                  className="flex-1 input-underline text-sm" autoFocus
                                  onKeyDown={(e) => e.key === "Enter" && handleFactionEditSave()} />
                                <button onClick={handleFactionEditSave} disabled={saving}
                                  className="px-2 py-0.5 bg-primary-container text-surface-container-low rounded text-xs">
                                  {saving ? "..." : "保存"}
                                </button>
                              </div>
                            ) : (
                              <div className="flex items-center gap-2">
                                <span className="font-label-mono text-primary text-sm">{f.name || "未命名"}</span>
                                <button onClick={() => handleFactionEditStart(`${i}:name`, f.name)}
                                  className="text-tertiary-container hover:text-primary-container">
                                  <span className="material-symbols-outlined text-xs">edit</span>
                                </button>
                              </div>
                            )}
                            {/* Type */}
                            {factionEditingKey === `${i}:type` ? (
                              <div className="flex gap-2 items-center">
                                <input value={factionEditValue} onChange={(e) => setFactionEditValue(e.target.value)}
                                  className="w-20 input-underline text-xs" autoFocus
                                  onKeyDown={(e) => e.key === "Enter" && handleFactionEditSave()} />
                                <button onClick={handleFactionEditSave} disabled={saving}
                                  className="px-2 py-0.5 bg-primary-container text-surface-container-low rounded text-xs">
                                  {saving ? "..." : "保存"}
                                </button>
                              </div>
                            ) : (
                              <div className="flex items-center gap-1">
                                <span className="text-xs px-2 py-0.5 bg-surface-container-low rounded text-system-log font-body-ui">
                                  {f.type || "未设置"}
                                </span>
                                <button onClick={() => handleFactionEditStart(`${i}:type`, f.type)}
                                  className="text-tertiary-container hover:text-primary-container">
                                  <span className="material-symbols-outlined text-xs">edit</span>
                                </button>
                              </div>
                            )}
                          </div>

                          {/* Goal */}
                          {factionEditingKey === `${i}:goal` ? (
                            <div className="flex gap-2 items-center mb-2">
                              <input value={factionEditValue} onChange={(e) => setFactionEditValue(e.target.value)}
                                className="flex-1 input-underline text-xs" autoFocus
                                onKeyDown={(e) => e.key === "Enter" && handleFactionEditSave()} />
                              <button onClick={handleFactionEditSave} disabled={saving}
                                className="px-2 py-0.5 bg-primary-container text-surface-container-low rounded text-xs">
                                {saving ? "..." : "保存"}
                              </button>
                            </div>
                          ) : (
                            <div className="flex items-start gap-1 mb-2">
                              <p className="font-body-narrative text-primary text-xs flex-1">{f.goal || "未设置"}</p>
                              <button onClick={() => handleFactionEditStart(`${i}:goal`, f.goal)}
                                className="text-tertiary-container hover:text-primary-container shrink-0">
                                <span className="material-symbols-outlined text-xs">edit</span>
                              </button>
                            </div>
                          )}

                          {/* Relations */}
                          {factionEditingKey === `${i}:relations` ? (
                            <div className="flex gap-2 items-center">
                              <input value={factionEditValue} onChange={(e) => setFactionEditValue(e.target.value)}
                                className="flex-1 input-underline text-xs" autoFocus
                                onKeyDown={(e) => e.key === "Enter" && handleFactionEditSave()} />
                              <button onClick={handleFactionEditSave} disabled={saving}
                                className="px-2 py-0.5 bg-primary-container text-surface-container-low rounded text-xs">
                                {saving ? "..." : "保存"}
                              </button>
                            </div>
                          ) : (
                            <div className="flex items-start gap-1">
                              <p className="font-body-ui text-system-log text-xs flex-1">{f.relations || "未设置"}</p>
                              <button onClick={() => handleFactionEditStart(`${i}:relations`, f.relations)}
                                className="text-tertiary-container hover:text-primary-container shrink-0">
                                <span className="material-symbols-outlined text-xs">edit</span>
                              </button>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="font-body-ui text-system-log/40 text-sm text-center py-4">暂无势力</p>
                  )}
                </GlassPanel>
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
              {selectedCharacter && <CharacterDetail key={selectedCharacter.id} character={selectedCharacter} onCharacterUpdate={handleCharacterSave} saving={saving} />}
            </>
          )}
        </div>
      )}

      {/* Workshop Tab */}
      {activeTab === "workshop" && (
        <div className="space-y-6">
          {selectedCharacter ? (
            <GrowthWorkshop projectId={projectId} character={selectedCharacter} />
          ) : (
            <div className="text-center py-16">
              <span className="material-symbols-outlined text-5xl text-system-log/30 mb-4 block">
                timeline
              </span>
              <p className="font-body-ui text-system-log mb-2">成长工坊</p>
              <p className="font-body-ui text-system-log/50 text-sm">请先在「角色设定」标签选择一个角色</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
