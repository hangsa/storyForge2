import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import Stage4Drawer from "../../../components/stage4/Stage4Drawer";

const counts = { precheck: 2, impact: 0, exemption: 1, sfLogSuggestions: 3 };
const children = {
  precheck: <div data-testid="precheck">P</div>,
  impact: <div data-testid="impact">I</div>,
  exemption: <div data-testid="exemption">E</div>,
  sfLogSuggestions: <div data-testid="sfLogSuggestions">S</div>,
};

describe("Stage4Drawer", () => {
  it("renders4TabsWithLabels", () => {
    render(
      <Stage4Drawer counts={counts} activeTab={null} onTabChange={() => {}} onCollapse={() => {}}>
        {children}
      </Stage4Drawer>
    );
    // Labels come from DRAWER_TAB_LABELS.
    expect(screen.getByRole("tab", { name: /预检 2/ })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /影响/ })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /豁免 1/ })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /SF_LOG 建议 3/ })).toBeInTheDocument();
  });

  it("rendersBadgeCountsFromProps", () => {
    render(
      <Stage4Drawer counts={counts} activeTab={null} onTabChange={() => {}} onCollapse={() => {}}>
        {children}
      </Stage4Drawer>
    );
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("peekState_showsStripOnly", () => {
    render(
      <Stage4Drawer counts={counts} activeTab={null} onTabChange={() => {}} onCollapse={() => {}}>
        {children}
      </Stage4Drawer>
    );
    // No tabpanel is rendered in peek state.
    expect(screen.queryByRole("tabpanel")).not.toBeInTheDocument();
  });

  it("expandedState_showsActivePanel", () => {
    render(
      <Stage4Drawer counts={counts} activeTab="precheck" onTabChange={() => {}} onCollapse={() => {}}>
        {children}
      </Stage4Drawer>
    );
    const panel = screen.getByRole("tabpanel");
    expect(panel).toBeInTheDocument();
    expect(panel).toContainElement(screen.getByTestId("precheck"));
  });

  it("clickingTab_callsOnTabChange", () => {
    const cb = vi.fn();
    render(
      <Stage4Drawer counts={counts} activeTab={null} onTabChange={cb} onCollapse={() => {}}>
        {children}
      </Stage4Drawer>
    );
    fireEvent.click(screen.getByRole("tab", { name: /豁免 1/ }));
    expect(cb).toHaveBeenCalledWith("exemption");
  });

  it("clickingHeader_callsOnCollapse", () => {
    const cb = vi.fn();
    render(
      <Stage4Drawer counts={counts} activeTab="precheck" onTabChange={() => {}} onCollapse={cb}>
        {children}
      </Stage4Drawer>
    );
    fireEvent.click(screen.getByRole("button", { name: /收起/ }));
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("EscapeKey_callsOnCollapse", () => {
    const cb = vi.fn();
    render(
      <Stage4Drawer counts={counts} activeTab="precheck" onTabChange={() => {}} onCollapse={cb}>
        {children}
      </Stage4Drawer>
    );
    fireEvent.keyDown(document, { key: "Escape" });
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("arrowKey_cyclesTabs", () => {
    const cb = vi.fn();
    render(
      <Stage4Drawer counts={counts} activeTab="precheck" onTabChange={cb} onCollapse={() => {}}>
        {children}
      </Stage4Drawer>
    );
    const firstTab = screen.getByRole("tab", { name: /预检 2/ });
    firstTab.focus();
    fireEvent.keyDown(firstTab, { key: "ArrowRight" });
    expect(cb).toHaveBeenCalledWith("impact");
  });
});