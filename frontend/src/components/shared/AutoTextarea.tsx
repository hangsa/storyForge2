import {
  forwardRef,
  useLayoutEffect,
  useRef,
  useState,
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
 * 2026-09-20 fix: the previous scrollHeight-based approach was unreliable on
 * long single-line Chinese strings (no `\n`) that wrap to multiple visual
 * lines — scrollHeight reported the wrong value on first paint and the
 * textarea stayed at minRows height, truncating the wrapped content.
 *
 * New approach: combine two resize triggers.
 *   1. **DOM mirror element** — clone the textarea's styles into an
 *      off-screen `<div>` with the same width/font/padding/border, then
 *      measure its height. The mirror always reports the natural content
 *      height regardless of textarea state, so we never get stuck in the
 *      "px height locks scrollHeight" loop.
 *   2. **ResizeObserver on the textarea itself** — when fonts load, when
 *      the container width changes (sidebar collapse, window resize), the
 *      textarea's content re-flows; ResizeObserver fires and we re-measure.
 *
 * useLayoutEffect keeps the height correct before paint, no flash.
 */
export const AutoTextarea = forwardRef<HTMLTextAreaElement, AutoTextareaProps>(
  ({ minRows = 2, rows, value, defaultValue, ...rest }, forwardedRef) => {
    const innerRef = useRef<HTMLTextAreaElement>(null);
    const mirrorRef = useRef<HTMLDivElement | null>(null);
    // Force a re-render once on mount so useLayoutEffect can read layout
    // — without this, the first measurement happens before the textarea
    // has been laid out (particularly under React 18 StrictMode's
    // mount-unmount-remount cycle), returning 0.
    const [, forceTick] = useState(0);

    const setRefs = (el: HTMLTextAreaElement | null) => {
      innerRef.current = el;
      if (typeof forwardedRef === "function") forwardedRef(el);
      else if (forwardedRef) forwardedRef.current = el;
    };

    useLayoutEffect(() => {
      forceTick((n) => n + 1);
    }, []);

    useLayoutEffect(() => {
      const ta = innerRef.current;
      if (!ta) return;
      // Build (or reuse) the mirror element. It lives in the DOM but
      // position:absolute + visibility:hidden so it doesn't paint or affect
      // layout. Width tracks the textarea's actual rendered width.
      let mirror = mirrorRef.current;
      if (!mirror) {
        mirror = document.createElement("div");
        mirror.setAttribute("aria-hidden", "true");
        Object.assign(mirror.style, {
          position: "absolute",
          top: "0",
          left: "-9999px",
          visibility: "hidden",
          whiteSpace: "pre-wrap",
          wordWrap: "break-word",
          pointerEvents: "none",
        });
        document.body.appendChild(mirror);
        mirrorRef.current = mirror;
      }
      const cs = window.getComputedStyle(ta);
      // Copy every layout-affecting property from the textarea to the mirror.
      const props: Array<keyof CSSStyleDeclaration> = [
        "fontFamily", "fontSize", "fontWeight", "fontStyle", "letterSpacing",
        "textTransform", "textIndent", "paddingTop", "paddingRight",
        "paddingBottom", "paddingLeft", "borderTopWidth", "borderRightWidth",
        "borderBottomWidth", "borderLeftWidth", "boxSizing", "lineHeight",
        "tabSize",
      ];
      for (const p of props) {
        // @ts-expect-error: index assignment to CSSStyleDeclaration
        mirror.style[p] = cs[p];
      }
      mirror.style.width = `${ta.clientWidth}px`;
      // Replace newlines with explicit \n so <br>/whitespace pre-wrap reflects
      // the textarea's exact content. Trailing newline pushes an extra row in
      // textareas, so mirror that.
      mirror.textContent = (ta.value || "") + (ta.value.endsWith("\n") ? " " : "");

      const target = mirror.scrollHeight;
      ta.style.height = `${target}px`;
    }, [value, defaultValue]);

    // Re-measure when the textarea's own size changes (window resize, sidebar
    // collapse, font load completing). ResizeObserver fires after layout so
    // mirror.scrollHeight is trustworthy.
    useLayoutEffect(() => {
      const ta = innerRef.current;
      if (!ta || typeof ResizeObserver === "undefined") return;
      const ro = new ResizeObserver(() => {
        const mirror = mirrorRef.current;
        if (!mirror) return;
        mirror.style.width = `${ta.clientWidth}px`;
        ta.style.height = `${mirror.scrollHeight}px`;
      });
      ro.observe(ta);
      return () => ro.disconnect();
    }, []);

    // Cleanup the mirror on unmount.
    useLayoutEffect(() => {
      const mirror = mirrorRef.current;
      return () => {
        if (mirror && mirror.parentNode) mirror.parentNode.removeChild(mirror);
        mirrorRef.current = null;
      };
    }, []);

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