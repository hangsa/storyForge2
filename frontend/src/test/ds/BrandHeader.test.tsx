import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import BrandHeader from "../../components/ds/BrandHeader";

describe("BrandHeader", () => {
  it("renders brand name and tagline by default", () => {
    render(<BrandHeader brandName="Nebula Forge" />);
    expect(screen.getByText("Nebula Forge")).toBeInTheDocument();
    expect(screen.getByText("让你的灵感长出血肉")).toBeInTheDocument();
  });

  it("hides text content when collapsed", () => {
    render(<BrandHeader brandName="Nebula Forge" collapsed />);
    expect(screen.queryByText("Nebula Forge")).not.toBeInTheDocument();
    expect(screen.queryByText("让你的灵感长出血肉")).not.toBeInTheDocument();
    // Icon should still render
    expect(screen.getByText("auto_stories")).toBeInTheDocument();
  });

  it("uses a custom icon when iconName is provided", () => {
    render(<BrandHeader brandName="Nebula Forge" iconName="rocket_launch" />);
    expect(screen.getByText("rocket_launch")).toBeInTheDocument();
  });

  it("uses a custom tagline when provided", () => {
    render(<BrandHeader brandName="Nebula Forge" tagline="Hello world" />);
    expect(screen.getByText("Hello world")).toBeInTheDocument();
  });
});
