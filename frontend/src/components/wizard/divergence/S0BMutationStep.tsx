import { useEffect, useState } from "react";
import api, { type IdeaVariant, type RawIntent } from "@/api/client";
import { RegenerateModal } from "../../shared/RegenerateModal";

interface Props {
  projectId: string;
  rawIntent: RawIntent;
  initial?: IdeaVariant[];
  /**
   * IDs of variants the user previously selected before navigating away.
   * S0B initializes its Set from this so back-nav keeps the visual
   * selection (instead of every card looking un-picked on re-entry).
   * Filter to currently-shown variants on mount — orphaned IDs are dropped.
   */
  selectedIds?: string[];
  onComplete: (variants: IdeaVariant[], selectedIds: string[]) => void;
  onBack: () => void;
  /**
   * Called after a successful /diverge/regenerate/variants call so the
   * parent re-reads canvas state. /regenerate/variants clears core_
   * contradiction + selected_path on canvas, so the parent's stale values
   * need to drop.
   */
  onCanvasMutated?: () => void;
}

// MutationEngine.MutationOp valid values: inversion | fusion | escalation
// | subversion. /apply-mutation rejects FUSION (returns FUSION_NOT_SUPPORTED
// because fusion needs two source nodes — use /merge instead, which is a
// placeholder), so we drop it here. Each iteration dims its source, so the
// chain must feed the previous new_node.id into the next call. See
// backend/creative_diverge.py /apply-mutation.
const MUTATION_OPS = ["inversion", "escalation", "subversion"] as const;

function buildVariant(
  nodeId: string,
  newNode: Record<string, unknown>,
  mutationResult: Record<string, unknown>,
): IdeaVariant {
  const titleField = newNode.title;
  const premiseField = mutationResult.core_premise;
  const noveltyHook = mutationResult.novelty_hook;
  const operation = mutationResult.operation;
  return {
    id: String(newNode.id ?? nodeId),
    title:
      typeof titleField === "string" && titleField.length > 0
        ? titleField
        : typeof premiseField === "string"
          ? premiseField.slice(0, 24)
          : nodeId,
    premise_one_line: typeof premiseField === "string" ? premiseField : "",
    mutation_type: typeof operation === "string" ? operation : "unknown",
    mutation_logic: typeof noveltyHook === "string" ? noveltyHook : "",
    estimated_novelty:
      typeof newNode.novelty_score === "number" ? newNode.novelty_score : 0,
    trope_tags: Array.isArray(newNode.trope_tags)
      ? (newNode.trope_tags as string[])
      : [],
    regenerated_count: 0,
  };
}

