import { useEffect, useState } from "react";
import api, { Concept } from "../../api/client";
import { useWizard } from "./WizardContext";

type Variant = {
  id: string; label: string; title: string; description: string;
  tags: string[]; created_at: string;
};

interface CreativeDivergenceStepProps {
  projectId: string;
}

export default function CreativeDivergenceStep({ projectId }: CreativeDivergenceStepProps) {
  const wizard = useWizard();
  const [variants, setVariants] = useState<Variant[]>([]);
  const [prompt, setPrompt] = useState("");
  const [tone, setTone] = useState("惊悚");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.listCreativeDivergenceVariants(projectId)
      .then((r) => {
        // Defensive: backend can return a non-object payload when the route
        // 404s (request() unwraps {"detail":"Not Found"} → "Not Found", or
        // returns null on an empty body). Reading .variants on a string/null
        // throws "Cannot read properties of undefined (reading 'length')"
        // downstream in the render. Without this guard, navigating to
        // /project/:id/workspace?tab=settings with the prefill router prefix
        // mismatch (bug filed separately) crashes the entire settings tab.
        const list = r && typeof r === "object" && Array.isArray((r as { variants?: unknown }).variants)
          ? (r as { variants: Variant[] }).variants
          : [];
        if (!cancelled) setVariants(list);
      })
      .catch(() => { /* empty list is fine */ });
    return () => { cancelled = true; };
  }, [projectId]);

  const handleGenerate = async () => {
    if (!prompt.trim() || busy) return;
    setBusy(true); setError(null);
    try {
      const r = await api.generateCreativeDivergenceVariants(projectId, { prompt, count: 4, params: { tone } });
      // Defensive: a 200 response with the wrong shape (e.g. proxy unwrapped
      // {"detail": "..."} or backend schema drift) used to crash the entire
      // settings tab — setVariants(undefined) → next render reads .length.
      // Per spec §6, a failed generate must surface a banner and preserve the
      // user's prompt; we keep the existing variants too.
      if (!r || !Array.isArray(r.variants)) {
        setError("生成失败：响应格式异常，请重试或换一个提示词。");
        return;
      }
      setVariants(r.variants);
      // Default-select the first variant so the "确认选中并继续" button is
      // enabled. The card row already shows the first variant as visually
      // active via the `selectedId === null && i === 0` fallback, but the
      // confirm button is disabled when selectedId is null — without this
      // default the user has to click a card before confirm becomes usable,
      // which contradicts the visual "first card highlighted by default".
      setSelectedId(r.variants[0]?.id ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleConfirm = async () => {
    if (!selectedId || busy) return;
    setBusy(true); setError(null);
    try {
      const r = await api.selectCreativeDivergenceVariant(projectId, selectedId);
      // Defensive: same pattern as handleGenerate — a missing concept_payload
      // (schema drift, empty proxy pass-through) used to throw on .title and
      // crash the entire settings tab. Bail with a banner instead of jumping
      // to step 2 with broken state.
      const cp = r && typeof r === "object" ? r.concept_payload : null;
      if (!cp || typeof cp !== "object") {
        setError("选中失败：响应格式异常，请重试。");
        return;
      }
      // Backend returns a partial Concept (6 fields). Fill the rest with empty
      // strings so the downstream ConceptStep can hydrate without type errors;
      // the user edits them there before saving.
      const concept: Concept = {
        title: typeof cp.title === "string" ? cp.title : "",
        genre: typeof cp.genre === "string" ? cp.genre : "",
        premise: typeof cp.premise === "string" ? cp.premise : "",
        tone: typeof cp.tone === "string" ? cp.tone : "",
        theme: typeof cp.theme === "string" ? cp.theme : "",
        target_audience: "",
        style_template: "",
        // Preserve the provenance fields the backend writes so ConceptStep
        // can show the "由创意发散自动生成，可手动修改" banner (Task 14).
        // Without these, ConceptStep would never see source="creative_divergence"
        // and the banner would never appear.
        source: cp.source,
        source_variant_id: cp.source_variant_id,
      };
      wizard.markStepGenerated(1, {
        creative_divergence: { variants, selected_id: selectedId },
        concept,
      });
      wizard.jumpToStep(2);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div data-testid="creative-divergence-step" className="flex flex-col gap-lg">
      <header className="flex flex-col gap-xs">
        <h2 className="font-display-lg text-display-lg text-on-surface">创意发散</h2>
        <p className="font-body-lg text-body-lg text-on-surface-variant">为你的叙事生成主题钩子和概念起点。在此处填写你的创作意图。</p>
      </header>

      <section className="glass-panel rounded-xl p-md flex flex-col gap-sm relative">
        <div className="absolute inset-0 bg-primary/5 rounded-xl pointer-events-none" />
        <label className="font-label-sm text-label-sm text-primary uppercase tracking-wider flex items-center gap-xs" htmlFor="prompt-input">
          <span className="material-symbols-outlined text-[16px]">edit_note</span>
          创作意图 <span className="text-error normal-case">*</span>
        </label>
        <textarea
          id="prompt-input"
          data-testid="cd-prompt"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          className="w-full bg-surface-container-high border border-outline-variant rounded-lg p-sm text-on-surface font-body-md min-h-[120px] focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all resize-none placeholder-outline"
          placeholder="例如：一个被家族抛弃的少年，在异世界觉醒了隐藏的血脉之力…"
        />
        <div className="flex justify-between items-center mt-xs">
          <div className="flex gap-sm">
            <button type="button" className="flex items-center gap-xs px-sm py-2 rounded-lg bg-surface-container-high border border-outline-variant text-on-surface-variant hover:text-on-surface hover:border-outline transition-colors text-label-sm font-label-sm">
              <span className="material-symbols-outlined text-[18px]">tune</span>参数设置
            </button>
            <button type="button" onClick={() => setTone(tone === "惊悚" ? "温暖" : "惊悚")}
                    className="flex items-center gap-xs px-sm py-2 rounded-lg bg-surface-container-high border border-outline-variant text-on-surface-variant hover:text-on-surface hover:border-outline transition-colors text-label-sm font-label-sm">
              <span className="material-symbols-outlined text-[18px]">style</span>语气：{tone}
            </button>
          </div>
          <button data-testid="cd-generate" type="button" onClick={handleGenerate} disabled={busy || !prompt.trim()}
                  className="bg-primary text-on-primary px-lg py-2 rounded-lg font-title-md text-title-md flex items-center gap-xs hover:bg-primary-container transition-colors shadow-[0_0_15px_rgba(142,213,255,0.3)] disabled:opacity-50">
            {busy ? "生成中…" : "生成概念"}
            <span className="material-symbols-outlined">arrow_forward</span>
          </button>
        </div>
      </section>

      {error && (
        <div data-testid="cd-error" className="px-md py-2 rounded-lg bg-error-container/30 text-error text-body-md">
          {error}
        </div>
      )}

      <section className="flex flex-col gap-md">
        <div className="flex items-center justify-between border-b border-outline-variant pb-sm">
          <h3 className="font-title-md text-title-md text-on-surface flex items-center gap-xs">
            <span className="material-symbols-outlined text-primary">auto_awesome</span>
            生成的创意方向
          </h3>
          <span className="font-label-sm text-label-sm text-on-surface-variant">已有 {variants.length} 个变体</span>
        </div>

        {variants.length === 0 ? (
          <p className="font-body-md text-body-md text-on-surface-variant py-lg text-center">
            暂无变体 — 点生成开始创意发散
          </p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-md">
            {variants.map((v, i) => {
              const active = selectedId === v.id || (selectedId === null && i === 0);
              return (
                <button key={v.id} type="button" data-testid={`cd-variant-${v.id}`}
                        onClick={() => setSelectedId(v.id)}
                        className={`text-left glass-panel rounded-xl p-md flex flex-col gap-md transition-all duration-300 ${active ? "border-primary/50 glow-active bg-surface-container-highest" : "border border-outline-variant hover:border-primary/50 hover:bg-surface-container-highest"}`}>
                  <div className="flex justify-between items-start">
                    <span className={`px-xs py-1 rounded text-[10px] uppercase font-label-sm tracking-wider border ${active ? "bg-primary/20 text-primary border-primary/30" : "bg-surface-container-high text-on-surface-variant border-outline-variant"}`}>
                      {v.label}
                    </span>
                  </div>
                  <div>
                    <h4 className="font-headline-lg-mobile text-headline-lg-mobile text-on-surface mb-xs">{v.title}</h4>
                    <p className="font-body-md text-body-md text-on-surface-variant line-clamp-3">{v.description}</p>
                  </div>
                  {Array.isArray(v.tags) && v.tags.length > 0 && (
                    <div className="mt-auto pt-sm border-t border-outline-variant flex flex-wrap gap-2">
                      {v.tags.map((t) => (
                        <span key={t} className="px-2 py-1 bg-surface-container text-on-surface-variant rounded text-[10px] font-label-sm border border-outline-variant">{t}</span>
                      ))}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </section>

      {variants.length > 0 && (
        <div className="flex justify-end">
          <button data-testid="cd-confirm" type="button" onClick={handleConfirm} disabled={!selectedId || busy}
                  className="bg-primary text-on-primary px-lg py-2 rounded-lg font-title-md text-title-md hover:bg-primary-container transition-colors disabled:opacity-50">
            确认选中并继续
          </button>
        </div>
      )}
    </div>
  );
}
