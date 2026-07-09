import { useState } from "react";

const GENRES: Array<{ value: string; label: string }> = [
  { value: "cool_novel", label: "爽文" },
  { value: "xianxia", label: "仙侠" },
  { value: "xuanhuan", label: "玄幻" },
  { value: "dushi", label: "都市" },
  { value: "kehuan", label: "科幻" },
];

const LENGTHS: Array<{ value: number; label: string }> = [
  { value: 4000, label: "短篇" },
  { value: 10000, label: "中篇" },
  { value: 20000, label: "长篇" },
];

interface CreateProjectCardProps {
  onSubmit: (data: {
    intent: string;
    title?: string;
    genre: string;
    min_words: number;
  }) => Promise<void>;
  submitting: boolean;
  error: string | null;
}

export default function CreateProjectCard({ onSubmit, submitting, error }: CreateProjectCardProps) {
  const [intent, setIntent] = useState("");
  const [title, setTitle] = useState("");
  const [genre, setGenre] = useState("cool_novel");
  const [minWords, setMinWords] = useState(4000);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const submit = async () => {
    if (!intent.trim() || submitting) return;
    await onSubmit({
      intent: intent.trim(),
      title: title.trim() || undefined,
      genre,
      min_words: minWords,
    });
  };

  return (
    <section
      data-testid="create-project-card"
      className="bg-surface-container-low border border-outline-variant rounded-lg p-6 mb-8"
    >
      <div className="flex items-center gap-2 mb-4">
        <span className="material-symbols-outlined text-primary-container">rocket_launch</span>
        <h2 className="font-headline-md text-primary">新建项目</h2>
      </div>

      <div className="space-y-4">
        <div>
          <label className="block font-label-mono text-system-log mb-1 text-xs">
            创作意图 <span className="text-error">*</span>
          </label>
          <textarea
            data-testid="intent-input"
            value={intent}
            onChange={(e) => setIntent(e.target.value)}
            placeholder="例如：一个被家族抛弃的少年，在异世界觉醒了隐藏的血脉之力..."
            className="w-full h-28 bg-surface-container border border-outline-variant rounded-lg px-4 py-3
                       text-sm text-primary placeholder:text-system-log/50
                       focus:outline-none focus:border-primary-container resize-none"
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block font-label-mono text-system-log mb-1 text-xs">项目名称</label>
            <input
              data-testid="title-input"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={intent.slice(0, 30) || "可留空，自动从意图截取"}
              className="w-full bg-surface-container border border-outline-variant rounded-lg px-3 py-2
                         text-sm text-primary placeholder:text-system-log/50
                         focus:outline-none focus:border-primary-container"
            />
          </div>

          <div>
            <label className="block font-label-mono text-system-log mb-1 text-xs">题材模板</label>
            <select
              data-testid="genre-input"
              value={genre}
              onChange={(e) => setGenre(e.target.value)}
              className="w-full bg-surface-container border border-outline-variant rounded-lg px-3 py-2
                         text-sm text-primary focus:outline-none focus:border-primary-container"
            >
              {GENRES.map((g) => (
                <option key={g.value} value={g.value}>{g.label}</option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label className="block font-label-mono text-system-log mb-2 text-xs">目标篇幅</label>
          <div className="flex gap-2">
            {LENGTHS.map((l) => {
              const selected = minWords === l.value;
              return (
                <button
                  key={l.value}
                  type="button"
                  onClick={() => setMinWords(l.value)}
                  data-testid={`length-${l.label}`}
                  className={`flex-1 px-3 py-2 rounded-lg border text-sm transition-colors
                    ${selected
                      ? "border-primary-container bg-primary-container/10 text-primary"
                      : "border-outline-variant bg-surface-container text-system-log hover:text-primary"
                    }`}
                >
                  {l.label}
                  <span className="ml-1 text-xs font-label-mono text-system-log">
                    {l.value.toLocaleString()}
                  </span>
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
            className="flex items-center gap-1 text-xs font-label-mono text-system-log hover:text-primary"
          >
            <span className="material-symbols-outlined text-base">
              {showAdvanced ? "expand_less" : "expand_more"}
            </span>
            高级
          </button>
          {showAdvanced && (
            <div className="mt-2 grid grid-cols-2 gap-3 p-3 bg-surface-container rounded-lg">
              <div>
                <label className="block font-label-mono text-system-log mb-1 text-xs">章节数</label>
                <input
                  type="number"
                  value={Math.max(1, Math.round(minWords / 4000))}
                  disabled
                  className="w-full bg-surface-container-low border border-outline-variant rounded px-2 py-1 text-sm text-system-log/60"
                />
              </div>
              <div>
                <label className="block font-label-mono text-system-log mb-1 text-xs">每章字数</label>
                <input
                  type="number"
                  value={4000}
                  disabled
                  className="w-full bg-surface-container-low border border-outline-variant rounded px-2 py-1 text-sm text-system-log/60"
                />
              </div>
              <div className="col-span-2 text-[10px] font-label-mono text-system-log/60">
                自动按篇幅计算，后续可在工作台内调整
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

        <div className="flex justify-end pt-2">
          <button
            onClick={submit}
            disabled={!intent.trim() || submitting}
            data-testid="create-submit"
            className="px-5 py-2 bg-primary-container text-surface-container-low text-sm
                       rounded-lg hover:opacity-90 transition-opacity disabled:opacity-40"
          >
            {submitting ? "创建中…" : "建档并进入工作台"}
          </button>
        </div>
      </div>
    </section>
  );
}