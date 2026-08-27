import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import DropdownSelect from "../../components/ds/DropdownSelect";

const OPTIONS = [
  { value: "all", label: "全部题材" },
  { value: "xuanhuan", label: "玄幻" },
  { value: "yanqing", label: "言情" },
];

describe("DropdownSelect", () => {
  it("renders the label and current value", () => {
    render(
      <DropdownSelect label="题材" options={OPTIONS} value="xuanhuan" onChange={() => {}} />
    );
    expect(screen.getByText("题材")).toBeInTheDocument();
    expect(screen.getByText("玄幻")).toBeInTheDocument();
  });

  it("opens options when clicked", () => {
    render(<DropdownSelect label="题材" options={OPTIONS} value="all" onChange={() => {}} />);
    expect(screen.queryByText("玄幻")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByText("玄幻")).toBeInTheDocument();
    expect(screen.getByText("言情")).toBeInTheDocument();
  });

  it("fires onChange when an option is picked", () => {
    const onChange = vi.fn();
    render(<DropdownSelect label="题材" options={OPTIONS} value="all" onChange={onChange} />);
    fireEvent.click(screen.getByRole("button"));
    fireEvent.click(screen.getByText("言情"));
    expect(onChange).toHaveBeenCalledWith("yanqing");
  });

  it("closes the dropdown after a selection", () => {
    render(<DropdownSelect label="题材" options={OPTIONS} value="all" onChange={() => {}} />);
    fireEvent.click(screen.getByRole("button"));
    fireEvent.click(screen.getByText("言情"));
    expect(screen.queryByText("玄幻")).not.toBeInTheDocument();
  });
});