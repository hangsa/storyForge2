import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import SideNavBar from "../components/layout/SideNavBar";

const noop = () => {};

describe("SideNavBar after workspace refactor", () => {
  it("does NOT list Stage1/2/3 entries", () => {
    render(
      <SideNavBar
        currentStage="WORKSPACE"
        onNavigate={noop}
        collapsed={false}
        width={240}
        onLiveWidthChange={noop}
        onCommitWidth={noop}
      />,
    );
    expect(screen.queryByText("概念讨论")).not.toBeInTheDocument();
    expect(screen.queryByText("世界观+角色")).not.toBeInTheDocument();
    expect(screen.queryByText("情节头脑风暴")).not.toBeInTheDocument();
  });

  // v1.8.1: workspace is now a top-level route (not nested in MainLayout), so
  // SideNavBar cannot link to it. The three WORKSPACE* entries were removed.
  it("does NOT list WORKSPACE / 全书诊断 / 导出中心 entries (workspace is top-level)", () => {
    render(
      <SideNavBar
        currentStage="WORKSPACE"
        onNavigate={noop}
        collapsed={false}
        width={240}
        onLiveWidthChange={noop}
        onCommitWidth={noop}
      />,
    );
    expect(screen.queryByText("工作台")).not.toBeInTheDocument();
    expect(screen.queryByText("全书诊断")).not.toBeInTheDocument();
    expect(screen.queryByText("导出中心")).not.toBeInTheDocument();
  });

  it("keeps the legacy nav targets (项目中心, 设置) reachable", () => {
    render(
      <SideNavBar
        currentStage="WORKSPACE"
        onNavigate={noop}
        collapsed={false}
        width={240}
        onLiveWidthChange={noop}
        onCommitWidth={noop}
      />,
    );
    expect(screen.getByText("项目中心")).toBeInTheDocument();
    expect(screen.getByText("设置")).toBeInTheDocument();
  });
});