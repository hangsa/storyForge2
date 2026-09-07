import { useState } from "react";
import { PrimaryButton, SecondaryButton } from "@/components/ds";
import type { CommittedConcept, NoveltyScores } from "./types";

interface Props {
  committedConcept: CommittedConcept | null;
  noveltyScores: NoveltyScores | null;
  loading: boolean;
  onEditConcept: (fields: Partial<CommittedConcept>) => void;
  onRegenerateCommit: () => void;
  onRegenerateAllDivergence: () => void;
  onAdvance: () => void;
}

const FIELDS = [
  { key: "one_line" as const, label: "一句话", multiline: false },
  { key: "expanded" as const, label: "扩展", multiline: true },
  { key: "core_tension" as const, label: "核心张力", multiline: true },
  { key: "tone" as const, label: "基调", multiline: false },
  { key: "logline" as const, label: "Logline", multiline: true },
];

export default function S4CommitStep({
  committedConcept, noveltyScores, loading, onEditConcept, onRegenerateCommit, onRegenerateAllDivergence, onAdvance,
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
        <footer className="flex items-center justify-end px-margin-desktop py-3 border-t border-outline-variant gap-3 shrink-0">
          <PrimaryButton
            label={loading ? "合成中…" : "下一步:进入概念DNA →"}
            loading={loading}
            onClick={onAdvance}
          />
        </footer>
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
      <div className="space-y-4 flex-1 min-h-0 overflow-y-auto">
        <header className="font-mono text-primary-container text-[10px] uppercase tracking-wider">
          Stage 4 · 提交
        </header>

        {!editing ? (
          <div className="bg-surface-container-low border border-outline-variant rounded-lg p-4 space-y-3">
            {FIELDS.map((f) => (
              <div key={f.key}>
                <div className="text-xs text-on-surface-variant">{f.label}</div>
                <div className="text-primary mt-1 whitespace-pre-wrap" data-testid={`committed-${f.key}`}>
                  {(committedConcept as any)[f.key]}
                </div>
              </div>
            ))}
            {committedConcept.edited_by_user && (
              <div className="text-xs text-warning">用户已编辑</div>
            )}
            {noveltyScores && (
              <div className="border-t border-outline-variant pt-2 mt-2 text-xs text-on-surface-variant" data-testid="novelty-scores">
                新颖度评分 composite: {noveltyScores.composite} {noveltyScores.grade}
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

      <footer className="flex items-center justify-between px-margin-desktop py-3 border-t border-outline-variant gap-3 shrink-0">
        <div className="flex gap-2">
          {!editing && <SecondaryButton label="编辑" icon="edit" onClick={startEdit} />}
          <SecondaryButton
            label="重新生成"
            icon="refresh"
            onClick={() => setConfirmRegen(true)}
          />
          <SecondaryButton
            label="全部重新生成"
            icon="restart_alt"
            onClick={onRegenerateAllDivergence}
          />
        </div>
        <PrimaryButton
          label={loading ? "提交中…" : "下一步:进入概念DNA →"}
          loading={loading}
          onClick={onAdvance}
        />
      </footer>

      {confirmRegen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50" data-testid="regen-confirm-dialog">
          <div className="bg-white rounded-lg p-6 max-w-md w-full">
            <h2 className="text-lg font-semibold mb-3">重新生成 concept?</h2>
            <p className="text-sm text-gray-600 mb-4">
              当前 concept 包含用户编辑或之前生成结果,重新生成将覆盖。是否继续?
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                className="px-4 py-2 rounded bg-gray-100"
                onClick={() => setConfirmRegen(false)}
              >
                取消
              </button>
              <button
                type="button"
                className="px-4 py-2 rounded bg-blue-600 text-white"
                onClick={() => { setConfirmRegen(false); onRegenerateCommit(); }}
              >
                确认重新生成
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
