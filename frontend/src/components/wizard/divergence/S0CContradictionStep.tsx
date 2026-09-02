import { useEffect, useState } from "react";
import api, {
  type ContradictionCandidate,
  type CoreContradiction,
  type IdeaVariant,
} from "@/api/client";
import { RegenerateModal } from "../../shared/RegenerateModal";
import type { PersistedCandidates } from "../CreativeDivergenceStep";

interface Props {
  projectId: string;
  variants: IdeaVariant[];
  initial?: CoreContradiction | null;
  /**
   * Persisted 5-candidate list from the last /contradict POST. S0C uses
   * these on mount when `variant_id` matches `variants[0]?.id`, avoiding
   * a redundant LLM round-trip when the user navigates back from D/E
   * without changing anything upstream. When the cache is stale (variant
   * id changed, or this is a fresh mount), the effect below calls
   * /contradict as before and the backend overwrites the canvas cache.
   */
  initialCandidates?: PersistedCandidates | null;
  onComplete: (core: CoreContradiction) => void;
  onBack: () => void;
  /**
   * Called after /diverge/regenerate/contradiction clears the saved
   * core_contradiction + selected_path on canvas. Parent re-reads state so
   * S0C's `initial` prop becomes null and the parent stops pretending the
   * user has a contradiction saved.
   */
  onCanvasMutated?: () => void;
}

const CUSTOM_KEY = "__custom__";

function tensionColor(score: number): string {
  if (score >= 80) return "text-success";
  if (score >= 60) return "text-warning";
  return "text-error";
}

