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
    <div
      data-testid="empty-state"
      className={`glass-panel rounded-xl p-xl space-y-lg mt-xl ${
        embedded ? "" : "max-w-2xl mx-auto"
      }`}
    >
      <div>
        <h2 className="font-headline-lg-mobile text-headline-lg-mobile font-bold text-on-surface">
          创造一个故事，不需要从完整故事开始。
        </h2>
        <p className="text-on-surface-variant font-body-md mt-sm">
          只需要告诉我：
          <br />
          「你脑子里现在有什么？」
        </p>
      </div>
      <textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        placeholder="一个关于……用一句话描述你脑子里的故事"
        rows={4}
        className="w-full bg-surface-container-high border border-outline-variant rounded-lg p-md
                   text-on-surface placeholder-on-surface-variant/50
                   focus:border-primary focus:outline-none transition-colors"
      />
      <div className="flex items-center gap-md">
        <label className="font-label-sm text-label-sm text-on-surface-variant uppercase">
          类型
        </label>
        <select
          value={genre}
          onChange={(e) => setGenre(e.target.value)}
          aria-label="题材"
          className="bg-surface-container-high border border-outline-variant rounded-lg
                     px-md py-xs text-on-surface focus:border-primary"
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
