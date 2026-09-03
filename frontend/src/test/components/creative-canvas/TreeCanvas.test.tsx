import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { TreeCanvas } from "@/components/creative-canvas/TreeCanvas";
import type { CanvasV4State } from "@/api/client";

const baseState: CanvasV4State = {
  schema_version: 4,
  session_id: "s",
  _etag: "e",
  root_idea: {
    prompt: "修仙对抗外星",
    genre: "xianxia",
    premise: "x",
    extracted: { genre: "xianxia", core_elements: [], potential_conflict: "" },
  },
  raw_intent: {
    prompt: "修仙对抗外星",
    genre_primary: "xianxia",
  },
  creative_session: { current_step: 3, max_steps: 5, status: "active" },
  creative_path: [
    {
      step: 1,
      operation: "twist",
      operation_reason: "r",
      options: [
        { id: "opt_1_a", title: "A", premise: "p", logic: "", scores: { novelty: 0.5, conflict: 0.5 } },
        { id: "opt_1_b", title: "B", premise: "p", logic: "", scores: { novelty: 0.5, conflict: 0.5 } },
        { id: "opt_1_c", title: "C", premise: "p", logic: "", scores: { novelty: 0.5, conflict: 0.5 } },
      ],
      selected_option_id: "opt_1_b",
      created_at: "2026-09-03T00:00:00",
      selected_at: "2026-09-03T00:00:01",
      regenerated_count: 0,
      state: "completed",
    },
    {
      step: 2,
      operation: "invert",
      operation_reason: "r",
      options: [
        { id: "opt_2_a", title: "A", premise: "p", logic: "", scores: {} },
        { id: "opt_2_b", title: "B", premise: "p", logic: "", scores: {} },
        { id: "opt_2_c", title: "C", premise: "p", logic: "", scores: {} },
      ],
      selected_option_id: "opt_2_c",
      created_at: "2026-09-03T00:00:00",
      selected_at: "2026-09-03T00:00:01",
      regenerated_count: 0,
      state: "completed",
    },
    {
      step: 3,
      operation: "fuse",
      operation_reason: "r",
      options: [
        { id: "opt_3_a", title: "A", premise: "p", logic: "", scores: {} },
        { id: "opt_3_b", title: "B", premise: "p", logic: "", scores: {} },
        { id: "opt_3_c", title: "C", premise: "p", logic: "", scores: {} },
      ],
      selected_option_id: null,
      created_at: "2026-09-03T00:00:00",
      selected_at: null,
      regenerated_count: 0,
      state: "active",
    },
  ],
  current_concept: {
    premise: "x",
    core_conflict: "",
    characters: [],
    world_rules: [],
    tropes: [],
    themes: [],
    novelty: 0,
  },
  final_concept: null,
  committed: false,
  committed_at: null,
  committed_concept_ref: "concept_and_dna.json",
  scores: {
    novelty: 0,
    conflict: 0,
    story_potential: 0,
    uniqueness: 0,
    computed_at: "2026-09-03T00:00:00",
  },
  session_metadata: {
    created_at: "2026-09-03T00:00:00",
    last_modified_at: "2026-09-03T00:00:00",
    elapsed_seconds: 0,
    operation_count: 0,
  },
};

describe("TreeCanvas", () => {
  it("renders the idea root node and one column per creative_path entry", () => {
    render(<TreeCanvas canvas={baseState} />);
    expect(screen.getByTestId("idea-root-node")).toBeInTheDocument();
    expect(screen.getAllByTestId(/^step-column-\d+$/)).toHaveLength(3);
  });

  it("renders 3 option nodes per step", () => {
    render(<TreeCanvas canvas={baseState} />);
    expect(screen.getAllByTestId(/^option-node-\d+-[abc]$/)).toHaveLength(9);
  });

  it("renders SVG paths between columns", () => {
    const { container } = render(<TreeCanvas canvas={baseState} />);
    const paths = container.querySelectorAll("svg path");
    expect(paths.length).toBeGreaterThan(0);
  });

  it("marks selected option with check icon", () => {
    render(<TreeCanvas canvas={baseState} />);
    const selectedB = screen.getByTestId("option-node-1-b");
    expect(selectedB.querySelector("[data-check-icon]")).toBeInTheDocument();
  });

  it("marks current step's center node with pulse animation", () => {
    render(<TreeCanvas canvas={baseState} />);
    const currentNode = screen.getByTestId("step-3-current-node");
    expect(currentNode.className).toMatch(/animate-pulse|glow-active/);
  });
});