export default function S0BMutationStep({
  projectId,
  rawIntent,
  initial,
  selectedIds,
  onComplete,
  onBack,
  onCanvasMutated,
}: Props) {
  const [variants, setVariants] = useState<IdeaVariant[]>(initial || []);
  // Rehydrate from `selectedIds` when the user navigates back from C/D/E
  // and the parent's DivergenceState still has the prior selection set.
  // Without this, every card looks un-picked on re-entry — the bug from
  // the 2026-09-01 back-nav regression list.
  //
  // Filter against the currently-shown variant IDs so orphaned IDs (e.g.
  // from a /regenerate/variants that minted new IDs between sessions)
  // don't inflate the counter while leaving no visible selection. The
  // counter and the highlighted cards must agree — otherwise the user
  // sees "已选 2 / 3" but no card is highlighted, which on back-nav from
  // Stage C reads as "I forgot which variants I picked".
  const [selected, setSelected] = useState<Set<string>>(() => {
    const visibleIds = new Set((initial ?? []).map((v) => v.id));
    return new Set((selectedIds ?? []).filter((id) => visibleIds.has(id)));
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [regenerating, setRegenerating] = useState(false);
  const [showRegenerateModal, setShowRegenerateModal] = useState(false);

  useEffect(() => {
    if (initial && initial.length > 0) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        // 1) Locate the root node from canvas state.
        const state = await api.getDivergeState(projectId);
        const rootId = state?.root_node_id as string | undefined;
        if (!rootId) throw new Error("画布尚未初始化,请先完成 Step A");

        // 2) Expand the root into depth-1 children. /expand sets only the
        //    first child active (c0); the others (c1, c2) are dimmed by
        //    /expand's invariant-5 pass.
        const expandResult = await api.postDivergeWhatIfExpand(projectId, rootId);
        const childIds = Object.keys(expandResult?.nodes ?? {});
        if (childIds.length === 0) {
          throw new Error("展开根节点失败,未生成子节点");
        }
        let cursorId = childIds[0];

        // 3) Apply each mutation op sequentially. /apply-mutation dims its
        //    source and sets the new sibling as the parent's active branch,
        //    so the next iteration must mutate the latest new_node.id —
        //    fan-out (Promise.all on the same source) would hit
        //    DIMMED_NODE_CANNOT_MUTATE on the 2nd call.
        const built: IdeaVariant[] = [];
        for (const op of MUTATION_OPS) {
          const r = await api.postDivergeMutate(projectId, {
            node_id: cursorId,
            operation: op,
          });
          built.push(buildVariant(cursorId, r.new_node, r.mutation_result));
          cursorId = String((r.new_node as { id?: unknown }).id ?? cursorId);
        }
        if (cancelled) return;
        setVariants(built);
      } catch (e: unknown) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "生成失败");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, rawIntent, initial]);

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else if (next.size < 3) {
        next.add(id);
      }
      return next;
    });
  }

  async function regenerate(variantId: string) {
    try {
      const result = await api.postDivergeMutateRegenerate(projectId, variantId);
      setVariants((prev) =>
        prev.map((v) => (v.id === variantId ? result.variant : v)),
      );
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "重新生成失败");
    }
  }

  async function handleRegenerateAll(userModifications: string) {
    setShowRegenerateModal(false);
    setRegenerating(true);
    setError(null);
    try {
      // /regenerate/variants re-runs the 3-op mutate chain against the
      // existing raw_intent and writes fresh idea_variants. Downstream
      // (core_contradiction, selected_path) is cleared on canvas.
      const result = await api.postDivergeRegenerateVariants(projectId, {
        user_modifications: userModifications,
      });
      // Update local state directly so the UI is consistent before the
      // parent's canvasVersion bump round-trips through getDivergeState.
      // Selection is cleared because the old IDs are gone.
      setVariants(result.variants);
      setSelected(new Set());
      onCanvasMutated?.();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "重新生成失败");
    } finally {
      setRegenerating(false);
    }
  }

  function submit() {
    if (selected.size === 0) return;
    const selectedVariants = variants.filter((v) => selected.has(v.id));
    onComplete(selectedVariants, Array.from(selected));
  }

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-medium">创意变体</h2>
        <button
          type="button"
          data-testid="s0b-regenerate"
          onClick={() => setShowRegenerateModal(true)}
          disabled={regenerating || loading}
          aria-label="重新生成 — 创意变体"
          className="inline-flex items-center gap-1.5 h-8 px-3 rounded border border-outline-variant text-on-surface text-sm hover:bg-surface-container hover:border-primary disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          <span
            className={`material-symbols-outlined text-[16px]${regenerating ? " animate-spin" : ""}`}
            data-testid={regenerating ? "s0b-regenerate-spinner" : undefined}
          >
            {regenerating ? "progress_activity" : "refresh"}
          </span>
          重新生成
        </button>
      </div>
      {error && <div className="text-error text-sm">{error}</div>}
      {loading && (
        <div className="text-on-surface-variant">生成变体中...</div>
      )}
      <div className="grid grid-cols-2 gap-4">
        {variants.map((v) => {
          const isSelected = selected.has(v.id);
          return (
            <div
              key={v.id}
              data-testid={`variant-card-${v.id}`}
              className={[
                "p-4 border rounded-lg cursor-pointer transition-colors",
                isSelected
                  ? "border-primary bg-surface-container"
                  : "border-outline-variant hover:border-primary",
              ].join(" ")}
              onClick={() => toggleSelect(v.id)}
            >
              <div className="flex justify-between items-start">
                <h3 className="font-medium">{v.title}</h3>
                <div className="flex flex-col items-end gap-1">
                  {/* Explicit "已选" badge — without this, the only signal
                      that a card is picked is a subtle border-color swap
                      (border-primary vs border-outline-variant). On back-nav
                      from Stage C the user reported they couldn't tell
                      which variants they'd originally picked, because the
                      border change is too easy to miss next to the gray
                      un-selected cards. The badge mirrors the Stage D "弃选"
                      pattern so the divergence wizard has consistent
                      affordances across stages. */}
                  {isSelected && (
                    <span
                      data-testid={`selected-badge-${v.id}`}
                      className="text-xs px-2 py-0.5 rounded bg-primary text-on-primary font-medium"
                    >
                      已选
                    </span>
                  )}
                  <span className="text-xs px-2 py-0.5 rounded bg-secondary-container text-on-secondary-container">
                    {v.mutation_type}
                  </span>
                </div>
              </div>
              <p className="text-sm text-on-surface-variant mt-2">
                {v.premise_one_line}
              </p>
              <div className="flex justify-between items-center mt-3 text-xs">
                <span className="text-on-surface-variant">
                  新颖度 {(v.estimated_novelty * 100).toFixed(0)}%
                </span>
                <button
                  data-testid={`regen-${v.id}`}
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    regenerate(v.id);
                  }}
                  className="text-primary hover:underline"
                >
                  再生成
                </button>
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex justify-between">
        <button
          data-testid="s0b-back"
          type="button"
          onClick={onBack}
          className="px-4 py-2 text-sm bg-surface-container rounded-lg"
        >
          上一步
        </button>
        <div className="flex items-center gap-3">
          <span className="text-sm text-on-surface-variant">
            已选 {selected.size} / 3
          </span>
          <button
            data-testid="s0b-submit"
            type="button"
            disabled={selected.size === 0}
            onClick={submit}
            className="px-5 py-2 bg-primary text-on-primary rounded-lg disabled:opacity-40"
          >
            下一步:选择矛盾
          </button>
        </div>
      </div>
      <RegenerateModal
        open={showRegenerateModal}
        target="创意变体"
        placeholder="例如:让变体之间的差异更明显 / 加入更多反转 / 减少套路感……"
        busy={regenerating}
        onConfirm={handleRegenerateAll}
        onCancel={() => setShowRegenerateModal(false)}
      />
    </div>
  );
}