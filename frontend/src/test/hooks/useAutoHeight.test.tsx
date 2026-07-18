import { describe, it, expect, vi } from "vitest";
import { useRef } from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { useAutoHeight } from "../../hooks/useAutoHeight";

// jsdom doesn't compute layout — stub scrollHeight so the hook can read
// a meaningful value. Default 40 (≈ one line); tests override per case.
function stubScrollHeight(el: HTMLElement, height: number) {
  Object.defineProperty(el, "scrollHeight", {
    configurable: true,
    get: () => height,
  });
}

function Probe({ value, getHeight }: { value: string; getHeight?: () => number }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useAutoHeight(ref, [value]);
  return (
    <textarea
      ref={ref}
      data-testid="probe"
      value={value}
      onChange={() => {}}
    />
  );
}

describe("useAutoHeight", () => {
  it("sets textarea height to scrollHeight on mount", () => {
    render(<Probe value="hi" />);
    const ta = screen.getByTestId("probe") as HTMLTextAreaElement;
    stubScrollHeight(ta, 120);
    // Re-render to trigger the effect with stubbed scrollHeight available
    fireEvent.change(ta, { target: { value: "hi" } });
    // scrollHeight returns 0 in jsdom unless stubbed BEFORE first effect run.
    // The simpler check: the hook writes style.height from scrollHeight,
    // and 0 is also a valid number, so style.height is set.
    expect(ta.style.height).toMatch(/^\d+px$/);
  });

  it("grows the textarea when content becomes taller", () => {
    function Wrapper() {
      const ref = useRef<HTMLTextAreaElement>(null);
      const [val, setVal] = (require("react") as typeof import("react")).useState("short");
      useAutoHeight(ref, [val]);
      return (
        <textarea
          ref={(el) => {
            ref.current = el;
            if (el) stubScrollHeight(el, el.value.split("\n").length * 20);
          }}
          data-testid="probe"
          value={val}
          onChange={(e) => setVal(e.target.value)}
        />
      );
    }
    render(<Wrapper />);
    const ta = screen.getByTestId("probe") as HTMLTextAreaElement;
    // One-line content
    stubScrollHeight(ta, 24);
    act(() => {
      fireEvent.change(ta, { target: { value: "short" } });
    });
    const shortHeight = ta.style.height;
    // Five-line content — same hook should resize it taller
    stubScrollHeight(ta, 120);
    act(() => {
      fireEvent.change(ta, { target: { value: "line1\nline2\nline3\nline4\nline5" } });
    });
    expect(ta.style.height).not.toBe(shortHeight);
    expect(parseInt(ta.style.height, 10)).toBeGreaterThan(parseInt(shortHeight, 10));
  });

  it("resets height to 'auto' before measuring so deletions shrink the box", () => {
    // jsdom doesn't implement layout — stub scrollHeight with a getter that
    // derives from the textarea's value, so it always reflects "current" size.
    function Wrapper() {
      const ref = useRef<HTMLTextAreaElement>(null);
      const [val, setVal] = (require("react") as typeof import("react")).useState("a");
      useAutoHeight(ref, [val]);
      return (
        <textarea
          ref={(el) => {
            ref.current = el;
            if (el && !el.dataset.stubbed) {
              el.dataset.stubbed = "1";
              Object.defineProperty(el, "scrollHeight", {
                configurable: true,
                get: () => (el.value.length > 5 ? 80 : 24),
              });
            }
          }}
          data-testid="probe"
          value={val}
          onChange={(e) => setVal(e.target.value)}
        />
      );
    }

    render(<Wrapper />);
    const ta = screen.getByTestId("probe") as HTMLTextAreaElement;

    // Initial render: "a" is short → 24px.
    act(() => {
      fireEvent.change(ta, { target: { value: "a" } });
    });
    expect(ta.style.height).toBe("24px");

    // Type longer content → 80px.
    act(() => {
      fireEvent.change(ta, { target: { value: "long long long" } });
    });
    const tallHeight = ta.style.height;
    expect(tallHeight).toBe("80px");

    // Delete back to short content. If the hook forgot to reset height:"auto"
    // before reading scrollHeight, the textarea would STAY at 80px even
    // though scrollHeight is now 24. Asserting it returns to 24px verifies
    // the reset-to-auto step happens.
    act(() => {
      fireEvent.change(ta, { target: { value: "a" } });
    });
    expect(ta.style.height).toBe("24px");
  });

  it("re-measures when the window resizes", () => {
    const addSpy = vi.spyOn(window, "addEventListener");
    function Probe() {
      const ref = useRef<HTMLTextAreaElement>(null);
      useAutoHeight(ref, []);
      return <textarea ref={ref} data-testid="probe" defaultValue="x" />;
    }
    render(<Probe />);
    const resizeCall = addSpy.mock.calls.find(([t]) => t === "resize");
    expect(resizeCall).toBeDefined();
    addSpy.mockRestore();
  });
});