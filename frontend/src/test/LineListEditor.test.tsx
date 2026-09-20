import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import LineListEditor from "../components/shared/LineListEditor";

describe("LineListEditor", () => {
  it("renders one textarea per item", () => {
    render(
      <LineListEditor
        items={["炼气", "筑基", "金丹"]}
        onItemsChange={() => {}}
        saving={false}
      />,
    );
    expect(screen.getByDisplayValue("炼气")).toBeInTheDocument();
    expect(screen.getByDisplayValue("筑基")).toBeInTheDocument();
    expect(screen.getByDisplayValue("金丹")).toBeInTheDocument();
  });

  it("renders empty-state copy and +添加一条 button when items=[]", () => {
    render(
      <LineListEditor items={[]} onItemsChange={() => {}} saving={false} />,
    );
    expect(screen.getByText("暂无")).toBeInTheDocument();
    expect(screen.getByTestId("linelist-add")).toBeInTheDocument();
  });

  it("clicking +添加一条 appends an empty string and fires onItemsChange", () => {
    const onChange = vi.fn();
    render(
      <LineListEditor items={["a"]} onItemsChange={onChange} saving={false} />,
    );
    fireEvent.click(screen.getByTestId("linelist-add"));
    expect(onChange).toHaveBeenCalledWith(["a", ""]);
  });

  it("editing a textarea fires onItemsChange with the new array", () => {
    const onChange = vi.fn();
    render(
      <LineListEditor items={["old"]} onItemsChange={onChange} saving={false} />,
    );
    const ta = screen.getByDisplayValue("old") as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: "new" } });
    expect(onChange).toHaveBeenCalledWith(["new"]);
  });

  it("clicking × removes that item", () => {
    const onChange = vi.fn();
    render(
      <LineListEditor
        items={["a", "b", "c"]}
        onItemsChange={onChange}
        saving={false}
      />,
    );
    fireEvent.click(screen.getByTestId("linelist-1-remove"));
    expect(onChange).toHaveBeenCalledWith(["a", "c"]);
  });

  it("disables +添加一条 and × buttons when saving=true", () => {
    render(
      <LineListEditor
        items={["a"]}
        onItemsChange={() => {}}
        saving={true}
      />,
    );
    expect(screen.getByTestId("linelist-add")).toBeDisabled();
    expect(screen.getByTestId("linelist-0-remove")).toBeDisabled();
  });

  it("uses AutoTextarea so textarea expands with content (rows hint >=1)", () => {
    const long = "line1\nline2\nline3";
    render(
      <LineListEditor items={[long]} onItemsChange={() => {}} saving={false} />,
    );
    const ta = screen.getByTestId("linelist-0-input") as HTMLTextAreaElement;
    expect(ta.tagName).toBe("TEXTAREA");
    // minRows=1 first-paint hint; AutoTextarea's useLayoutEffect resizes
    // post-mount which jsdom doesn't fully simulate, but rows attribute
    // tells us the contract.
    expect(parseInt(ta.getAttribute("rows") ?? "0", 10)).toBeGreaterThanOrEqual(1);
  });
});