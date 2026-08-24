import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import PromptListPanel from "../../components/home/promptPlaza/PromptListPanel";

const SAMPLE = [
  { name: "scene_writing", category: "", label: "场景写作", has_override: false, modified_at: null, builtin: true },
  { name: "outline", category: "", label: "章节大纲", has_override: false, modified_at: null, builtin: true },
  { name: "mutation", category: "creative", label: "变异", has_override: true, modified_at: "2026-07-19T00:00:00Z", builtin: true },
  { name: "whatif", category: "creative", label: "WhatIf", has_override: false, modified_at: null, builtin: true },
];

describe("PromptListPanel", () => {
  it("renders prompts grouped by category", () => {
    render(<PromptListPanel prompts={SAMPLE} selectedName={null} onSelect={vi.fn()} />);
    expect(screen.getByText("场景写作")).toBeInTheDocument();
    expect(screen.getByText("变异")).toBeInTheDocument();
  });

  it("shows has_override badge for prompts with override", () => {
    render(<PromptListPanel prompts={SAMPLE} selectedName={null} onSelect={vi.fn()} />);
    // mutation has override; should have a badge marked somehow
    const mutation = screen.getByText("变异").closest('[data-testid="plaza-row"]')!;
    expect(mutation.querySelector('[data-testid="override-dot"]')).toBeInTheDocument();
    // scene_writing has no override
    const scene = screen.getByText("场景写作").closest('[data-testid="plaza-row"]')!;
    expect(scene.querySelector('[data-testid="override-dot"]')).not.toBeInTheDocument();
  });

  it("highlights the selected prompt", () => {
    render(<PromptListPanel prompts={SAMPLE} selectedName="scene_writing" onSelect={vi.fn()} />);
    const scene = screen.getByText("场景写作").closest('[data-testid="plaza-row"]')!;
    expect(scene.getAttribute("data-selected")).toBe("true");
  });

  it("calls onSelect when a row is clicked", () => {
    const onSelect = vi.fn();
    render(<PromptListPanel prompts={SAMPLE} selectedName={null} onSelect={onSelect} />);
    fireEvent.click(screen.getByText("场景写作"));
    expect(onSelect).toHaveBeenCalledWith("scene_writing");
  });

  it("filters by search query", () => {
    render(<PromptListPanel prompts={SAMPLE} selectedName={null} onSelect={vi.fn()} />);
    const input = screen.getByPlaceholderText(/搜索/) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "outline" } });
    expect(screen.queryByText("场景写作")).not.toBeInTheDocument();
    expect(screen.getByText("章节大纲")).toBeInTheDocument();
  });

  it("renders empty state when no prompts", () => {
    render(<PromptListPanel prompts={[]} selectedName={null} onSelect={vi.fn()} />);
    expect(screen.getByText(/暂无提示词/)).toBeInTheDocument();
  });

  it("shows has_override badge when only the global layer is in play", () => {
    // proj_1a7d7fcf 2026-08-24 regression: before the fix, the badge stayed
    // hidden when only the global default had a tier-1 override, so users
    // could not tell that the YAML default was being shadowed.
    const withGlobal = [
      ...SAMPLE,
      { name: "novel_outline_generation", category: "", label: "全文大纲", has_override: true, modified_at: "2026-08-24T00:00:00Z", builtin: true, override_source: "global" as const },
    ];
    render(<PromptListPanel prompts={withGlobal} selectedName={null} onSelect={vi.fn()} />);
    const row = screen.getByText("全文大纲").closest('[data-testid="plaza-row"]')!;
    expect(row.querySelector('[data-testid="override-dot"]')).toBeInTheDocument();
  });
});