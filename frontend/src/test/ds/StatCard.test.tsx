import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import StatCard from "../../components/ds/StatCard";

describe("StatCard", () => {
  it("renders label and value", () => {
    render(<StatCard label="总字数" value={45200} />);
    expect(screen.getByText("总字数")).toBeInTheDocument();
    expect(screen.getByText("45200")).toBeInTheDocument();
  });

  it("renders an em-dash when value is null", () => {
    render(<StatCard label="总字数" value={null} />);
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("appends the unit suffix when provided", () => {
    render(<StatCard label="字数" value={45.2} unit="w" />);
    expect(screen.getByText("45.2w")).toBeInTheDocument();
  });

  it("uses compact styling when size is sm", () => {
    const { container } = render(<StatCard label="字数" value={100} size="sm" />);
    // size="sm" → value rendered as text-base rather than text-stats-number
    const valueEl = container.querySelector(".text-base");
    expect(valueEl).toBeTruthy();
  });
});
