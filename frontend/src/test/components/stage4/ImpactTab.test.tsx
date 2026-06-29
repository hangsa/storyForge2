import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import ImpactTab from "../../../components/stage4/ImpactTab";
import type { ImpactReport } from "../../../hooks/useStage4Impact";

const report: ImpactReport = {
  items: [
    { priority: "P0", file: "storyos/conflicts.json", description: "主线冲突升级" },
    { priority: "P1", file: "characters/林峰.yaml", description: "角色状态变化" },
    { priority: "P2", file: "chapters/c3.md", description: "节奏调整" },
    { priority: "P2", file: "chapters/c4.md", description: "新伏笔" },
  ],
};

describe("ImpactTab", () => {
  it("rendersPriorityCounts", () => {
    render(<ImpactTab report={report} loading={false} error={null} onRun={() => {}} onViewFull={() => {}} />);
    expect(screen.getByText("P0")).toBeInTheDocument();
    // P1 and P2 also rendered as counts.
    expect(screen.getAllByText(/P[012]/).length).toBeGreaterThan(0);
  });

  it("rendersTop3Items", () => {
    render(<ImpactTab report={report} loading={false} error={null} onRun={() => {}} onViewFull={() => {}} />);
    // Only the first 3 items are shown in the compact view.
    expect(screen.getByText(/storyos\/conflicts.json/)).toBeInTheDocument();
    expect(screen.getByText(/characters\/林峰.yaml/)).toBeInTheDocument();
    expect(screen.getByText(/chapters\/c3.md/)).toBeInTheDocument();
    expect(screen.queryByText(/chapters\/c4.md/)).not.toBeInTheDocument();
  });

  it("noReport_runButton_callsOnRun", () => {
    const cb = vi.fn();
    render(<ImpactTab report={null} loading={false} error={null} onRun={cb} onViewFull={() => {}} />);
    fireEvent.click(screen.getByText(/分析影响/));
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("existingReport_rerunAndViewFullButtons", () => {
    const onRun = vi.fn();
    const onViewFull = vi.fn();
    render(<ImpactTab report={report} loading={false} error={null} onRun={onRun} onViewFull={onViewFull} />);
    fireEvent.click(screen.getByText(/重新分析/));
    fireEvent.click(screen.getByText(/查看完整报告/));
    expect(onRun).toHaveBeenCalledTimes(1);
    expect(onViewFull).toHaveBeenCalledTimes(1);
  });
});
