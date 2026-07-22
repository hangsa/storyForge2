import { useState } from "react";
import { Character, RelationStatus } from "../../api/client";

interface Props {
  relations: Record<string, RelationStatus>;
  allCharacters: Character[];
  selfId: string;
  onChange: (next: Record<string, RelationStatus>) => void;
}

const STATUS_OPTIONS = ["neutral", "ally", "enemy", "family", "rival", "mentor"];

export default function CharacterRelationsEditor({ relations, allCharacters, selfId, onChange }: Props) {
  const [adding, setAdding] = useState(false);
  const [targetId, setTargetId] = useState("");
  const [status, setStatus] = useState("neutral");

  const candidates = allCharacters.filter((c) => c.id !== selfId && !(c.id in relations));

  const addRelation = () => {
    if (!targetId) return;
    onChange({ ...relations, [targetId]: { status, history: [], last_update_chapter: 0 } });
    setTargetId("");
    setStatus("neutral");
    setAdding(false);
  };

  const removeRelation = (id: string) => {
    const next = { ...relations };
    delete next[id];
    onChange(next);
  };

  const updateStatus = (id: string, newStatus: string) => {
    onChange({ ...relations, [id]: { ...relations[id], status: newStatus } });
  };

  return (
    <div data-testid="character-relations-editor" className="space-y-2">
      <ul className="space-y-1">
        {Object.entries(relations).map(([targetId_, rel]) => {
          const target = allCharacters.find((c) => c.id === targetId_);
          return (
            <li
              key={targetId_}
              className="flex items-center justify-between gap-2 p-1.5 bg-surface-container-low rounded"
            >
              <span className="font-label-mono text-primary text-xs truncate flex-1">
                {target?.name || targetId_}
              </span>
              <select
                value={rel.status}
                onChange={(e) => updateStatus(targetId_, e.target.value)}
                className="text-[11px] bg-surface-container border border-outline-variant rounded px-1 py-0.5"
              >
                {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
              <button
                type="button"
                data-testid={`relations-remove-${targetId_}`}
                onClick={() => removeRelation(targetId_)}
                className="text-system-log/60 hover:text-error text-xs"
                aria-label="删除关系"
              >×</button>
            </li>
          );
        })}
      </ul>

      {adding ? (
        <div className="flex items-center gap-2 p-1.5 bg-surface-container-low rounded">
          <select
            data-testid="relations-target-select"
            value={targetId}
            onChange={(e) => setTargetId(e.target.value)}
            className="flex-1 text-xs bg-surface-container border border-outline-variant rounded px-1 py-0.5"
          >
            <option value="">— 选择角色 —</option>
            {candidates.map((c) => <option key={c.id} value={c.id}>{c.name || c.id}</option>)}
          </select>
          <select
            data-testid="relations-new-status"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="text-xs bg-surface-container border border-outline-variant rounded px-1 py-0.5"
          >
            {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <button
            type="button"
            data-testid="relations-confirm-add"
            onClick={addRelation}
            disabled={!targetId}
            className="px-2 py-0.5 text-xs bg-tertiary-container text-surface-container-low rounded disabled:opacity-40"
          >添加</button>
          <button
            type="button"
            onClick={() => { setAdding(false); setTargetId(""); }}
            className="px-2 py-0.5 text-xs bg-surface-container text-system-log rounded"
          >取消</button>
        </div>
      ) : (
        <button
          type="button"
          data-testid="relations-add-button"
          onClick={() => setAdding(true)}
          disabled={candidates.length === 0}
          className="px-2 py-1 text-xs text-system-log/70 border border-dashed border-outline-variant rounded hover:text-primary-container hover:border-primary-container/50 disabled:opacity-40"
        >+ 添加关系</button>
      )}
    </div>
  );
}
