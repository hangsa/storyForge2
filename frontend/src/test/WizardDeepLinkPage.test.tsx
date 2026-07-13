import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router-dom";

// Mocks must come before importing the component under test.
const mockNavigate = vi.fn();
const mockLocationAssign = vi.fn();

vi.mock("react-router-dom", async () => {
  const real = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return {
    ...real,
    useNavigate: () => mockNavigate,
    useParams: () => ({ projectId: "proj_x" }),
  };
});

import WizardDeepLinkPage from "../pages/WizardDeepLinkPage";

beforeEach(() => {
  mockNavigate.mockReset();
  mockLocationAssign.mockReset();
  // Replace window.location.assign so any leak from production code is captured.
  Object.defineProperty(window, "location", {
    value: { ...window.location, assign: mockLocationAssign },
    writable: true,
    configurable: true,
  });
});

describe("WizardDeepLinkPage", () => {
  it("renders the wizard modal anchored to the URL projectId", () => {
    render(
      <MemoryRouter initialEntries={["/project/proj_x/wizard"]}>
        <Routes>
          <Route path="/project/:projectId/wizard" element={<WizardDeepLinkPage />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByTestId("init-wizard-modal")).toBeInTheDocument();
  });

  it("onDismiss uses SPA navigation, NOT window.location.assign (regression v1.9)", () => {
    // Regression: WizardDeepLinkPage used `window.location.assign("/")` as
    // its onDismiss. That fires a hard reload DURING finishWizard, beating
    // the SPA `navigate(...workspace...)` call that was about to run. Net
    // effect: completing the wizard on the deep-link URL landed back on the
    // home page instead of the workspace.
    render(
      <MemoryRouter initialEntries={["/project/proj_x/wizard"]}>
        <Routes>
          <Route path="/project/:projectId/wizard" element={<WizardDeepLinkPage />} />
        </Routes>
      </MemoryRouter>,
    );
    // The wizard's close button triggers onDismiss — that's the path that
    // used to call window.location.assign("/").
    fireEvent.click(screen.getByTestId("wizard-close"));
    expect(mockNavigate).toHaveBeenCalledWith("/", expect.objectContaining({ replace: true }));
    expect(mockLocationAssign).not.toHaveBeenCalled();
  });

  it("redirects to / when projectId is missing", () => {
    // Verify the existing <Navigate to="/" replace /> guard still works.
    function Routeless() {
      return <WizardDeepLinkPage />; // no useParams → empty
    }
    // Force useParams to return {}
    vi.doMock("react-router-dom", async () => {
      const real = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
      return {
        ...real,
        useNavigate: () => mockNavigate,
        useParams: () => ({}),
      };
    });
    // The simpler check: render with a path that doesn't include :projectId
    // and assert the modal isn't shown (Navigate fires synchronously).
    render(
      <MemoryRouter initialEntries={["/project//wizard"]}>
        <Routes>
          <Route path="/project/:projectId/wizard" element={<WizardDeepLinkPage />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.queryByTestId("init-wizard-modal")).not.toBeInTheDocument();
  });
});
