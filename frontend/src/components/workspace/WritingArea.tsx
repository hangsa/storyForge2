import { useMemo } from "react";

export interface WritingCurrent {
  chapter_number: number;
  chapter_title: string;
  scene_id: string;
  scene_title: string;
  outline_summary?: string;
}

interface Props {
  current: WritingCurrent | null;
  content: string;
  onContentChange: (next: string) => void;
  onSaveDraft: () => Promise<void>;
  onRegenerate: () => Promise<void>;
  onFactGuard: () => Promise<void>;
  busy: boolean;
  /** Optional: scenario that's empty because the chapter has no outline yet */
  emptyStatePrompt?: string;
  /**
   * Optional: when set, the empty state renders a "前往生成大纲" button that
   * calls this. The page wires it to switch the right panel to the outline
   * tab (spec § WritingArea empty state).
   */
  onNavigateToOutline?: () => void;
}

export default function WritingArea({
  current, content, onContentChange, onSaveDraft, onRegenerate, onFactGuard, busy, emptyStatePrompt, onNavigateToOutline,
}: Props) {
  if (!current) {
    return (
      <div
        data-testid="writing-empty"
        className="h-full flex flex-col items-center justify-center text-center p-8 space-y-3"
      >
        <span className="material-symbols-outlined text-5xl text-system-log/30">edit_note</span>
        <p className="font-body-ui text-system-log">{emptyStatePrompt ?? "本章节尚未生成大纲"}</p>
        {onNavigateToOutline && (
          <button
            type="button"
            data-testid="writing-empty-go-to-outline"
            onClick={onNavigateToOutline}
            className="px-4 py-2 rounded-lg bg-tertiary-container text-surface-container-low hover:opacity-90"
          >
            前往生成大纲
          </button>
        )}
      </div>
    );
  }

  const wordCount = useMemo(
    () => content.replace(/\s+/g, "").length,
    [content],
  );

  return (
    <div data-testid="writing-area" className="h-full flex flex-col">
      <header className="px-6 py-3 border-b border-outline-variant">
        <div className="flex items-center gap-2 font-label-mono text-[10px] uppercase tracking-wider text-system-log">
          第 {current.chapter_number} 章
        </div>
        <h2 data-testid="writing-chapter-title" className="font-display text-primary text-lg">
          {current.chapter_title}
        </h2>
        <div data-testid="writing-scene-title" className="font-body-ui text-sm text-system-log mt-1">
          {current.scene_id} · {current.scene_title}
        </div>
        {current.outline_summary && (
          <p
            data-testid="writing-outline-summary"
            className="font-body-narrative text-xs text-system-log mt-2 italic"
          >
            大纲：{current.outline_summary}
          </p>
        )}
      </header>

      <textarea
        data-testid="editor-body"
        value={content}
        onChange={(e) => onContentChange(e.target.value)}
        className="flex-1 w-full p-6 bg-surface-container-lowest text-primary font-body-narrative text-base resize-none focus:outline-none"
        style={{ fontFamily: "Georgia, '宋体', serif", lineHeight: 1.8 }}
        spellCheck={false}
      />

      <footer className="flex items-center justify-between px-6 py-2 border-t border-outline-variant text-xs font-body-ui text-system-log">
        <span>
          字数 <span data-testid="editor-word-count">{wordCount}</span>
        </span>
        <div className="flex gap-2">
          <button
            type="button"
            data-testid="editor-regenerate"
            onClick={() => onRegenerate()}
            disabled={busy}
            className="px-3 py-1 rounded bg-surface-container hover:bg-surface-container-low disabled:opacity-40"
          >重新生成</button>
          <button
            type="button"
            data-testid="editor-fact-guard"
            onClick={() => onFactGuard()}
            disabled={busy}
            className="px-3 py-1 rounded bg-surface-container hover:bg-surface-container-low disabled:opacity-40"
          >Fact Guard</button>
          <button
            type="button"
            data-testid="editor-save"
            onClick={() => onSaveDraft()}
            disabled={busy}
            className="px-4 py-1 rounded bg-tertiary-container text-surface-container-low hover:opacity-90 disabled:opacity-40"
          >保存草稿</button>
        </div>
      </footer>
    </div>
  );
}
