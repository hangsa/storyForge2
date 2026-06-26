import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import ConfidenceBadge from "../../components/branch-simulation/ConfidenceBadge";

describe("ConfidenceBadge", () => {
  it("renders high confidence with green styling", () => {
    const { container } = render(<ConfidenceBadge confidence="high" />);
    expect(container.textContent).toContain("高置信度");
    expect(container.textContent).toContain("🟢");
    expect(container.querySelector("span")?.className).toContain("emerald");
  });

  it("renders medium confidence with amber styling", () => {
    const { container } = render(<ConfidenceBadge confidence="medium" />);
    expect(container.textContent).toContain("中置信度");
    expect(container.textContent).toContain("🟡");
    expect(container.querySelector("span")?.className).toContain("amber");
  });

  it("renders low confidence with orange styling", () => {
    const { container } = render(<ConfidenceBadge confidence="low" />);
    expect(container.textContent).toContain("低置信度");
    expect(container.textContent).toContain("🟠");
    expect(container.querySelector("span")?.className).toContain("orange");
  });
});
