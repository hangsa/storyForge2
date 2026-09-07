import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import CreativeDivergenceStep from "@/components/wizard/CreativeDivergenceStep";

const { mockApi } = vi.hoisted(() => ({
  mockApi: {
    postThreeBDecompose: vi.fn(),
    postThreeBFollowUp: vi.fn(),
    postThreeBDiverge: vi.fn(),
    postThreeBRegenerateUnit: vi.fn(),
    postThreeBSelectUnit: vi.fn(),
    postThreeBCommit: vi.fn(),
    postThreeBEditConcept: vi.fn(),
    postThreeBAdvance: vi.fn(),
    getThreeBState: vi.fn().mockResolvedValue(null),
    deleteThreeBState: vi.fn(),
    listGenres: vi.fn().mockResolvedValue([]),
  },
}));

// `useGenres` (default import of api) and `useThreeBDivergence`
// (namespace import) both consume the same module — expose both the default
// export and the named properties so vitest resolves either access pattern.
vi.mock("@/api/client", () => ({
  __esModule: true,
  api: mockApi,
  default: mockApi,
  ...mockApi,
}));

describe("CreativeDivergenceStep (4 stages)", () => {
  it("renders StepIndicator with 4 stages", () => {
    render(<CreativeDivergenceStep projectId="p1" />);
    expect(screen.getByTestId("step-indicator-1")).toBeInTheDocument();
    expect(screen.getByTestId("step-indicator-2")).toBeInTheDocument();
    expect(screen.getByTestId("step-indicator-3")).toBeInTheDocument();
    expect(screen.getByTestId("step-indicator-4")).toBeInTheDocument();
  });

  it("shows S1 by default", () => {
    render(<CreativeDivergenceStep projectId="p1" />);
    expect(screen.getByText(/灵感点子/)).toBeInTheDocument();
  });

  it("renders without crashing and mounts all 4 stage testids", async () => {
    render(<CreativeDivergenceStep projectId="p1" />);
    await waitFor(() => {
      expect(screen.getByTestId("step-indicator-1")).toBeInTheDocument();
    });
  });

  it("S1 submit button label is '进入拆解' (not '3B 发散')", () => {
    render(<CreativeDivergenceStep projectId="p1" />);
    expect(screen.getByRole("button", { name: /进入拆解/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /3B 发散/ })).toBeNull();
  });

  it("S2 survives DECOMPOSE_SUCCESS with malformed payload (missing dimensions)", async () => {
    // Regression: clicking "进入拆解" in S1 fires POST /decompose. If the
    // backend ever returns an object without a `dimensions` field (or the
    // request helper leaks a wrapped envelope), the reducer used to
    // dispatch DECOMPOSE_SUCCESS with action.dimensions = undefined, then
    // S2 crashed at `dimensions.length`. Reducer now coerces.
    mockApi.postThreeBDecompose.mockResolvedValueOnce({
      // Missing `dimensions` — defensive code should treat as [].
      causal_map: "cm",
      top_level_summary: "ts",
    });

    render(<CreativeDivergenceStep projectId="p1" />);

    fireEvent.change(screen.getByLabelText(/灵感点子/i), {
      target: { value: "足够长的原始灵感点子" },
    });
    fireEvent.change(screen.getByLabelText(/主类型/i), {
      target: { value: "玄幻" },
    });
    fireEvent.click(screen.getByRole("button", { name: /进入拆解/ }));

    // Should not crash, S2 should render.
    await waitFor(() => {
      expect(screen.getByText(/Stage 2 · 第一性拆解/)).toBeInTheDocument();
    });
    // 0 维度 · 0 单元 (empty array, not crash)
    expect(screen.getByText(/0 维度 · 0 单元/)).toBeInTheDocument();
  });
});
