import {
  forwardRef,
  useLayoutEffect,
  useRef,
  type TextareaHTMLAttributes,
} from "react";

export interface AutoTextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  /**
   * Minimum number of visible rows. Acts as both the browser's first-paint
   * height hint (via the `rows` attribute) and the floor for auto-resize —
   * an empty textarea still renders at least this tall.
   */
  minRows?: number;
}

/**
 * <textarea> that auto-resizes its height to fit its content.
 *
 * Uses useLayoutEffect so the height is correct before paint — no flash of
 * a too-short textarea when the wizard first opens with LLM-generated text
 * longer than the default `rows={2}` would show. Re-runs on every value
 * change so user typing (controlled textareas re-render the parent) also
 * keeps the height in sync.
 *
 * If `rows` is passed explicitly it's used as the first-paint hint and the
 * resize effect still takes over once mounted.
 */
export const AutoTextarea = forwardRef<HTMLTextAreaElement, AutoTextareaProps>(
  ({ minRows = 2, rows, value, defaultValue, ...rest }, forwardedRef) => {
    const innerRef = useRef<HTMLTextAreaElement>(null);
    // Merge forwarded ref so parents can read scrollHeight / focus, while we
    // still have our own handle for the layout effect.
    const setRefs = (el: HTMLTextAreaElement | null) => {
      innerRef.current = el;
      if (typeof forwardedRef === "function") forwardedRef(el);
      else if (forwardedRef) forwardedRef.current = el;
    };

    useLayoutEffect(() => {
      const el = innerRef.current;
      if (!el) return;
      // Reset to auto first so scrollHeight reflects the natural content
      // height (otherwise setting height to a px value would lock
      // scrollHeight to that value).
      el.style.height = "auto";
      el.style.height = `${el.scrollHeight}px`;
    }, [value, defaultValue]);

    return (
      <textarea
        ref={setRefs}
        rows={rows ?? minRows}
        value={value}
        defaultValue={defaultValue}
        {...rest}
      />
    );
  },
);
AutoTextarea.displayName = "AutoTextarea";