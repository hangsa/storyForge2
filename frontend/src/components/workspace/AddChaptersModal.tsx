import { useEffect, useState } from "react";

export interface AddChaptersProgress {
  done: number;
  total: number;
}

interface AddChaptersModalProps {
  open: boolean;
  /**
   * Current max chapter number across outline.json. 0 if no chapters exist.
   * The modal starts the new range at currentMax+1 (auto-derived; not user-
   * editable) and lets the user pick where the range ends.
   */
  currentMax: number;
  /**
   * Planned total chapters parsed from novel_outline.json's volume
   * chapter_range. 0 means "no novel_outline yet" → modal falls back to a
   * default cap of "start+9" (so the default is 10 chapters and the user
   * is never permanently blocked).
   */
  plannedTotal: number;
  /**
   * While the parent's onConfirm promise is pending, the parent can
   * push progress via this prop. The modal shows "正在生成第 X / N 章"
   * and disables inputs.
   */
  progress: AddChaptersProgress | null;
  onCancel: () => void;
  /**
   * Invoked with the inclusive END chapter number. The parent computes
   * `count = end - currentMax` and generates chapters in
   * `[currentMax+1 .. end]`.
   */
  onConfirm: (end: number) => Promise<void> | void;
}

/** Default = "10 chapters from start", i.e. end = start + 9 (Bug 2 spec:
 *  "结束章节默认为开始章节+10" → end = start+10, so 11 chapters). We use
 *  `start+9` so the default covers exactly 10 chapters, matching the
 *  pre-Bug-2 default count. Both interpretations are within one chapter
 *  of each other; the cap message clarifies the actual range. */
const DEFAULT_END_OFFSET = 9;

/** Default cap when no novel_outline exists. 10 chapters from start (i.e.
 *  end = start + 9). Matches the previous "count default = 10" behavior. */
const DEFAULT_CAP_WHEN_UNPLANNED = 10;

/** Hand-rolled overlay (no UI library). Tailwind classes match the sibling
 *  modals (ModeSwitchConfirmModal / ManagedStartModal) so the workspace
 *  footer-button group feels coherent. */
