import { useEffect, type RefObject } from "react";

/**
 * Auto-resize a <textarea> to fit its current content (scrollHeight).
 *
 * Why: the workspace right-panel editors (concept/world/character/outline)
 * hold free-form Chinese paragraphs that range from a single sentence to
 * hundreds of words. Fixed `rows={N}` either wastes vertical space when
 * content is short or hides overflow when content is long, forcing the
 * user to drag-resize. This hook makes the box fit whatever's typed in
 * it, so a single sentence renders as one line and a long summary
 * expands to show everything without an internal scrollbar.
 *
 * Behavior:
 *  - Runs after every render whose dep list contains the provided deps,
 *    so the textarea follows user typing in real time.
 *  - Re-runs on window resize (the available width may have changed,
 *    wrapping height with it).
 *  - Resets `style.height` to `"auto"` first so deleting text actually
 *    SHRINKS the box (otherwise the box stays at its last tall height).
 *  - Does NOT cap the height. Very long content legitimately needs a
 *    very tall box; the surrounding scroll container takes over.
 *
 * Pass `[]` as deps when you want the effect to run only on mount +
 * window resize (rare; usually you pass `[value]`).
 */
export function useAutoHeight(
  ref: RefObject<HTMLTextAreaElement | null>,
  deps: ReadonlyArray<unknown>,
): void {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onResize = () => {
      el.style.height = "auto";
      el.style.height = `${el.scrollHeight}px`;
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [ref]);
}