export default function S0CContradictionStep({
  projectId,
  variants,
  initial,
  initialCandidates,
  onComplete,
  onBack,
  onCanvasMutated,
}: Props) {
  const [candidates, setCandidates] = useState<ContradictionCandidate[]>([]);
  const [selected, setSelected] = useState<string | null>(
    initial?.template_type || null,
  );
  const [customStatement, setCustomStatement] = useState(
    initial?.statement || "",
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [regenerating, setRegenerating] = useState(false);
  const [showRegenerateModal, setShowRegenerateModal] = useState(false);
  // Bumped after a successful /regenerate/contradiction so the candidate
  // fetch effect re-runs with a fresh set of candidates. /regenerate/
  // contradiction only clears the saved core_contradiction on canvas — it
  // does NOT generate new candidates, so we have to re-run postDiverge
  // Contradict ourselves after the regen call lands.
  const [regenKey, setRegenKey] = useState(0);

  useEffect(() => {
    // Re-fetch candidates every time the step mounts, even when an `initial`
    // contradiction was passed in. The previous guard `if (initial) return`
    // caused a regression on proj_f0721bdc 2026-08-31: when the user
    // committed an empty contradiction during the LLM outage, then
    // navigated back from S0D/S0E to re-pick, the candidate list stayed
    // empty (the early-exit skipped the fetch) and the warning banner
    // could never clear. Fetching on every mount is one cheap LLM call and
    // keeps the candidate list consistent regardless of how the user
    // arrived at S0C. The `initial` prop still pre-selects the
    // previously-chosen template below so the UI doesn't lose state.
    if (variants.length === 0) return;

    // Fast-path: use the persisted candidate set from the last /contradict
    // POST when its variant_id matches the current variants[0]. Avoids
    // re-running the LLM on C→D→back-to-C navigation. variant_content is
    // best-effort compared too — if the backend returns a richer version
    // (e.g. trope_tags arrived after TropeExtractor finished), prefer the
    // fresh variant_content over the cache's snapshot. Strict match keeps
    // us from showing stale candidates after a /regenerate/variants call
    // (which re-rolls the 3-op chain but keeps the variant_id format).
    const primary = variants[0];
    if (
      initialCandidates &&
      initialCandidates.variant_id === primary.id &&
      initialCandidates.candidates.length > 0
    ) {
      setCandidates(initialCandidates.candidates);
      if (!selected && initialCandidates.candidates.length > 0) {
        setSelected(initialCandidates.candidates[0].template_type);
      }
      return;
    }

    let cancelled = false;
    // Step-local AbortController so we can race the fetch against a UX
    // timeout. /contradict calls all 5 template expansions sequentially in
    // the backend; on proj_f0721bdc 2026-09-01 that took ~80s end-to-end
    // (after gather: ~15-20s; before gather: 80s+). The shared TIMEOUT_MS
    // in api/client.ts is 600s, which means the spinner just sits there.
    // 45s is enough buffer for the post-gather case while giving the user
    // a "try again or use custom" affordance quickly on the pre-gather one.
    const controller = new AbortController();
    const timeoutMs = 45_000;
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    (async () => {
      setLoading(true);
      try {
        const result = await api.postDivergeContradict(projectId, {
          variant_id: primary.id,
          variant_content: primary.premise_one_line,
        }, { signal: controller.signal });
        if (cancelled) return;
        setCandidates(result.candidates);
        if (result.candidates.length > 0 && !selected) {
          setSelected(result.candidates[0].template_type);
        }
        // Sync the persisted candidates back into parent state so a back-nav
        // from S0D (or StepIndicator jump) hits the fast-path above instead
        // of re-running the 5-template LLM expansion. Without this, parent
        // state.contradictionCandidates stays null between C's fetch and any
        // subsequent C remount — D's choose-branch / regen would refresh it,
        // but a plain C→D→back-to-C sequence silently re-fetched every time.
        onCanvasMutated?.();
      } catch (e: unknown) {
        if (cancelled) return;
        if (e instanceof DOMException && e.name === "AbortError") {
          setError(`生成超时(>${timeoutMs / 1000}s),请重试或使用「自定义矛盾」手写`);
        } else {
          setError(e instanceof Error ? e.message : "生成失败");
        }
      } finally {
        clearTimeout(timer);
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      controller.abort();
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, variants, initial, initialCandidates, regenKey]);

  async function submit() {
    if (!selected) return;
    try {
      let body;
      if (selected === CUSTOM_KEY) {
        if (!customStatement.trim()) {
          setError("自定义矛盾不能为空");
          return;
        }
        body = {
          template_type: "CUSTOM",
          statement: customStatement.trim(),
          side_a: "",
          side_b: "",
          is_custom: true,
        };
      } else {
        const c = candidates.find((x) => x.template_type === selected);
        if (!c) return;
        body = {
          template_type: c.template_type,
          statement: c.preview_statement,
          side_a: c.side_a,
          side_b: c.side_b,
          tension_score: c.tension_score,
          is_custom: false,
        };
      }
      const result = await api.putDivergeContradict(projectId, body);
      onComplete(result.core_contradiction);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "保存失败");
    }
  }

  async function handleRegenerate(userModifications: string) {
    setShowRegenerateModal(false);
    setRegenerating(true);
    setError(null);
    try {
      // /regenerate/contradiction clears core_contradiction + selected_path
      // on canvas. It does NOT generate new candidates — the effect below
      // re-runs postDivergeContradict after regenKey bumps to fetch a
      // fresh set, and onCanvasMutated syncs the parent's DivergenceState.
      await api.postDivergeRegenerateContradiction(projectId, {
        user_modifications: userModifications,
      });
      setSelected(null);
      setCustomStatement("");
      setRegenKey((k) => k + 1);
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
        <h2 className="text-xl font-medium">核心矛盾</h2>
        <button
          type="button"
          data-testid="s0c-regenerate"
          onClick={() => setShowRegenerateModal(true)}
          disabled={regenerating || loading}
          aria-label="重新生成 — 核心矛盾"
          className="inline-flex items-center gap-1.5 h-8 px-3 rounded border border-outline-variant text-on-surface text-sm hover:bg-surface-container hover:border-primary disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          <span
            className={`material-symbols-outlined text-[16px]${regenerating ? " animate-spin" : ""}`}
            data-testid={regenerating ? "s0c-regenerate-spinner" : undefined}
          >
            {regenerating ? "progress_activity" : "refresh"}
          </span>
          重新生成
        </button>
      </div>
      {error && <div className="text-error text-sm">{error}</div>}
      {loading && (
        <div className="text-on-surface-variant">生成矛盾候选中...</div>
      )}
      {/* A previously-committed contradiction with an empty `statement`
          means the user confirmed one of the LLM-degraded candidates.
          The /contradict PUT endpoint now rejects empty statements, so
          the only way to reach this state is from a canvas_state.json
          written by an older backend. Prompt the user to re-pick. */}
      {initial && !initial.statement.trim() && (
        <div
          data-testid="warning-stale-empty-contradiction"
          className="bg-warning/10 border border-warning rounded-lg px-4 py-3 text-sm"
        >
          之前保存的核心矛盾内容为空,请重新选择一个候选项,或使用「自定义矛盾」手写。
        </div>
      )}
      {!loading && candidates.length > 0 &&
        candidates.every((c) => !c.preview_statement.trim()) && (
        <div
          data-testid="warning-contradiction-degraded"
          className="bg-warning/10 border border-warning rounded-lg px-4 py-3 text-sm"
        >
          AI 矛盾展开暂不可用,模板卡片无内容。请使用「自定义矛盾」手写。
        </div>
      )}
      <div className="grid grid-cols-1 gap-3">
        {candidates.map((c) => (
          <div
            key={c.template_type}
            data-testid={`candidate-${c.template_type}`}
            className={[
              "p-4 border rounded-lg cursor-pointer transition-colors",
              selected === c.template_type
                ? "border-primary bg-surface-container"
                : "border-outline-variant hover:border-primary",
            ].join(" ")}
            onClick={() => setSelected(c.template_type)}
          >
            <div className="flex justify-between items-center">
              <h3 className="font-medium">{c.template_type}</h3>
              <span
                className={["text-sm font-mono", tensionColor(c.tension_score)].join(
                  " ",
                )}
              >
                张力 {c.tension_score}
              </span>
            </div>
            <p className="text-sm text-on-surface-variant mt-2">
              {c.preview_statement}
            </p>
            <p className="text-xs text-on-surface-variant mt-1">
              {c.side_a} ⟷ {c.side_b}
            </p>
          </div>
        ))}
        <div
          data-testid={`candidate-${CUSTOM_KEY}`}
          className={[
            "p-4 border rounded-lg cursor-pointer transition-colors",
            selected === CUSTOM_KEY
              ? "border-primary bg-surface-container"
              : "border-outline-variant hover:border-primary",
          ].join(" ")}
          onClick={() => setSelected(CUSTOM_KEY)}
        >
          <h3 className="font-medium">自定义矛盾</h3>
          {selected === CUSTOM_KEY && (
            <textarea
              data-testid="custom-statement"
              placeholder="手写矛盾陈述"
              value={customStatement}
              onChange={(e) => setCustomStatement(e.target.value)}
              className="w-full mt-2 p-2 bg-surface-container border border-outline-variant rounded-lg text-primary text-sm placeholder:text-on-surface-variant/50 focus:outline-none focus:border-primary resize-none"
            />
          )}
        </div>
      </div>
      <div className="flex justify-between">
        <button
          data-testid="s0c-back"
          type="button"
          onClick={onBack}
          className="px-4 py-2 text-sm bg-surface-container rounded-lg"
        >
          上一步
        </button>
        <button
          data-testid="s0c-submit"
          type="button"
          disabled={!selected || loading}
          onClick={submit}
          className="px-5 py-2 bg-primary text-on-primary rounded-lg disabled:opacity-40"
        >
          下一步:展开叙事
        </button>
      </div>
      <RegenerateModal
        open={showRegenerateModal}
        target="核心矛盾"
        placeholder="例如:换一个矛盾方向 / 让张力更聚焦 / 加入现实压力层……"
        busy={regenerating}
        onConfirm={handleRegenerate}
        onCancel={() => setShowRegenerateModal(false)}
      />
    </div>
  );
}