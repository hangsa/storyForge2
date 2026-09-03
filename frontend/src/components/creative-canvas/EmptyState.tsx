import { useState } from "react";
import { PrimaryButton } from "@/components/ds";

interface Props {
  onInit?: (prompt: string, genre: string) => void;
  loading?: boolean;
  /**
   * When true (wizard-embedded mode), drop the max-w-2xl/mx-auto
   * centering so the panel fills the wizard's main area width —
   // matches the divergence surface layout (which is full-width
   // with no max-w constraint). Standalone mode keeps the centered
   * narrow look (max-w-2xl, ~672px).
   */
  embedded?: boolean;
}

const GENRES = ["仙侠", "科幻", "都市", "悬疑", "历史", "玄幻"];

export function EmptyState({ onInit, loading = false, embedded = false }: Props) {
  const [prompt, setPrompt] = useState("");
  const [genre, setGenre] = useState("xianxia");

  return (
    // Visual style aligned to the divergence wizard sub-steps (S0A etc.):
    // flat border panel + text-xl font-medium heading + bg-surface-container
    // inputs — keeps the canvas + divergence surfaces visually consistent
    // when both live inside the wizard main area.
    <div
      data-testid="empty-state"
      className={`border border-outline-variant rounded-lg p-6 space-y-4 ${
        embedded ? "" : "max-w-2xl mx-auto"
      }`}
    >
      <h2 className="text-xl font-medium text-on-surface">
        创造一个故事，不需要从完整故事开始。
      </h2>
      <p className="text-sm text-on-surface-variant">
        只需要告诉我：「你脑子里现在有什么？」
      </p>
      <textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        placeholder="一个关于……用一句话描述你脑子里的故事"
        rows={4}
        className="w-full p-3 bg-surface-container border border-outline-variant rounded-lg
                   resize-none text-primary text-sm
                   placeholder:text-on-surface-variant/50
                   focus:outline-none focus:border-primary transition-colors"
      />
      <div className="flex items-center gap-3">
        <label className="text-sm text-on-surface-variant">
          类型
        </label>
        <select
          value={genre}
          onChange={(e) => setGenre(e.target.value)}
          aria-label="题材"
          className="flex-1 p-2 bg-surface-container border border-outline-variant rounded-lg
                     text-primary text-sm focus:outline-none focus:border-primary"
        >
          {GENRES.map((g) => (
            <option key={g} value={g}>
              {g}
            </option>
          ))}
        </select>
      </div>
      <div className="flex justify-end">
        <PrimaryButton
          label={loading ? "初始化中..." : "开始创意推演 →"}
          onClick={() => onInit?.(prompt, genre)}
          disabled={loading || prompt.trim().length < 10}
          loading={loading}
        />
      </div>
      <details className="text-xs text-on-surface-variant/60">
        <summary className="cursor-pointer">查看示例 idea</summary>
        <ul className="list-disc list-inside space-y-1 mt-2">
          <li>修仙者活了 1000 年后想要死亡</li>
          <li>末世只剩一座图书馆和它的管理员</li>
          <li>一个能听懂动物说话但被所有人当成疯子的孩子</li>
        </ul>
      </details>
    </div>
  );
}
