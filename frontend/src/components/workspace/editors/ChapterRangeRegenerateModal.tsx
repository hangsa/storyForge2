import { useEffect, useLayoutEffect, useRef, useState } from "react";

interface ChapterRangeRegenerateModalProps {
  open: boolean;
  chapterCount: number;
  onConfirm: (chapterStart: number, chapterEnd: number, userModifications: string) => Promise<void>;
  onCancel: () => void;
  busy?: boolean;
}

const MAX_LEN = 1700;

export default function ChapterRangeRegenerateModal({
  open,
  chapterCount,
  onConfirm,
  onCancel,
  busy = false,
}: ChapterRangeRegenerateModalProps) {
  const [start, setStart] = useState<string>("1");
  const [end, setEnd] = useState<string>(String(chapterCount));
  const [mods, setMods] = useState<string>("");
  const startInputRef = useRef<HTMLInputElement | null>(null);

  useLayoutEffect(() => {
    if (open) {
      setStart("1");
      setEnd(String(chapterCount));
      setMods("");
      startInputRef.current?.focus();
    }
  }, [open, chapterCount]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onCancel]);

  if (!open) return null;

  const startNum = Number(start);
  const endNum = Number(end);
  const valid =
    Number.isInteger(startNum) &&
    Number.isInteger(endNum) &&
    startNum >= 1 &&
    endNum <= chapterCount &&
    endNum >= startNum;

  const handleSubmit = () => {
    if (!valid) return;
    onConfirm(startNum, endNum, mods);
  };

  const handleKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="chapter-range-modal-title"
      className="fixed inset-0 z-50 flex items-start justify-center pt-20 bg-black/40"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        data-testid="chapter-range-modal"
        onClick={(e) => e.stopPropagation()}
        className="bg-surface-container-lowest rounded-lg shadow-xl w-[560px] max-w-[92vw] overflow-hidden"
      >
        <div className="px-6 pt-5 pb-3 border-b border-system-divider">
          <h2
            id="chapter-range-modal-title"
            className="font-display text-primary text-base font-semibold"
          >
            重新生成章节大纲
          </h2>
          <p
            data-testid="chapter-range-warning"
            className="font-body-ui text-system-log/80 text-xs mt-2 px-3 py-2 bg-yellow-100 border border-yellow-400 rounded"
          >
            ⚠ 已写章节不会自动重写或回填，请确认理解影响范围。
          </p>
        </div>

        <div className="px-6 py-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-body-ui text-system-log/70 text-xs font-medium mb-1.5">
                开始章节 (1 - {chapterCount})
              </label>
              <input
                ref={startInputRef}
                data-testid="chapter-range-start"
                type="number"
                min={1}
                max={chapterCount}
                value={start}
                disabled={busy}
                onChange={(e) => setStart(e.target.value)}
                className="w-full border border-system-divider rounded-md px-3 py-2 text-sm bg-surface-container text-system-log font-body-ui focus:outline-none focus:ring-2 focus:ring-primary-container/40"
              />
            </div>
            <div>
              <label className="block font-body-ui text-system-log/70 text-xs font-medium mb-1.5">
                结束章节 (1 - {chapterCount})
              </label>
              <input
                data-testid="chapter-range-end"
                type="number"
                min={1}
                max={chapterCount}
                value={end}
                disabled={busy}
                onChange={(e) => setEnd(e.target.value)}
                className="w-full border border-system-divider rounded-md px-3 py-2 text-sm bg-surface-container text-system-log font-body-ui focus:outline-none focus:ring-2 focus:ring-primary-container/40"
              />
            </div>
          </div>

          <div>
            <label className="block font-body-ui text-system-log/70 text-xs font-medium mb-1.5">
              修改意见 (可选)
            </label>
            <textarea
              data-testid="chapter-range-mods"
              value={mods}
              disabled={busy}
              onChange={(e) => setMods(e.target.value.slice(0, MAX_LEN))}
              onKeyDown={handleKey}
              maxLength={MAX_LEN}
              placeholder="例如:第7章节奏更紧凑 / 让伏笔更明显……"
              className="w-full h-[100px] border border-system-divider rounded-md px-3 py-2 text-sm resize-y focus:outline-none focus:ring-2 focus:ring-primary-container/40 bg-surface-container text-system-log font-body-ui"
            />
            <div className="mt-1 text-right font-body-ui text-system-log/50 text-[11px]">
              {mods.length} / {MAX_LEN}
            </div>
          </div>
        </div>

        <div className="px-6 py-3 bg-surface-container border-t border-system-divider flex items-center justify-between">
          <span className="font-body-ui text-system-log/50 text-[11px]">
            Esc 取消 · Cmd+Enter 提交
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              data-testid="chapter-range-cancel"
              onClick={onCancel}
              disabled={busy}
              className="px-4 py-1.5 text-sm border border-system-divider rounded-md hover:bg-surface-container-high text-system-log disabled:opacity-40"
            >
              取消
            </button>
            <button
              type="button"
              data-testid="chapter-range-confirm"
              onClick={handleSubmit}
              disabled={busy || !valid}
              className="inline-flex items-center justify-center gap-1.5 px-4 py-1.5 text-sm bg-primary-container text-surface-container-low rounded-md hover:opacity-90 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {busy ? "重新生成中…" : "重新生成"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}