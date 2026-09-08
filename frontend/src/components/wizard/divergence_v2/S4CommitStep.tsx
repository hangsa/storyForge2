import { useState } from "react";
import { PrimaryButton, SecondaryButton, StatCard } from "@/components/ds";
import type { CommittedConcept, NoveltyScores } from "./types";

// Footer "下一步" navigation is registered through the page-level wizard
// footer (see CreativeDivergenceStep + setNextHandler). The left-side
// action group (编辑 / 重新生成 / 全部重新生成) stays inline because it
// operates on committed concept data, not on sub-stage navigation.

interface Props {
  committedConcept: CommittedConcept | null;
  noveltyScores: NoveltyScores | null;
  onEditConcept: (fields: Partial<CommittedConcept>) => void;
  onRegenerateCommit: () => void;
  onRegenerateAllDivergence: () => void;
  // onAdvance is registered by CreativeDivergenceStep as the wizard footer's
  // nextHandler; this component no longer renders the advance button itself.
  onAdvance: () => void;
}

const FIELDS = [
  { key: "one_line" as const, label: "一句话", multiline: false },
  { key: "expanded" as const, label: "扩展", multiline: true },
  { key: "core_tension" as const, label: "核心张力", multiline: true },
  { key: "tone" as const, label: "基调", multiline: false },
  { key: "logline" as const, label: "Logline", multiline: true },
];

const NOVELTY_METRICS: Array<{ key: keyof Omit<NoveltyScores, "composite" | "grade">; label: string }> = [
  { key: "market_saturation", label: "市场饱和" },
  { key: "trope_similarity", label: "套路相似度" },
  { key: "contradiction_depth", label: "矛盾深度" },
  { key: "discussion_potential", label: "讨论潜力" },
];

export default function S4CommitStep({
  committedConcept, noveltyScores, onEditConcept, onRegenerateCommit, onRegenerateAllDivergence,
}: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Partial<CommittedConcept>>({});
  const [confirmRegen, setConfirmRegen] = useState(false);

  if (committedConcept === null) {
    return (
      <div className="flex flex-col flex-1 min-h-0">
        <div className="flex-1 flex items-center justify-center text-on-surface-variant text-sm">
          尚未合成 concept,点「下一步」将开始 LLM 合成
        </div>
      </div>
    );
  }

  function startEdit() {
    setDraft({ ...committedConcept! });
    setEditing(true);
  }

  function saveEdit() {
    onEditConcept(draft);
    setEditing(false);
  }

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="space-y-4 flex-1 min-h-0 overflow-y-auto px-margin-desktop pt-4">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="material-symbols-outlined text-primary-container text-lg leading-none">task_alt</span>
          <h2 className="font-display text-base font-semibold text-primary">Stage 4 · 提交</h2>
          {!editing && (
            <div className="flex gap-2 ml-auto">
              <SecondaryButton label="编辑" icon="edit" size="sm" onClick={startEdit} />
              <SecondaryButton
                label="重新生成"
                icon="refresh"
                size="sm"
                onClick={() => setConfirmRegen(true)}
              />
              <SecondaryButton
                label="全部重新生成"
                icon="restart_alt"
                size="sm"
                onClick={onRegenerateAllDivergence}
              />
            </div>
          )}
        </div>

        {!editing ? (
          <div className="bg-surface-container-low border border-outline-variant rounded-lg p-4 space-y-3">
            {FIELDS.map((f) => (
              <div key={f.key}>
                <div className="font-mono text-xs uppercase tracking-wider text-on-surface-variant">{f.label}</div>
                {f.key === "one_line" ? (
                  <div
                    className="font-display text-lg text-primary mt-1 whitespace-pre-wrap"
                    data-testid={`committed-${f.key}`}
                  >
                    {(committedConcept as any)[f.key]}
                  </div>
                ) : (
                  <div
                    className="text-primary mt-1 whitespace-pre-wrap"
                    data-testid={`committed-${f.key}`}
                  >
                    {(committedConcept as any)[f.key]}
                  </div>
                )}
              </div>
            ))}
            {committedConcept.edited_by_user && (
              <div className="text-xs text-warning">用户已编辑</div>
            )}
            {noveltyScores && (
              <div className="border-t border-outline-variant pt-3 mt-3 space-y-2" data-testid="novelty-scores">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs uppercase tracking-wider text-on-surface-variant">
                    新颖度评分
                  </span>
                  <span className="inline-flex items-center gap-2">
                    <span className="font-mono text-sm text-primary">
                      composite: {noveltyScores.composite} {noveltyScores.grade}
                    </span>
                    <span className="inline-block bg-primary-container/20 text-primary-container px-2 py-0.5 rounded-full text-xs font-mono">
                      {noveltyScores.grade}
                    </span>
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {NOVELTY_METRICS.map((m) => (
                    <StatCard
                      key={m.key}
                      label={m.label}
                      value={noveltyScores[m.key]}
                      size="sm"
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="bg-surface-container-low border border-outline-variant rounded-lg p-4 space-y-3">
            {FIELDS.map((f) => (
              <div key={f.key}>
                <label className="text-xs text-on-surface-variant block mb-1">{f.label}</label>
                <textarea
                  rows={f.multiline ? 4 : 1}
                  className="w-full bg-surface-container border border-outline-variant rounded px-2 py-1 text-sm"
                  value={(draft as any)[f.key] ?? ""}
                  onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })}
                  data-testid={`edit-${f.key}`}
                />
              </div>
            ))}
            <div className="flex justify-end gap-2">
              <SecondaryButton label="取消编辑" onClick={() => setEditing(false)} />
              <PrimaryButton label="保存编辑" onClick={saveEdit} />
            </div>
          </div>
        )}
      </div>

      {confirmRegen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50" data-testid="regen-confirm-dialog">
          <div className="bg-white rounded-lg p-6 max-w-md w-full">
            <h2 className="font-display text-lg font-semibold mb-3">重新生成 concept?</h2>
            <p className="text-sm text-gray-600 mb-4">
              当前 concept 包含用户编辑或之前生成结果,重新生成将覆盖。是否继续?
            </p>
            <div className="flex justify-end gap-2">
              <SecondaryButton label="取消" onClick={() => setConfirmRegen(false)} />
              <PrimaryButton
                label="确认重新生成"
                onClick={() => { setConfirmRegen(false); onRegenerateCommit(); }}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
