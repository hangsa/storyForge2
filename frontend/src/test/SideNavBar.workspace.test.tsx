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

  it("lists 工作台, 全书诊断 → workspace diagnosis, 导出中心 → workspace export", () => {
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
    expect(screen.getByText("工作台")).toBeInTheDocument();
    expect(screen.getByText("全书诊断")).toBeInTheDocument();
    expect(screen.getByText("导出中心")).toBeInTheDocument();
  });

  it("clicking 工作台 calls onNavigate('WORKSPACE')", () => {
    const onNavigate = vi.fn();
    render(
      <SideNavBar
        currentStage="WORKSPACE"
        onNavigate={onNavigate}
        collapsed={false}
        width={240}
        onLiveWidthChange={noop}
        onCommitWidth={noop}
      />,
    );
    screen.getByText("工作台").click();
    expect(onNavigate).toHaveBeenCalledWith("WORKSPACE");
  });
});
