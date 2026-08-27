import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import SearchInput from "../../components/ds/SearchInput";

describe("SearchInput", () => {
  it("renders with controlled value", () => {
    render(<SearchInput value="hello" onChange={() => {}} />);
    expect(screen.getByDisplayValue("hello")).toBeInTheDocument();
  });

  it("uses default placeholder '搜索项目…' when placeholder prop is omitted", () => {
    render(<SearchInput value="" onChange={() => {}} />);
    expect(screen.getByPlaceholderText("搜索项目…")).toBeInTheDocument();
  });

  it("fires onChange when the user types", () => {
    const onChange = vi.fn();
    render(<SearchInput value="" onChange={onChange} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "x" } });
    expect(onChange).toHaveBeenCalledWith("x");
  });

  it("uses a custom placeholder when provided", () => {
    render(<SearchInput value="" placeholder="搜索…" onChange={() => {}} />);
    expect(screen.getByPlaceholderText("搜索…")).toBeInTheDocument();
  });
});