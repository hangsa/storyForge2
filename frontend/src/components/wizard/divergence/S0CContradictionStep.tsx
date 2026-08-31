import { useEffect, useState } from "react";
import api, {
  type ContradictionCandidate,
  type CoreContradiction,
  type IdeaVariant,
} from "@/api/client";

interface Props {
  projectId: string;
  variants: IdeaVariant[];
  initial?: CoreContradiction | null;
  onComplete: (core: CoreContradiction) => void;
  onBack: () => void;
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
  onComplete,
  onBack,
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

  useEffect(() => {
    if (initial) return;
    if (variants.length === 0) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const primary = variants[0];
        const result = await api.postDivergeContradict(projectId, {
          variant_id: primary.id,
          variant_content: primary.premise_one_line,
        });
        if (cancelled) return;
        setCandidates(result.candidates);
        if (result.candidates.length > 0 && !selected) {
          setSelected(result.candidates[0].template_type);
        }
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, variants, initial]);

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

  return (
    <div className="p-6 space-y-4">
      <h2 className="text-xl font-medium">核心矛盾</h2>
      {error && <div className="text-error text-sm">{error}</div>}
      {loading && (
        <div className="text-on-surface-variant">生成矛盾候选中...</div>
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
              className="w-full mt-2 p-2 border border-outline-variant rounded-lg"
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
    </div>
  );
}