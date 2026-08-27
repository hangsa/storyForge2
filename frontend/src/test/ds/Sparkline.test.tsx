import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import Sparkline from "../../components/ds/Sparkline";

describe("Sparkline", () => {
  it("renders nothing when data has fewer than 2 points", () => {
    const { container } = render(<Sparkline data={[]} />);
    expect(container.querySelector("svg")).toBeNull();

    render(<Sparkline data={[42]} />);
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("renders an svg path for >= 2 data points", () => {
    render(<Sparkline data={[1, 2, 3, 4]} testId="spark" />);
    const svg = screen.getByTestId("spark");
    expect(svg.tagName.toLowerCase()).toBe("svg");
    expect(svg.querySelector("path")).not.toBeNull();
  });

  it("filters non-finite values before computing the path", () => {
    render(<Sparkline data={[1, NaN, 3, Infinity, 4]} testId="spark" />);
    expect(screen.getByTestId("spark").querySelector("path")).not.toBeNull();
  });
});