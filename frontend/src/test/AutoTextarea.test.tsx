import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { useRef } from "react";
import { AutoTextarea } from "../components/shared/AutoTextarea";

describe("AutoTextarea", () => {
  it("renders a textarea with the passed rows attribute as first-paint hint", () => {
    render(<AutoTextarea rows={5} data-testid="ta" value="" onChange={() => {}} />);
    expect(screen.getByTestId("ta").getAttribute("rows")).toBe("5");
  });

  it("falls back to minRows when rows is omitted", () => {
    render(<AutoTextarea minRows={3} data-testid="ta" value="" onChange={() => {}} />);
    expect(screen.getByTestId("ta").getAttribute("rows")).toBe("3");
  });

  it("defaults minRows to 2 when neither rows nor minRows is passed", () => {
    render(<AutoTextarea data-testid="ta" value="" onChange={() => {}} />);
    expect(screen.getByTestId("ta").getAttribute("rows")).toBe("2");
  });

  it("passes through value and onChange", () => {
    const onChange = vi.fn();
    render(<AutoTextarea data-testid="ta" value="hello" onChange={onChange} />);
    const ta = screen.getByTestId("ta") as HTMLTextAreaElement;
    expect(ta.value).toBe("hello");
    fireEvent.change(ta, { target: { value: "world" } });
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("passes through arbitrary textarea attributes (className, placeholder, disabled)", () => {
    render(
      <AutoTextarea
        data-testid="ta"
        value=""
        onChange={() => {}}
        placeholder="enter text"
        disabled
        className="w-full resize-y"
      />,
    );
    const ta = screen.getByTestId("ta") as HTMLTextAreaElement;
    expect(ta.placeholder).toBe("enter text");
    expect(ta).toBeDisabled();
    expect(ta.className).toContain("w-full");
    expect(ta.className).toContain("resize-y");
  });

  it("forwards refs to the underlying textarea element via a callback ref", () => {
    const refCallback = vi.fn();
    render(
      <AutoTextarea
        ref={refCallback}
        data-testid="ta"
        value=""
        onChange={() => {}}
      />,
    );
    expect(refCallback).toHaveBeenCalledTimes(1);
    const el = refCallback.mock.calls[0][0] as HTMLTextAreaElement;
    expect(el).not.toBeNull();
    expect(el.tagName).toBe("TEXTAREA");
    expect(el.getAttribute("data-testid")).toBe("ta");
  });

  it("forwards refs via a ref object", () => {
    function Harness() {
      const ref = useRef<HTMLTextAreaElement>(null);
      return <AutoTextarea ref={ref} data-testid="ta" value="" onChange={() => {}} />;
    }
    const { rerender } = render(<Harness />);
    // After mount the ref must point at the textarea DOM node.
    const ta = screen.getByTestId("ta") as HTMLTextAreaElement;
    expect(ta.tagName).toBe("TEXTAREA");
    rerender(<Harness />);
    // Re-render should keep the ref pointing at the same element (no
    // "Function components cannot be given refs" warning).
    expect(ta.tagName).toBe("TEXTAREA");
  });

  it("uses defaultValue when value is not provided (uncontrolled mode)", () => {
    render(
      <AutoTextarea data-testid="ta" defaultValue="init" onChange={() => {}} />,
    );
    expect((screen.getByTestId("ta") as HTMLTextAreaElement).value).toBe("init");
  });

  it("auto-grows height: sets inline style.height after mount so long content isn't clipped", () => {
    // jsdom doesn't lay out, so scrollHeight is 0 — but the effect must still
    // run and set style.height. The presence of an inline style.height is what
    // distinguishes AutoTextarea from a plain <textarea rows={2}> (which never
    // sets style.height). Regression test for: OutlineStep volume summary /
    // milestone desc / plot desc switching from <textarea rows={2}> back to a
    // fixed-height element, which clipped LLM-generated multi-line content.
    const longContent = "a".repeat(500);
    const { rerender } = render(
      <AutoTextarea data-testid="ta" value="" onChange={() => {}} />,
    );
    const ta = screen.getByTestId("ta") as HTMLTextAreaElement;
    expect(ta.style.height).toBe("0px");
    rerender(
      <AutoTextarea data-testid="ta" value={longContent} onChange={() => {}} />,
    );
    expect(ta.style.height).toBe("0px");
    const taWithMockedScroll = screen.getByTestId("ta") as HTMLTextAreaElement;
    Object.defineProperty(taWithMockedScroll, "scrollHeight", {
      configurable: true,
      value: 137,
    });
    rerender(
      <AutoTextarea data-testid="ta" value={longContent + "x"} onChange={() => {}} />,
    );
    expect(taWithMockedScroll.style.height).toBe("137px");
  });
});