import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import WorkspaceLayout from "../components/workspace/WorkspaceLayout";

describe("WorkspaceLayout", () => {
  it("renders managed slots (left, right) when mode=managed", () => {
    render(
      <WorkspaceLayout
        mode="managed"
        left={<div data-testid="l">L</div>}
        center={<div data-testid="c">C</div>}
        right={<div data-testid="r">R</div>}
      />,
    );
    expect(screen.getByTestId("l")).toBeInTheDocument();
    expect(screen.queryByTestId("c")).not.toBeInTheDocument();
    expect(screen.getByTestId("r")).toBeInTheDocument();
  });

  it("renders manual slots (left, center, right) when mode=manual", () => {
    render(
      <WorkspaceLayout
        mode="manual"
        left={<div data-testid="l">L</div>}
        center={<div data-testid="c">C</div>}
        right={<div data-testid="r">R</div>}
      />,
    );
    expect(screen.getByTestId("l")).toBeInTheDocument();
    expect(screen.getByTestId("c")).toBeInTheDocument();
    expect(screen.getByTestId("r")).toBeInTheDocument();
  });
});
