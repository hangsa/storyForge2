import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
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
});
