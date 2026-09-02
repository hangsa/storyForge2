import { useState } from "react";
import api, { type IdeaVariant, type RawIntent } from "@/api/client";
import { RegenerateModal } from "../../shared/RegenerateModal";

interface Props {
  projectId: string;
  onComplete: (
    rawIntent: RawIntent,
    fusionVariant: IdeaVariant | null,
    fusionBanner: string | null,
  ) => void;
  initial?: RawIntent | null;
  /**
   * Called after a successful /diverge/regenerate/raw-intent call so the
   * parent re-reads canvas state and the new variants surface when the user
   * navigates to S0B. /regenerate/raw-intent clears downstream (variants /
   * contradiction / selected_path) and writes new idea_variants, so without
   * this callback the parent's DivergenceState.variants stays stale.
   */
  onCanvasMutated?: () => void;
}

const GENRES = [
  "修仙",
  "都市",
  "星际",
  "游戏",
  "历史",
  "军事",
  "体育",
  "校园",
  "悬疑",
  "奇幻",
];

export default function S0AInputStep({
  projectId,
  onComplete,
  initial,
  onCanvasMutated,
}: Props) {
  const [prompt, setPrompt] = useState(initial?.prompt || "");
  const [genrePrimary, setGenrePrimary] = useState(
    initial?.genre_primary || "",
  );
  const [genreSecondary, setGenreSecondary] = useState(
    initial?.genre_secondary || "",
  );
  const [enableFusion, setEnableFusion] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showRegenerateModal, setShowRegenerateModal] = useState(false);

  // canSubmit: prompt ≥10 + 主类型有值 + (勾选融合则副类型也必须有值)
  const canSubmit =
    prompt.trim().length >= 10 &&
    !!genrePrimary &&
    (!enableFusion || !!genreSecondary) &&
    !submitting;

  async function submit() {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const rawIntent: RawIntent = {
        prompt: prompt.trim(),
        genre_primary: genrePrimary,
        genre_secondary: genreSecondary || undefined,
      };
      await api.postDivergeInit(projectId, rawIntent);

      let fusionVariant: IdeaVariant | null = null;
      let fusionBanner: string | null = null;
      if (rawIntent.genre_secondary && enableFusion) {
        try {
          const fuseResp = await api.postDivergeFuse(projectId, {
            genre_primary: rawIntent.genre_primary,
            genre_secondary: rawIntent.genre_secondary,
            prompt: rawIntent.prompt,
          });
          fusionVariant = fuseResp.variants[0] ?? null;
        } catch (e) {
          fusionBanner = `类型融合未启用(${e instanceof Error ? e.message : "LLM 后端不可用"})`;
        }
      }

      onComplete(rawIntent, fusionVariant, fusionBanner);
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
      await api.postDivergeRegenerateRawIntent(projectId, {
        user_modifications: userModifications,
      });
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
        <h2 className="text-xl font-medium">灵感输入</h2>
        <button
          type="button"
          data-testid="s0a-regenerate"
          onClick={() => setShowRegenerateModal(true)}
          disabled={!initial || regenerating}
          aria-label="重新生成 — 灵感输入"
          className="inline-flex items-center gap-1.5 h-8 px-3 rounded border border-outline-variant text-on-surface text-sm hover:bg-surface-container hover:border-primary disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          <span
            className={`material-symbols-outlined text-[16px]${regenerating ? " animate-spin" : ""}`}
            data-testid={regenerating ? "s0a-regenerate-spinner" : undefined}
          >
            {regenerating ? "progress_activity" : "refresh"}
          </span>
          重新生成
        </button>
      </div>
      <textarea
        placeholder="用一句话描述你的故事想法"
        className="w-full h-44 p-3 bg-surface-container border border-outline-variant rounded-lg resize-none text-primary text-sm placeholder:text-on-surface-variant/50 focus:outline-none focus:border-primary"
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
      />
      <div className="flex justify-between text-xs text-on-surface-variant">
        <span>{prompt.length} 字</span>
        {prompt.length > 0 && prompt.length < 10 && (
          <span className="text-error">至少 10 字</span>
        )}
        {prompt.length > 1700 && (
          <span className="text-warning">超过 1700 字将被截断（后端硬上限）</span>
        )}
      </div>
      <div className="flex gap-3">
        <select
          data-testid="genre-primary"
          className="flex-1 p-2 bg-surface-container border border-outline-variant rounded-lg text-primary text-sm focus:outline-none focus:border-primary"
          value={genrePrimary}
          onChange={(e) => setGenrePrimary(e.target.value)}
        >
          <option value="">选择主类型</option>
          {GENRES.map((g) => (
            <option key={g} value={g}>
              {g}
            </option>
          ))}
        </select>
        <select
          data-testid="genre-secondary"
          className="flex-1 p-2 bg-surface-container border border-outline-variant rounded-lg text-primary text-sm focus:outline-none focus:border-primary"
          value={genreSecondary}
          onChange={(e) => setGenreSecondary(e.target.value)}
        >
          <option value="">副类型(可选)</option>
          {GENRES.filter((g) => g !== genrePrimary).map((g) => (
            <option key={g} value={g}>
              {g}
            </option>
          ))}
        </select>
      </div>
      {genreSecondary && (
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            data-testid="enable-fusion"
            checked={enableFusion}
            onChange={(e) => setEnableFusion(e.target.checked)}
          />
          <span>启用类型融合(计算 BFS 距离 + 风险等级,产出融合变体)</span>
        </label>
      )}
      {error && <div className="text-error text-sm">{error}</div>}
      <div className="flex justify-end">
        <button
          data-testid="s0a-submit"
          type="button"
          disabled={!canSubmit}
          onClick={submit}
          className="px-5 py-2 bg-primary text-on-primary rounded-lg disabled:opacity-40"
        >
          {submitting ? "提交中..." : "下一步:生成变体"}
        </button>
      </div>
      <RegenerateModal
        open={showRegenerateModal}
        target="灵感输入"
        placeholder="例如:换一个更悬疑的题材方向 / 加入科幻元素……"
        busy={regenerating}
        onConfirm={handleRegenerate}
        onCancel={() => setShowRegenerateModal(false)}
      />
    </div>
  );
}