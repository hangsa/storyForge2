import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

// Mocks must come before importing the component under test.
const mockNavigate = vi.fn();
// Mutable so individual tests can exercise the missing-projectId branch;
// vi.mock is hoisted, so vi.doMock-per-test would not re-apply reliably.
let mockParams: { projectId?: string } = { projectId: "proj_x" };

vi.mock("react-router-dom", async () => {
  const real = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return {
    ...real,
    useNavigate: () => mockNavigate,
    useParams: () => mockParams,
  };
});

import WizardDeepLinkPage from "../pages/WizardDeepLinkPage";

beforeEach(() => {
  mockNavigate.mockReset();
  mockParams = { projectId: "proj_x" };
});

function renderAt(path: string, routePath: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path={routePath} element={<WizardDeepLinkPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("WizardDeepLinkPage", () => {
  it("redirects to /workspace?tab=settings on mount", () => {
    // The wizard modal is gone: its content now lives in the workspace
    // settings tab, so this deep link is a pure forwarder.
    const { container } = renderAt("/project/proj_x/wizard", "/project/:projectId/wizard");
    expect(container).toBeEmptyDOMElement();
    expect(mockNavigate).toHaveBeenCalledWith(
      "/project/proj_x/workspace?tab=settings",
      expect.objectContaining({ replace: true }),
    );
  });

  it("encodes the projectId in the redirect target", () => {
    mockParams = { projectId: "proj x/1" };
    renderAt("/project/proj%20x/wizard", "/project/:projectId/wizard");
    expect(mockNavigate).toHaveBeenCalledWith(
      "/project/proj%20x%2F1/workspace?tab=settings",
      expect.objectContaining({ replace: true }),
    );
  });

  it("redirects to / when projectId is missing", () => {
    mockParams = {};
    renderAt("/wizard", "/wizard");
    expect(mockNavigate).toHaveBeenCalledWith("/", expect.objectContaining({ replace: true }));
  });

  it("never uses a hard reload (regression v1.9)", () => {
    // Regression: this page once used window.location.assign("/"), a hard
    // reload that beat the SPA navigate(...workspace...) about to run.
    const assignSpy = vi.fn();
    const original = window.location;
    Object.defineProperty(window, "location", {
      value: { ...original, assign: assignSpy },
      writable: true,
      configurable: true,
    });
    renderAt("/project/proj_x/wizard", "/project/:projectId/wizard");
    expect(assignSpy).not.toHaveBeenCalled();
    Object.defineProperty(window, "location", {
      value: original,
      writable: true,
      configurable: true,
    });
  });
});
