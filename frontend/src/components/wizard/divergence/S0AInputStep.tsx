import { useState } from "react";
import api, { type RawIntent } from "@/api/client";

interface Props {
  projectId: string;
  onComplete: (rawIntent: RawIntent) => void;
  initial?: RawIntent | null;
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
}: Props) {
  const [prompt, setPrompt] = useState(initial?.prompt || "");
  const [genrePrimary, setGenrePrimary] = useState(
    initial?.genre_primary || "",
  );
  const [genreSecondary, setGenreSecondary] = useState(
    initial?.genre_secondary || "",
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit =
    prompt.trim().length >= 10 && !!genrePrimary && !submitting;

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
      await api.postDivergeInit(projectId, rawIntent.prompt);
      onComplete(rawIntent);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "提交失败");
      setSubmitting(false);
    }
  }

  return (
    <div className="p-6 space-y-4">
      <h2 className="text-xl font-medium">灵感输入</h2>
      <textarea
        placeholder="用一句话描述你的故事想法"
        className="w-full h-32 p-3 border border-outline-variant rounded-lg resize-none"
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
      />
      <div className="flex justify-between text-xs text-on-surface-variant">
        <span>{prompt.length} 字</span>
        {prompt.length > 0 && prompt.length < 10 && (
          <span className="text-error">至少 10 字</span>
        )}
        {prompt.length > 200 && (
          <span className="text-warning">超过 200 字将自动摘要</span>
        )}
      </div>
      <div className="flex gap-3">
        <select
          data-testid="genre-primary"
          className="flex-1 p-2 border border-outline-variant rounded-lg"
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
          className="flex-1 p-2 border border-outline-variant rounded-lg"
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
      {error && <div className="text-error text-sm">{error}</div>}
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
  );
}