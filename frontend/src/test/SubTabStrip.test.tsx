import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { __testing__ } from "../components/wizard/WorldStep";

describe("SubTabStrip", () => {
  it("renders one tab button per tabs[] entry", () => {
    render(
      <__testing__.SubTabStrip
        tabs={[
          { key: "a", label: "Tab A" },
          { key: "b", label: "Tab B" },
          { key: "c", label: "Tab C" },
        ]}
        active="b"
        onChange={() => {}}
        testidPrefix="test-strip"
      />,
    );
    expect(screen.getByTestId("test-strip-a")).toBeInTheDocument();
    expect(screen.getByTestId("test-strip-b")).toBeInTheDocument();
    expect(screen.getByTestId("test-strip-c")).toBeInTheDocument();
    // active 标记
    expect(screen.getByTestId("test-strip-a").getAttribute("aria-selected")).toBe("false");
    expect(screen.getByTestId("test-strip-b").getAttribute("aria-selected")).toBe("true");
  });

  it("calls onChange with the tab key on click", () => {
    const onChange = vi.fn();
    render(
      <__testing__.SubTabStrip
        tabs={[{ key: "x", label: "X" }, { key: "y", label: "Y" }]}
        active="x"
        onChange={onChange}
        testidPrefix="t"
      />,
    );
    fireEvent.click(screen.getByTestId("t-y"));
    expect(onChange).toHaveBeenCalledWith("y");
  });

  it("renders ↻ button per tab when onRegenerate is provided", () => {
    const onRegen = vi.fn();
    render(
      <__testing__.SubTabStrip
        tabs={[{ key: "1", label: "Item 1" }]}
        active="1"
        onChange={() => {}}
        onRegenerate={onRegen}
        testidPrefix="r"
      />,
    );
    const regen = screen.getByTestId("r-1-regenerate");
    expect(regen).toBeInTheDocument();
    fireEvent.click(regen);
    expect(onRegen).toHaveBeenCalledWith("1");
  });

  it("does not render ↻ when onRegenerate is undefined", () => {
    render(
      <__testing__.SubTabStrip
        tabs={[{ key: "1", label: "Item 1" }]}
        active="1"
        onChange={() => {}}
        testidPrefix="r"
      />,
    );
    expect(screen.queryByTestId("r-1-regenerate")).not.toBeInTheDocument();
  });

  it("disables ↻ when disabled=true", () => {
    render(
      <__testing__.SubTabStrip
        tabs={[{ key: "1", label: "Item 1" }]}
        active="1"
        onChange={() => {}}
        onRegenerate={() => {}}
        testidPrefix="r"
        disabled
      />,
    );
    const regen = screen.getByTestId("r-1-regenerate");
    expect(regen.getAttribute("aria-disabled")).toBe("true");
    expect(regen.getAttribute("tabindex")).toBe("-1");
  });

  it("uses testidSuffix when provided", () => {
    render(
      <__testing__.SubTabStrip
        tabs={[{ key: "era_social_structure", label: "社会结构", testidSuffix: "social-structure" }]}
        active="era_social_structure"
        onChange={() => {}}
        testidPrefix="era"
      />,
    );
    expect(screen.getByTestId("era-social-structure")).toBeInTheDocument();
  });

  it("does not call onRegenerate when disabled and ↻ is clicked", () => {
    const onRegen = vi.fn();
    render(
      <__testing__.SubTabStrip
        tabs={[{ key: "1", label: "Item 1" }]}
        active="1"
        onChange={() => {}}
        onRegenerate={onRegen}
        testidPrefix="r"
        disabled
      />,
    );
    const regen = screen.getByTestId("r-1-regenerate");
    fireEvent.click(regen);
    expect(onRegen).not.toHaveBeenCalled();
  });
});
