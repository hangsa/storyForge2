import { useEffect, useState } from "react";
import api, {
  type CommitResponse,
  type NoveltyScores,
  type NoveltyScoreDetail,
  type ValueStackLayer,
} from "@/api/client";
import NoveltyRadar from "@/components/creative-canvas/NoveltyRadar";
import { RegenerateModal } from "../../shared/RegenerateModal";

interface Props {
  projectId: string;
  selectedPath: string[];
  onComplete: (response: CommitResponse) => void;
  onBack: () => void;
  /**
   * S0E's regen endpoint only re-runs NoveltyEvaluator on the existing
   * canvas content — it doesn't mutate downstream fields, so onCanvasMutated
   * is unused here but kept in the Props shape for symmetry with the
   * other 4 stages.
   */
  onCanvasMutated?: () => void;
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
  onCanvasMutated,
}: Props) {
  const [scores, setScores] = useState<NoveltyScores | null>(null);
  const [editing, setEditing] = useState(false);
  const [valueStack, setValueStack] = useState<ValueStackLayer[]>(
    blankValueStack(),
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [regenerating, setRegenerating] = useState(false);
  const [showRegenerateModal, setShowRegenerateModal] = useState(false);

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

  async function handleRegenerate(userModifications: string) {
    setShowRegenerateModal(false);
    setRegenerating(true);
    setError(null);
    try {
      // /regenerate/novelty re-runs NoveltyEvaluator on the existing canvas
      // content (selected_path nodes). Returns the same NoveltyScores
      // shape plus `regenerated: true` + `user_modifications_received`.
      const fresh = await api.postDivergeRegenerateNovelty(projectId, {
        user_modifications: userModifications,
      });
      setScores(fresh);
      // /regenerate/novelty doesn't mutate canvas downstream — S0E is the
      // last producing stage. onCanvasMutated is a no-op here but kept in
      // the contract so the parent can wire it uniformly.
      onCanvasMutated?.();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "重新生成失败");
    } finally {
      setRegenerating(false);
    }
  }

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-medium">新颖度评估与提交</h2>
        <button
          type="button"
          data-testid="s0e-regenerate"
          onClick={() => setShowRegenerateModal(true)}
          disabled={regenerating || !scores}
          aria-label="重新生成 — 新颖度评估"
          className="inline-flex items-center gap-1.5 h-8 px-3 rounded border border-outline-variant text-on-surface text-sm hover:bg-surface-container hover:border-primary disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          <span
            className={`material-symbols-outlined text-[16px]${regenerating ? " animate-spin" : ""}`}
            data-testid={regenerating ? "s0e-regenerate-spinner" : undefined}
          >
            {regenerating ? "progress_activity" : "refresh"}
          </span>
          重新生成
        </button>
      </div>
      {fetchError && <div className="text-error text-sm">{fetchError}</div>}
      {error && <div className="text-error text-sm">{error}</div>}
      {/* Value stack editor — moved above the novelty row so the user
          sets the 4-layer value tension before reading the novelty
          verdict. Reading order now flows: edit values → see radar +
          evaluation + conclusion side-by-side. The block was previously
          rendered below the row, which forced the user to scroll past
          ~300px of novelty chrome to reach the editable section. */}
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
      {scores && (
        /* Three peer display boxes on the same row, ordered
           left → center → right:
             新颖度评价 (compact, left)
             新颖度雷达 (enlarged, center — the visual centerpiece)
             评估结论 (warning, right, conditional)

           Sizing rationale: the radar used to share a card with the
           evaluation list, then moved into its own md:w-64 (256px) box.
           Promoting it to the center column with flex-1 + a 280px chart
           height makes it the focal point of the commit screen — the
           thing the user reads first to decide whether the concept is
           "novel enough". The evaluation list is the supporting
           evidence that backs up the chart, so it gets a tighter
           md:w-56 (224px) column where each row stays readable but the
           card doesn't compete with the chart for visual weight.

           flex-1 on the radar card lets it fill whatever space remains
           after the two fixed-width siblings, so the row looks balanced
           whether or not the conclusion card is shown. */
        <div
          data-testid="novelty-row"
          className="flex flex-col md:flex-row gap-3 items-stretch"
        >
          {/* Evaluation card — compact fixed-width column on the left.
              flex-1 + justify-center on the axes block distributes the
              empty vertical space around the 4 rows so they sit centered
              inside the stretched card height (the radar card sets the
              row's height via items-stretch). py-3 + px-4 trims the
              top/bottom whitespace so the card hugs its content. */}
          <div
            data-testid="novelty-evaluation-card"
            className="border border-outline-variant rounded-lg py-3 px-4 md:w-56 flex-shrink-0 flex flex-col"
          >
            <h3 className="font-medium mb-2">新颖度评价</h3>
            <div className="text-sm space-y-1.5 flex-1 flex flex-col justify-center">
              <div className="flex justify-between gap-3">
                <span className="text-on-surface-variant">市场饱和度</span>
                <span
                  data-testid="novelty-market-saturation"
                  className="text-on-surface font-medium tabular-nums"
                >
                  {scores.market_saturation}
                </span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-on-surface-variant">套路相似度</span>
                <span
                  data-testid="novelty-trope-similarity"
                  className="text-on-surface font-medium tabular-nums"
                >
                  {scores.trope_similarity}
                </span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-on-surface-variant">矛盾深度</span>
                <span
                  data-testid="novelty-contradiction-depth"
                  className="text-on-surface font-medium tabular-nums"
                >
                  {scores.contradiction_depth}
                </span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-on-surface-variant">讨论潜力</span>
                <span
                  data-testid="novelty-discussion-potential"
                  className="text-on-surface font-medium tabular-nums"
                >
                  {scores.discussion_potential}
                </span>
              </div>
            </div>
            <div className="flex justify-between gap-3 pt-2 mt-2 border-t border-outline-variant">
              <span className="text-on-surface">综合分</span>
              <span
                data-testid="novelty-composite"
                className="text-on-surface font-semibold tabular-nums"
              >
                {scores.composite}
                {scores.grade && (
                  <span className="ml-1 text-on-surface-variant font-normal">
                    · {scores.grade}
                  </span>
                )}
              </span>
            </div>
          </div>

          {/* Radar card — center column, enlarged. flex-1 fills whatever
              space remains after the fixed-width siblings; min-w-[280px]
              guarantees the chart never gets squeezed below a readable
              size even on narrow viewports. height=280 (vs default 240)
              lifts the chart circle radius ~17% so the centerpiece
              reads as visibly larger than the other cards. py-3 trims
              the top/bottom whitespace so the chart fills more of the
              card. */}
          <div
            data-testid="novelty-radar-card"
            className="border border-outline-variant rounded-lg py-3 px-4 flex-1 min-w-[280px] flex flex-col"
          >
            <h3 className="font-medium mb-2">新颖度雷达</h3>
            <div data-testid="novelty-radar" className="w-full flex-1">
              <NoveltyRadar scores={toRadarDetail(scores)} height={280} />
            </div>
          </div>

          {/* Conclusion card — only shown when composite < 40. Warning
              styling (border-warning + bg-warning/10) keeps it visually
              distinct from the neutral radar/evaluation cards so the
              user reads it as a call-to-attention verdict. py-3 + gap-2
              trim the top/bottom whitespace so the verdict sits tightly
              inside its card. */}
          {scores.composite < 40 && (
            <div
              data-testid="warning-low-novelty"
              className="md:w-64 flex-shrink-0 rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 flex flex-col gap-2"
            >
              <h3 className="flex items-center gap-2 font-medium text-base text-warning">
                <span className="material-symbols-outlined text-[20px]" aria-hidden="true">warning</span>
                评估结论
              </h3>
              <div className="text-sm text-on-surface leading-relaxed">
                新颖度综合分 <strong className="font-semibold tabular-nums">{scores.composite}</strong> 低于 40,故事可能落入常见套路。
              </div>
              <div className="mt-auto pt-2 border-t border-warning/30 text-xs text-on-surface-variant leading-relaxed">
                按 D-2 策略,仅警告不阻止提交。
              </div>
            </div>
          )}
        </div>
      )}
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
      <RegenerateModal
        open={showRegenerateModal}
        target="新颖度评估"
        placeholder="例如:换个评估侧重 / 加入市场视角 / 让评分更严格……"
        busy={regenerating}
        onConfirm={handleRegenerate}
        onCancel={() => setShowRegenerateModal(false)}
      />
    </div>
  );
}