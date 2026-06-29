import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import PreviewComparison from "../../../components/style/PreviewComparison";

describe("PreviewComparison", () => {
  it("renders the rendered text and stats when provided", () => {
    render(
      <PreviewComparison
        sourceText="原文内容"
        sourceAvgLength={32}
        renderedText="改写内容"
        renderedAvgLength={18}
      />,
    );
    expect(screen.getByText(/改写内容/)).toBeInTheDocument();
    expect(screen.getByText(/32\.0/)).toBeInTheDocument();
    expect(screen.getByText(/18\.0/)).toBeInTheDocument();
  });

  it("renders skipped reason when renderedText empty", () => {
    render(
      <PreviewComparison
        sourceText="原文内容"
        sourceAvgLength={32}
        renderedText=""
        renderedAvgLength={0}
        skippedReason="no router"
      />,
    );
    expect(screen.getByText(/no router/)).toBeInTheDocument();
  });
});
