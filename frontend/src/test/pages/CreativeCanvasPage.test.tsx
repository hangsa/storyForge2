import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import CreativeCanvasPage from "../../pages/CreativeCanvasPage";

vi.mock("@/api/client", () => ({
  __esModule: true,
  default: {
    postCanvasV2Init: vi.fn().mockResolvedValue({
      ok: true, session_id: "s1", etag: "e1",
    }),
    getCanvasV2State: vi.fn().mockResolvedValue({
      schema_version: 4, session_id: "s1", _etag: "e1",
      creative_path: [], committed: false, committed_at: null,
      raw_intent: { prompt: "", genre_primary: "" },
      root_idea: { prompt: "", genre: "", premise: "", extracted: {} },
      creative_session: { current_step: 1, max_steps: 5, status: "active" },
      current_concept: {},
      final_concept: null,
      scores: {},
      session_metadata: {},
    }),
    postCanvasV2NextStep: vi.fn().mockResolvedValue({
      step: 1,
      operation: { type: "twist", name: "扭曲", reason: "test" },
      options: [
        { id: "opt_1_a", title: "A", premise: "p", logic: "", scores: {} },
        { id: "opt_1_b", title: "B", premise: "p", logic: "", scores: {} },
        { id: "opt_1_c", title: "C", premise: "p", logic: "", scores: {} },
      ],
      quality_warning: null,
    }),
    postCanvasV2Select: vi.fn().mockResolvedValue({
      ok: true, step: 1, selected_option_id: "opt_1_b",
    }),
    postCanvasV2Commit: vi.fn().mockResolvedValue({
      error: false, code: "OK", message: "ok",
      detail: {
        concept: {}, story_dna: {}, source: "canvas",
        committed_at: "2026-09-02T10:00:00",
        concept_preview: {}, story_dna_preview: {},
        novelty_summary: {}, next_step_url: "/x", warnings: [],
      },
    }),
  },
}));

describe("CreativeCanvasPage v2", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders empty state with init form when canvas is empty", async () => {
    render(
      <MemoryRouter initialEntries={["/project/p1/canvas"]}>
        <Routes>
          <Route path="/project/:id/canvas" element={<CreativeCanvasPage />} />
        </Routes>
      </MemoryRouter>
    );
    await waitFor(() => {
      expect(screen.getByPlaceholderText(/用一句话描述你的故事想法/)).toBeInTheDocument();
    });
  });
});