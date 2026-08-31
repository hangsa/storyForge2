import { useEffect, useState } from "react";
import api, { type IdeaVariant, type RawIntent } from "@/api/client";

interface Props {
  projectId: string;
  rawIntent: RawIntent;
  initial?: IdeaVariant[];
  onComplete: (variants: IdeaVariant[]) => void;
  onBack: () => void;
}

// Backend returns one node per mutate call; fan out to a small fixed set of
// mutation operations to build a small selectable pool.
const MUTATION_OPS = ["inversion", "fusion", "escalation", "constraint"] as const;

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
  onComplete,
  onBack,
}: Props) {
  const [variants, setVariants] = useState<IdeaVariant[]>(initial || []);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (initial && initial.length > 0) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        // Fan out parallel mutate calls; the backend returns one variant per call.
        const calls = MUTATION_OPS.map((op, idx) =>
          api.postDivergeMutate(projectId, {
            node_id: `seed_${idx}`,
            operation: op,
          }),
        );
        const results = await Promise.all(calls);
        if (cancelled) return;
        const built = results.map((r, idx) =>
          buildVariant(`v${idx + 1}`, r.new_node, r.mutation_result),
        );
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

  function submit() {
    if (selected.size === 0) return;
    const selectedVariants = variants.filter((v) => selected.has(v.id));
    onComplete(selectedVariants);
  }

  return (
    <div className="p-6 space-y-4">
      <h2 className="text-xl font-medium">创意变体</h2>
      {error && <div className="text-error text-sm">{error}</div>}
      {loading && (
        <div className="text-on-surface-variant">生成变体中...</div>
      )}
      <div className="grid grid-cols-2 gap-4">
        {variants.map((v) => (
          <div
            key={v.id}
            data-testid={`variant-card-${v.id}`}
            className={[
              "p-4 border rounded-lg cursor-pointer transition-colors",
              selected.has(v.id)
                ? "border-primary bg-surface-container"
                : "border-outline-variant hover:border-primary",
            ].join(" ")}
            onClick={() => toggleSelect(v.id)}
          >
            <div className="flex justify-between items-start">
              <h3 className="font-medium">{v.title}</h3>
              <span className="text-xs px-2 py-0.5 rounded bg-secondary-container text-on-secondary-container">
                {v.mutation_type}
              </span>
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
        ))}
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
    </div>
  );
}