export default function AddChaptersModal({
  open,
  currentMax,
  plannedTotal,
  progress,
  onCancel,
  onConfirm,
}: AddChaptersModalProps) {
  const start = currentMax + 1;
  // maxEnd: plannedTotal when known, otherwise a sensible default of
  // "10 chapters from start". When plannedTotal < start the project is
  // already at-cap — handled by the atCap branch below.
  const maxEnd = plannedTotal > 0 && plannedTotal >= start
    ? plannedTotal
    : plannedTotal > 0
      ? plannedTotal  // currentMax >= plannedTotal: at-cap branch handles
      : start + DEFAULT_CAP_WHEN_UNPLANNED - 1;
  const defaultEnd = Math.min(start + DEFAULT_END_OFFSET, maxEnd);

  // The end input stores a raw string (not a clamped number) so the user can
  // freely type, backspace, and clear-to-retype without the value silently
  // snapping to a clamp on every keystroke. Clamping happens only on blur
  // and at confirm time — pre-fix, every onChange handler call clamped the
  // value (typing "99" with maxEnd=20 silently became "20", backspace from
  // "12" became "11", clearing snapped back to the previous value), which
  // made the input feel unresponsive.
  const [endText, setEndText] = useState<string>(String(defaultEnd));

  // Reset input whenever the modal (re)opens so a stale value from a
  // previous attempt doesn't leak in.
  useEffect(() => {
    if (open) setEndText(String(defaultEnd));
  }, [open, defaultEnd]);

  if (!open) return null;

  const busy = progress !== null;
  const atCap = plannedTotal > 0 && currentMax >= plannedTotal;

  // Parse the raw input text into a clamped integer; returns null when the
  // text is empty or non-numeric (the user may legitimately be mid-edit).
  const parseEnd = (raw: string): number | null => {
    if (raw === "" || !/^\d+$/.test(raw)) return null;
    const v = Number(raw);
    if (!Number.isFinite(v)) return null;
    return Math.max(start, Math.min(Math.floor(v), maxEnd));
  };

  // What the on-screen input should display. During editing we show the raw
  // text verbatim (so backspace / typing feel natural); after blur we show
  // the clamped integer so the hint message ("本次将新增 N 章") stays in sync.
  const displayText = endText;

  // The integer value used by the confirm button + hint. While the field is
  // empty or invalid, fall back to the default so the confirm button stays
  // enabled with a sensible count, and the hint doesn't render "NaN 章".
  const endInt = parseEnd(endText);
  const effectiveEnd = endInt ?? defaultEnd;
  const count = Math.max(0, effectiveEnd - currentMax);

  const handleConfirm = async () => {
    if (atCap || busy) return;
    const clamped = parseEnd(endText);
    if (clamped === null) return;
    // Sync the visible text to the clamped value so re-opening the modal
    // doesn't show a stale string.
    setEndText(String(clamped));
    await onConfirm(clamped);
  };

  const handleEndBlur = () => {
    const clamped = parseEnd(endText);
    if (clamped === null) {
      // Empty / invalid → revert to the default. Avoid leaving the field
      // blank so the next on-screen read of `count` stays meaningful.
      setEndText(String(defaultEnd));
      return;
    }
    setEndText(String(clamped));
  };

  const handleEndChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    // Accept any non-negative digit string, including empty (so the user can
    // clear the field to retype). Reject negative signs, decimals, and
    // letters — they're not valid here.
    if (raw === "" || /^\d+$/.test(raw)) {
      setEndText(raw);
    }
  };

  return (
    <div
      data-testid="add-chapters-modal"
      className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
    >
      <div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-6 max-w-md w-full space-y-4">
        <header>
          <h2 className="font-display text-primary text-lg">+ 新章节</h2>
          <p className="font-body-ui text-system-log text-sm mt-1">
            接第 {currentMax} 章后开始
          </p>
        </header>

        {atCap ? (
          <div
            data-testid="add-chapters-cap-reached"
            className="p-3 bg-error-container/20 border border-error rounded text-error font-body-ui text-sm"
          >
            已达到全书大纲的上限（第 {plannedTotal} 章）。
          </div>
        ) : (
          <div className="space-y-2">
            <div className="flex items-end gap-2">
              <div className="flex-1">
                <label
                  htmlFor="add-chapters-start-display"
                  className="block font-label-mono text-system-log text-xs mb-1"
                >
                  从第
                </label>
                <div
                  id="add-chapters-start-display"
                  data-testid="add-chapters-start-display"
                  className="w-full bg-surface-container-low border border-outline-variant rounded-lg px-3 py-2 text-sm text-system-log"
                >
                  {start}
                </div>
              </div>
              <span className="font-body-ui text-system-log text-sm pb-2">章</span>
              <div className="flex-1">
                <label
                  htmlFor="add-chapters-end-input"
                  className="block font-label-mono text-system-log text-xs mb-1"
                >
                  到第
                </label>
                <input
                  id="add-chapters-end-input"
                  type="number"
                  data-testid="add-chapters-end-input"
                  min={start}
                  max={maxEnd}
                  value={displayText}
                  disabled={busy}
                  onChange={handleEndChange}
                  onBlur={handleEndBlur}
                  className="w-full bg-surface-container border border-outline-variant rounded-lg px-3 py-2 text-sm text-primary focus:outline-none focus:border-primary-container disabled:opacity-40"
                />
              </div>
              <span className="font-body-ui text-system-log text-sm pb-2">章</span>
            </div>
            <p data-testid="add-chapters-cap-hint" className="font-body-ui text-system-log/70 text-xs">
              {count > 0 ? `本次将新增 ${count} 章 · ` : "本次将新增 0 章 · "}
              范围 {start} - {maxEnd}
              {plannedTotal > 0 ? `（全书大纲上限 ${plannedTotal} 章）` : `（未设定全书大纲，默认上限 ${DEFAULT_CAP_WHEN_UNPLANNED} 章）`}
            </p>
          </div>
        )}

        {busy && (
          <div className="flex items-center gap-2 text-system-log text-sm font-body-ui">
            <span className="material-symbols-outlined text-primary-container animate-spin">progress_activity</span>
            <span data-testid="add-chapters-progress">
              正在生成第 {progress!.done} / {progress!.total} 章…
            </span>
          </div>
        )}

        <footer className="flex items-center justify-end gap-2 pt-2">
          <button
            type="button"
            data-testid="add-chapters-cancel"
            onClick={onCancel}
            disabled={busy}
            className="px-4 py-2 text-sm bg-surface-container text-system-log rounded-lg hover:bg-surface-container-low disabled:opacity-40"
          >
            取消
          </button>
          <button
            type="button"
            data-testid="add-chapters-confirm"
            onClick={handleConfirm}
            disabled={atCap || busy || effectiveEnd < start}
            className="px-5 py-2 text-sm bg-tertiary-container text-surface-container-low rounded-lg hover:opacity-90 disabled:opacity-40"
          >
            {busy ? "生成中…" : "确认添加"}
          </button>
        </footer>
      </div>
    </div>
  );
}
