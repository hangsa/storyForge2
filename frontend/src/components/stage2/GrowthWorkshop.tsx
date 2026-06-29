import { useState } from "react";
import type { Character, GrowthStage } from "../../api/client";
import { useGrowthWorkshop } from "../../hooks/useGrowthWorkshop";
import GrowthCurveChart from "./GrowthCurveChart";
import GrowthStageEditor from "./GrowthStageEditor";
import ConsistencyWarnings from "./ConsistencyWarnings";

interface Props {
  projectId: string;
  character: Character;
}

export default function GrowthWorkshop({ projectId, character }: Props) {
  const initialStages: GrowthStage[] = character.growth_curve?.stages ?? [];
  const [stages, setStages] = useState<GrowthStage[]>(initialStages);
  const [discussAnswer, setDiscussAnswer] = useState<string>("");
  const [question, setQuestion] = useState<string>("");
  const ws = useGrowthWorkshop(projectId);

  const warnings = ws.checkResult?.warnings ?? [];

  async function onCheck() {
    await ws.check(character.id);
  }

  async function onSave() {
    try {
      await ws.adjust(character.id, stages);
    } catch (e) {
      window.alert(`保存失败：${(e as Error).message}`);
    }
  }

  async function onAsk() {
    const resp = await ws.discuss(character.id, question);
    setDiscussAnswer(resp.answer);
  }

  return (
    <div className="space-y-4">
      <header className="flex items-baseline justify-between">
        <h2 className="text-xl font-semibold">{character.name} 的成长曲线</h2>
        <button
          type="button"
          onClick={onCheck}
          disabled={ws.checking}
          className="px-3 py-1 rounded bg-indigo-600 text-white text-sm disabled:opacity-50"
        >
          {ws.checking ? "检查中…" : "▶ 运行一致性检查"}
        </button>
      </header>

      <section>
        <GrowthCurveChart stages={stages} />
      </section>

      <section>
        <GrowthStageEditor stages={stages} onChange={setStages} />
      </section>

      <section>
        <button
          type="button"
          onClick={onSave}
          className="px-3 py-1 rounded bg-green-600 text-white text-sm"
        >
          💾 保存修改
        </button>
      </section>

      <section>
        <h3 className="text-lg font-medium mb-2">一致性检查 ({warnings.length})</h3>
        <ConsistencyWarnings warnings={warnings} />
        {ws.checkError && <p className="text-sm text-red-600">{ws.checkError}</p>}
      </section>

      <section>
        <h3 className="text-lg font-medium mb-2">与 CharacterDesigner 讨论</h3>
        <div className="flex gap-2">
          <input
            type="text"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="例如：节奏是否合适？"
            className="flex-1 border rounded px-2 py-1 text-sm"
            aria-label="讨论问题"
          />
          <button
            type="button"
            onClick={onAsk}
            disabled={!question}
            className="px-3 py-1 rounded bg-blue-600 text-white text-sm disabled:opacity-50"
          >
            提问
          </button>
        </div>
        {discussAnswer && (
          <p className="mt-2 text-sm text-gray-700 whitespace-pre-wrap">{discussAnswer}</p>
        )}
      </section>
    </div>
  );
}