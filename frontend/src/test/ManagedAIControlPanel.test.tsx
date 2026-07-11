import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import ManagedAIControlPanel from "../components/workspace/ManagedAIControlPanel";

describe("ManagedAIControlPanel", () => {
  it("renders all four tabs", () => {
    render(<ManagedAIControlPanel />);
    expect(screen.getByTestId("ai-tab-decisions")).toBeInTheDocument();
    expect(screen.getByTestId("ai-tab-queue")).toBeInTheDocument();
    expect(screen.getByTestId("ai-tab-checks")).toBeInTheDocument();
    expect(screen.getByTestId("ai-tab-intervene")).toBeInTheDocument();
  });

  it("'决策流' is the default active tab", () => {
    render(<ManagedAIControlPanel />);
    expect(screen.getByTestId("ai-tab-decisions").className).toContain("border-primary-container");
    expect(screen.getByTestId("ai-decisions-list")).toBeInTheDocument();
  });

  it("clicking each tab swaps the panel content", () => {
    render(<ManagedAIControlPanel />);
    fireEvent.click(screen.getByTestId("ai-tab-queue"));
    expect(screen.getByTestId("ai-queue-list")).toBeInTheDocument();
    expect(screen.queryByTestId("ai-decisions-list")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("ai-tab-checks"));
    expect(screen.getByTestId("ai-checks-list")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("ai-tab-intervene"));
    expect(screen.getByTestId("ai-intervene-actions")).toBeInTheDocument();
  });

  it("intervene tab shows disabled action buttons (no real autopilot yet)", () => {
    render(<ManagedAIControlPanel />);
    fireEvent.click(screen.getByTestId("ai-tab-intervene"));
    const pause = screen.getByTestId("action-pause");
    const stop = screen.getByTestId("action-stop");
    const rollback = screen.getByTestId("action-rollback");
    expect(pause).toBeDisabled();
    expect(stop).toBeDisabled();
    expect(rollback).toBeDisabled();
  });
});
