import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ProjectSummary } from "../../api/client";
import ProjectTableRow from "../../components/ds/ProjectTableRow";
import { STAGE_COLORS, STAGE_LABELS } from "../../components/ds/stages";

const PROJECT: ProjectSummary = {
  id: "p1",
  title: "翻天",
  genre: "xuanhuan",
  current_stage: "STAGE4",
  created_at: "2026-01-01T00:00:00Z",
  updated_at: 1700000000,
  min_words: 1000,
  target_total_words: 200000,
  target_length_category: "标准连载",
  chapter_count: 118,
  word_count: 45200,
};

describe("ProjectTableRow", () => {
  it("renders the project title and stats", () => {
    render(<ProjectTableRow project={PROJECT} />);
    expect(screen.getByText("翻天")).toBeInTheDocument();
    expect(screen.getByText("118")).toBeInTheDocument();
    expect(screen.getByText("4.5w")).toBeInTheDocument();
  });

  it("renders the status chip with the spec color and label", () => {
    render(<ProjectTableRow project={PROJECT} />);
    const chip = screen.getByText(STAGE_LABELS.STAGE4);
    expect(chip).toBeInTheDocument();
    // The chip uses STAGE_COLORS[STAGE4] which must include 'bg-primary-container/20'
    const chipEl = chip.closest("span");
    expect(chipEl?.className).toMatch(/bg-primary-container\/20/);
  });

  it("fires onClick when row body is clicked", () => {
    const onClick = vi.fn();
    render(<ProjectTableRow project={PROJECT} onClick={onClick} />);
    fireEvent.click(screen.getByText("翻天"));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("does NOT fire onClick when the checkbox is toggled", () => {
    const onClick = vi.fn();
    const onSelectChange = vi.fn();
    render(
      <ProjectTableRow
        project={PROJECT}
        onClick={onClick}
        onSelectChange={onSelectChange}
      />
    );
    fireEvent.click(screen.getByRole("checkbox"));
    expect(onClick).not.toHaveBeenCalled();
    expect(onSelectChange).toHaveBeenCalledWith(true);
  });

  it("shows the left border when selected", () => {
    const { container } = render(<ProjectTableRow project={PROJECT} selected />);
    expect(container.firstChild).toHaveClass("border-l-4");
    expect(container.firstChild).toHaveClass("border-primary");
  });

  it("uses the INIT chip when current_stage is INIT", () => {
    render(<ProjectTableRow project={{ ...PROJECT, current_stage: "INIT" }} />);
    const chip = screen.getByText(STAGE_LABELS.INIT);
    expect(chip).toBeInTheDocument();
    // INIT should use surface-tint per ds/stages.ts (not system-log)
    expect(STAGE_COLORS.INIT).toMatch(/surface-tint/);
  });
});
