import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SubTabStrip } from "../components/shared/SubTabStrip";

describe("SubTabStrip", () => {
  it("renders one tab button per tabs[] entry", () => {
    render(
      <SubTabStrip
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
      <SubTabStrip
        tabs={[{ key: "x", label: "X" }, { key: "y", label: "Y" }]}
        active="x"
        onChange={onChange}
        testidPrefix="t"
      />,
    );
    fireEvent.click(screen.getByTestId("t-y"));
    expect(onChange).toHaveBeenCalledWith("y");
  });

  // 2026-09-20 调整: ↻ 从 strip 上每个 tab label 后面的小图标,改到 sub-panel
  // 顶部右侧。SubTabStrip 自身不再 render ↻ 也不接收 onRegenerate。
  it("does not render ↻ inside any tab (moved to sub-panel header)", () => {
    render(
      <SubTabStrip
        tabs={[
          { key: "1", label: "Item 1" },
          { key: "2", label: "Item 2" },
        ]}
        active="1"
        onChange={() => {}}
        testidPrefix="r"
      />,
    );
    expect(screen.queryByTestId("r-1-regenerate")).not.toBeInTheDocument();
    expect(screen.queryByTestId("r-2-regenerate")).not.toBeInTheDocument();
  });

  it("uses testidSuffix when provided", () => {
    render(
      <SubTabStrip
        tabs={[{ key: "era_social_structure", label: "社会结构", testidSuffix: "social-structure" }]}
        active="era_social_structure"
        onChange={() => {}}
        testidPrefix="era"
      />,
    );
    expect(screen.getByTestId("era-social-structure")).toBeInTheDocument();
  });
});
