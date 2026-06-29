import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import ImpactTab from "../../../components/stage4/ImpactTab";
import type { ImpactReport } from "../../../api/client";

const report: ImpactReport = {
  project_id: "proj_1",
  modified_files: [],
  entries: [
    { chapter_number: 1, scene_numbers: [1], priority: "P0", reason: "主线冲突升级", affected_assets: [] },
    { chapter_number: 1, scene_numbers: [2], priority: "P1", reason: "角色状态变化", affected_assets: [] },
    { chapter_number: 3, scene_numbers: [1, 2], priority: "P2", reason: "节奏调整", affected_assets: [] },
    { chapter_number: 4, scene_numbers: [1], priority: "P2", reason: "新伏笔", affected_assets: [] },
  ],
  summary: { P0: 1, P1: 1, P2: 2 },
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
    // Only the first 3 entries are shown in the compact view.
    expect(screen.getByText(/ch1:1/)).toBeInTheDocument();
    expect(screen.getByText(/ch1:2/)).toBeInTheDocument();
    expect(screen.getByText(/ch3:1,2/)).toBeInTheDocument();
    expect(screen.queryByText(/ch4:1/)).not.toBeInTheDocument();
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
