import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { WizardProvider, useWizard } from "../wizard/WizardContext";
import PlotCanvasMountPoint from "./PlotCanvasMountPoint";

// Mock the canvas hook so the page doesn't try to actually load v2 state.
// We import the mocked function after vi.mock so `vi.mocked()` can type-cast.
vi.mock("@/hooks/useCreativeCanvasV2", () => ({
  useCreativeCanvasV2: vi.fn(),
}));
import { useCreativeCanvasV2 } from "@/hooks/useCreativeCanvasV2";
const mockUseCreativeCanvasV2 = vi.mocked(useCreativeCanvasV2);

// Stub the canvas-v2 hook to return an empty state. The mount point itself
// doesn't care about canvas contents — only that the page renders and the
// page-shell header is suppressed. EmptyState has its own data-testid
// ("empty-state") which we use in the embed assertion to confirm the page
// actually mounted.
mockUseCreativeCanvasV2.mockReturnValue({
  status: "empty",
  canvas: null,
  error: null,
  loadingStep: false,
  committedAt: null,
  canCommit: false,
  loadCanvas: vi.fn(),
  initSession: vi.fn().mockResolvedValue(undefined),
  nextStep: vi.fn().mockResolvedValue(undefined),
  selectOption: vi.fn().mockResolvedValue(undefined),
  commitCanvas: vi.fn().mockResolvedValue(undefined),
  showResetDialog: false,
  onReset: vi.fn(),
  closeResetDialog: vi.fn(),
  confirmReset: vi.fn().mockResolvedValue(undefined),
  showPreCommit: false,
  onCommitClick: vi.fn(),
  closePreCommit: vi.fn(),
  confirmCommit: vi.fn().mockResolvedValue(undefined),
});

/**
 * Test-only child that probes wizard context state. Verifies that calling
 * markStepGenerated(6) pushes 6 into the wizard's completedSteps array.
 */
function WizardProbe() {
  const wizard = useWizard();
  return (
    <div>
      <button
        data-testid="probe-mark-completed"
        onClick={() => wizard.markStepGenerated(6, {})}
      >
        mark
      </button>
      <span data-testid="probe-completed">
        {wizard.completedSteps.includes(6) ? "yes" : "no"}
      </span>
      <span data-testid="probe-active">{wizard.currentStep}</span>
    </div>
  );
}

describe("PlotCanvasMountPoint", () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it("mounts CreativeCanvasPage with embedded=true (no page-shell header)", () => {
    render(
      <WizardProvider projectId="proj_test">
        <MemoryRouter initialEntries={["/project/proj_test/stage1/canvas"]}>
          <Routes>
            <Route
              path="/project/:projectId/stage1/canvas"
              element={
                <>
                  <PlotCanvasMountPoint projectId="proj_test" />
                  <WizardProbe />
                </>
              }
            />
          </Routes>
        </MemoryRouter>
      </WizardProvider>
    );
    // embedded=true should hide the page-shell header. The mount point
    // forwards `embedded` to CreativeCanvasPage, which omits the h2 +
    // wrapper data-testid when embedded.
    expect(screen.queryByRole("heading", { name: /Creative Canvas/ })).toBeNull();
    expect(screen.queryByTestId("creative-canvas-page")).toBeNull();
    // Sanity: the page DID render — EmptyState's data-testid is present
    // because the stubbed canvas hook returned canvas=null.
    expect(screen.getByTestId("empty-state")).toBeInTheDocument();
  });

  it("wizard.markStepGenerated(6) pushes 6 into completedSteps", () => {
    render(
      <WizardProvider projectId="proj_test">
        <MemoryRouter initialEntries={["/project/proj_test/stage1/canvas"]}>
          <Routes>
            <Route
              path="/project/:projectId/stage1/canvas"
              element={
                <>
                  <PlotCanvasMountPoint projectId="proj_test" />
                  <WizardProbe />
                </>
              }
            />
          </Routes>
        </MemoryRouter>
      </WizardProvider>
    );
    expect(screen.getByTestId("probe-completed").textContent).toBe("no");
    fireEvent.click(screen.getByTestId("probe-mark-completed"));
    expect(screen.getByTestId("probe-completed").textContent).toBe("yes");
  });

  it("wizard context currentStep starts at 1 on fresh provider", () => {
    render(
      <WizardProvider projectId="proj_test">
        <MemoryRouter initialEntries={["/project/proj_test/stage1/canvas"]}>
          <Routes>
            <Route
              path="/project/:projectId/stage1/canvas"
              element={
                <>
                  <PlotCanvasMountPoint projectId="proj_test" />
                  <WizardProbe />
                </>
              }
            />
          </Routes>
        </MemoryRouter>
      </WizardProvider>
    );
    expect(screen.getByTestId("probe-active").textContent).toBe("1");
  });
});
