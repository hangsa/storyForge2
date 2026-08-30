import { useState } from "react";
import { useGenres } from "../../hooks/useGenres";
import { DEFAULT_LENGTH_INDEX, LENGTH_CATEGORIES } from "../ds";

// Per-chapter target is uniform across all length options — see CLAUDE.md
// for context. Total word count is what differentiates the three categories.
const WORDS_PER_CHAPTER = 2000;

const LENGTHS = LENGTH_CATEGORIES;

interface CreateProjectModalProps {
  isOpen: boolean;
  submitting: boolean;
  error: string | null;
  onSubmit: (data: {
    title: string;
    genre: string;
    min_words: number;
    target_total_words: number;
    target_length_category: string;
  }) => Promise<void>;
  onClose: () => void;
}

export default function CreateProjectModal({
  isOpen,
  submitting,
  error,
  onSubmit,
  onClose,
}: CreateProjectModalProps) {
  const genres = useGenres(true);
  const [title, setTitle] = useState("");
  const [genre, setGenre] = useState("cool_novel");
  const [lengthIdx, setLengthIdx] = useState(DEFAULT_LENGTH_INDEX); // default: 标准商业连载
  const [showAdvanced, setShowAdvanced] = useState(false);

  if (!isOpen) return null;

  const selectedLength = LENGTHS[lengthIdx];
  const targetTotalWords = selectedLength.value;
  const chapterCount = Math.max(1, Math.round(targetTotalWords / WORDS_PER_CHAPTER));

  const submit = async () => {
    if (!title.trim() || submitting) return;
    await onSubmit({
      title: title.trim(),
      genre,
      min_words: WORDS_PER_CHAPTER,
      target_total_words: targetTotalWords,
      target_length_category: selectedLength.label,
    });
  };

  return (
    <div
      data-testid="create-project-modal"
      className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-8"
    >
      <div className="bg-surface-container-lowest border border-outline-variant rounded-lg w-full max-w-2xl max-h-[90vh] flex flex-col">
        <header className="px-6 py-4 flex items-center justify-between border-b border-outline-variant">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-primary">rocket_launch</span>
            <h2 className="font-display text-title-md text-primary">新建项目</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭"
            data-testid="create-project-close"
            className="text-on-surface-variant hover:text-primary"
          >
            <span className="material-symbols-outlined">close</span>
          </button>
        </header>

        <div className="p-6 space-y-4 overflow-y-auto">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block font-mono text-on-surface-variant mb-1 text-xs">
                项目名称 <span className="text-error">*</span>
              </label>
              <input
                data-testid="title-input"
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="为这个项目起一个名字"
                className="w-full bg-surface-container border border-outline-variant rounded-lg px-3 py-2
                           text-sm text-primary placeholder:text-on-surface-variant/50
                           focus:outline-none focus:border-primary"
              />
            </div>

            <div>
              <label className="block font-mono text-on-surface-variant mb-1 text-xs">题材模板</label>
              <select
                data-testid="genre-input"
                value={genre}
                onChange={(e) => setGenre(e.target.value)}
                className="w-full bg-surface-container border border-outline-variant rounded-lg px-3 py-2
                           text-sm text-primary focus:outline-none focus:border-primary"
              >
                {genres.map((g) => (
                  <option key={g.id} value={g.id}>{g.label_zh}</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block font-mono text-on-surface-variant mb-2 text-xs">目标篇幅</label>
            <div className="flex gap-2">
              {LENGTHS.map((l, i) => {
                const selected = lengthIdx === i;
                return (
                  <button
                    key={l.label}
                    type="button"
                    onClick={() => setLengthIdx(i)}
                    data-testid={`length-${l.label}`}
                    className={`flex-1 px-3 py-2 rounded-lg border text-sm transition-colors
                      ${selected
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-outline-variant bg-surface-container text-on-surface-variant hover:text-primary"
                      }`}
                  >
                    <div>{l.label}</div>
                    <div className="text-[11px] font-mono text-on-surface-variant mt-0.5">
                      {l.totalLabel}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <button
              type="button"
              onClick={() => setShowAdvanced((v) => !v)}
              data-testid="advanced-toggle"
              className="flex items-center gap-1 text-xs font-mono text-on-surface-variant hover:text-primary"
            >
              <span className="material-symbols-outlined text-base">
                {showAdvanced ? "expand_less" : "expand_more"}
              </span>
              高级
            </button>
            {showAdvanced && (
              <div className="mt-2 grid grid-cols-2 gap-3 p-3 bg-surface-container rounded-lg">
                <div>
                  <label className="block font-mono text-on-surface-variant mb-1 text-xs">章节数</label>
                  <input
                    type="number"
                    value={chapterCount}
                    disabled
                    className="w-full bg-surface-container-low border border-outline-variant rounded px-2 py-1 text-sm text-on-surface-variant/60"
                  />
                </div>
                <div>
                  <label className="block font-mono text-on-surface-variant mb-1 text-xs">每章字数</label>
                  <input
                    type="number"
                    value={WORDS_PER_CHAPTER}
                    disabled
                    className="w-full bg-surface-container-low border border-outline-variant rounded px-2 py-1 text-sm text-on-surface-variant/60"
                  />
                </div>
                <div className="col-span-2 text-[10px] font-mono text-on-surface-variant/60">
                  章节数 = 目标总字数 ÷ 每章字数；后续可在工作台内调整
                </div>
              </div>
            )}
          </div>

          {error && (
            <div
              data-testid="create-error"
              className="p-2 bg-error-container/20 border border-error rounded text-error text-xs"
            >
              {error}
            </div>
          )}
        </div>

        <footer className="px-6 py-4 flex justify-end gap-3 border-t border-outline-variant">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm text-on-surface-variant hover:text-primary"
          >
            取消
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!title.trim() || submitting}
            data-testid="create-submit"
            className="px-5 py-2 bg-primary text-on-primary text-sm
                       rounded-lg hover:opacity-90 transition-opacity disabled:opacity-40"
          >
            {submitting ? "创建中…" : "建档并进入工作台"}
          </button>
        </footer>
      </div>
    </div>
  );
}