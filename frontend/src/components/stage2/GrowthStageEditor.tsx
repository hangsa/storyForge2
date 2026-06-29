import type { GrowthEventType, GrowthStage } from "../../api/client";

interface Props {
  stages: GrowthStage[];
  onChange: (stages: GrowthStage[]) => void;
}

const STAGE_NAMES = ["起点", "转折", "低谷", "回升", "终点"];
const TRIGGER_TYPES: GrowthEventType[] = [
  "betrayal_experienced", "death_of_loved_one", "world_truth_revealed",
  "personal_identity_crisis", "irreversible_loss", "moral_awakening",
  "accumulated_evidence", "relationship_transformation",
];

export default function GrowthStageEditor({ stages, onChange }: Props) {
  function update(idx: number, patch: Partial<GrowthStage>) {
    const next = stages.map((s, i) => (i === idx ? { ...s, ...patch } : s));
    onChange(next);
  }

  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left text-gray-600">
          <th>阶段</th>
          <th>章节</th>
          <th>触发类型</th>
          <th>描述</th>
        </tr>
      </thead>
      <tbody>
        {stages.map((s, i) => (
          <tr key={i}>
            <td>
              <select
                value={s.stage_name}
                onChange={(e) => update(i, { stage_name: e.target.value })}
                aria-label={`阶段 ${i + 1} 名称`}
              >
                {STAGE_NAMES.map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </td>
            <td>
              <input
                type="number"
                className="w-20 border rounded px-1"
                value={s.bound_chapter ?? ""}
                onChange={(e) => {
                  const v = e.target.value;
                  update(i, { bound_chapter: v === "" ? null : Number(v) });
                }}
                aria-label={`阶段 ${i + 1} 章节`}
              />
            </td>
            <td>
              <select
                value={s.trigger_event_type}
                onChange={(e) => update(i, { trigger_event_type: e.target.value as GrowthEventType })}
                aria-label={`阶段 ${i + 1} 触发类型`}
              >
                {TRIGGER_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </td>
            <td>
              <input
                type="text"
                className="w-full border rounded px-1"
                value={s.character_change ?? ""}
                onChange={(e) => update(i, { character_change: e.target.value })}
                aria-label={`阶段 ${i + 1} 描述`}
              />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
