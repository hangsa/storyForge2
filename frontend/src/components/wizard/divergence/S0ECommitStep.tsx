import { useEffect, useState } from "react";
import api, {
  type CommitResponse,
  type NoveltyScores,
  type NoveltyScoreDetail,
  type ValueStackLayer,
} from "@/api/client";
import NoveltyRadar from "@/components/creative-canvas/NoveltyRadar";

interface Props {
  projectId: string;
  selectedPath: string[];
  onComplete: (response: CommitResponse) => void;
  onBack: () => void;
}

const LEVELS: Array<ValueStackLayer["level"]> = [
  "personal",
  "social",
  "philosophical",
  "existential",
];

const LEVEL_LABELS: Record<ValueStackLayer["level"], string> = {
  personal: "个人",
  social: "社会",
  philosophical: "哲学",
  existential: "存在",
};

// Map list-level NoveltyScores (0-100) → NoveltyScoreDetail shape used by
// the canvas NoveltyRadar component (which expects total + `_score` suffix).
function toRadarDetail(scores: NoveltyScores): NoveltyScoreDetail {
  return {
    total: scores.composite,
    market_saturation_score: scores.market_saturation,
    trope_similarity_score: scores.trope_similarity,
    contradiction_depth_score: scores.contradiction_depth,
    discussion_potential_score: scores.discussion_potential,
    grade: scores.grade ?? "未知",
  };
}

function blankValueStack(): ValueStackLayer[] {
  return LEVELS.map((level) => ({ level, value_a: "", value_b: "" }));
}

export default function S0ECommitStep({
  projectId,
  selectedPath,
  onComplete,
  onBack,
}: Props) {
  const [scores, setScores] = useState<NoveltyScores | null>(null);
  const [editing, setEditing] = useState(false);
  const [valueStack, setValueStack] = useState<ValueStackLayer[]>(
    blankValueStack(),
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const result = await api.getDivergeNovelty(projectId);
        if (cancelled) return;
        setScores(result);
      } catch (e: unknown) {
        if (cancelled) return;
        setFetchError(e instanceof Error ? e.message : "新颖度评估加载失败");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  function updateLayer(level: ValueStackLayer["level"], raw: string) {
    // Single input per level. Format: "value_a, value_b" (comma-separated).
    const parts = raw.split(/[,，]/);
    const value_a = parts[0]?.trim() ?? "";
    const value_b = parts.slice(1).join(",").trim();
    setValueStack((prev) =>
      prev.map((v) => (v.level === level ? { ...v, value_a, value_b } : v)),
    );
  }

  function isStackComplete(stack: ValueStackLayer[]): boolean {
    return stack.every(
      (v) => v.value_a.trim().length > 0 && v.value_b.trim().length > 0,
    );
  }

  async function submit() {
    setSubmitting(true);
    setError(null);
    try {
      const body: {
        confirmed_path_ids: string[];
        value_stack_override?: ValueStackLayer[];
      } = { confirmed_path_ids: selectedPath };
      if (isStackComplete(valueStack)) {
        body.value_stack_override = valueStack;
      }
      const response = await api.postDivergeCommit(projectId, body);
      onComplete(response);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "提交失败");
      setSubmitting(false);
    }
  }

  return (
    <div className="p-6 space-y-4">
      <h2 className="text-xl font-medium">新颖度评估与提交</h2>
      {fetchError && <div className="text-error text-sm">{fetchError}</div>}
      {error && <div className="text-error text-sm">{error}</div>}
      {scores && (
        <>
          <div className="border border-outline-variant rounded-lg p-4">
            <h3 className="font-medium mb-2">新颖度雷达</h3>
            <NoveltyRadar scores={toRadarDetail(scores)} />
            {/* Accessible text mirror of the radar's 4 axes for screen readers
                and test selectors — Recharts ticks live inside SVG and aren't
                addressable via getByText. */}
            <ul className="text-sm text-on-surface-variant mt-2 grid grid-cols-2 gap-x-4">
              <li>市场饱和度: {scores.market_saturation}</li>
              <li>套路相似度: {scores.trope_similarity}</li>
              <li>矛盾深度: {scores.contradiction_depth}</li>
              <li>讨论潜力: {scores.discussion_potential}</li>
            </ul>
            <div className="text-sm text-on-surface-variant mt-2">
              综合分: <span className="font-medium">{scores.composite}</span>
              {scores.grade && ` · ${scores.grade}`}
            </div>
          </div>
          {scores.composite < 40 && (
            <div
              data-testid="warning-low-novelty"
              className="bg-warning/10 border border-warning rounded-lg px-4 py-3 text-sm"
            >
              新颖度综合分低于 40,故事可能落入常见套路。
              <br />
              按 D-2 策略,仅警告不阻止提交。
            </div>
          )}
        </>
      )}
      <div className="border border-outline-variant rounded-lg p-4">
        <div className="flex items-center justify-between">
          <h3 className="font-medium">价值栈</h3>
          <button
            data-testid="edit-value-stack"
            type="button"
            onClick={() => setEditing((e) => !e)}
            className="text-xs px-3 py-1 text-primary hover:underline"
          >
            {editing ? "收起" : "编辑价值栈"}
          </button>
        </div>
        {editing && (
          <div className="mt-3 space-y-3">
            {valueStack.map((v) => (
              <div key={v.level} className="space-y-1">
                <label className="text-xs text-on-surface-variant">
                  {LEVEL_LABELS[v.level]}层 (value_a, value_b)
                </label>
                <input
                  data-testid={`vs-input-${v.level}`}
                  type="text"
                  placeholder="value_a, value_b"
                  defaultValue={`${v.value_a}${v.value_b ? ", " + v.value_b : ""}`}
                  onChange={(e) => updateLayer(v.level, e.target.value)}
                  className="w-full px-3 py-2 bg-surface-container border border-outline-variant rounded text-primary text-sm placeholder:text-on-surface-variant/50 focus:outline-none focus:border-primary"
                />
              </div>
            ))}
            <p className="text-xs text-on-surface-variant">
              四层全部填满后,提交时将作为 value_stack_override 发送给后端。
            </p>
          </div>
        )}
      </div>
      <div className="flex justify-between">
        <button
          data-testid="s0e-back"
          type="button"
          onClick={onBack}
          className="px-4 py-2 text-sm bg-surface-container rounded-lg"
        >
          上一步
        </button>
        <button
          data-testid="s0e-submit"
          type="button"
          disabled={!scores || submitting}
          onClick={submit}
          className="px-5 py-2 bg-primary text-on-primary rounded-lg disabled:opacity-40"
        >
          {submitting ? "提交中..." : "提交创意发散"}
        </button>
      </div>
    </div>
  );
}