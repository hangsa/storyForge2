import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter, Navigate, Routes, Route, useLocation } from "react-router-dom";

vi.mock("../../api/client", () => ({
  default: {
    getProjectStatus: vi.fn().mockResolvedValue({ title: "T" }),
    getOutline: vi.fn().mockResolvedValue({ chapters: [] }),
  },
}));

vi.mock("../hooks/useAutopilotSession", () => ({
  useAutopilotSession: vi.fn(),
}));

import WorkspacePage from "../pages/WorkspacePage";
import { ToastProvider } from "../hooks/useToast";
import { useAutopilotSession } from "../hooks/useAutopilotSession";

const noop = vi.fn().mockResolvedValue(undefined);

beforeEach(() => {
  sessionStorage.clear();
  vi.mocked(useAutopilotSession).mockImplementation(() => ({
    session: { state: "stopped", current_task: null, queue: [], history: [], config: null },
    events: [],
    status: "idle",
    start: noop, stop: noop, pause: noop, resume: noop, refresh: noop,
  }));
});

/**
 * Records the post-render location into a global so tests can assert on it.
 * MemoryRouter does NOT push to window.history, so we can't rely on
 * window.location.pathname/search — instead we observe the router's own location.
 */
declare global {
  // eslint-disable-next-line no-var
  var __lastLocation: { pathname: string; search: string } | undefined;
}

function LocationSpy() {
  const loc = useLocation();
  globalThis.__lastLocation = { pathname: loc.pathname, search: loc.search };
  return null;
}

function withPath(path: string) {
  globalThis.__lastLocation = undefined;
  return render(
    <ToastProvider>
      <MemoryRouter initialEntries={[path]}>
        <LocationSpy />
        <Routes>
          <Route path="/workspace" element={<WorkspacePage projectId="p" />} />
          <Route path="/stage4" element={<Navigate replace to="/workspace?mode=manual" />} />
          <Route path="/stage5" element={<Navigate replace to="/workspace?mode=manual&panel=diagnosis" />} />
          <Route path="/stage6" element={<Navigate replace to="/workspace?mode=manual&panel=export" />} />
        </Routes>
      </MemoryRouter>
    </ToastProvider>,
  );
}

describe("Workspace routing", () => {
  // v1.9: workspace defaults to manual mode so all entry points (bookshelf,
  // wizard, init) land the user on the chapter tree + writing area.
  it("renders /workspace with mode=manual by default", () => {
    withPath("/workspace");
    expect(screen.getByTestId("workspace-page")).toBeInTheDocument();
    expect(screen.getByTestId("mode-manual").className).toContain("bg-primary-container");
  });
  it("renders /workspace?mode=manual", () => {
    withPath("/workspace?mode=manual");
    expect(screen.getByTestId("mode-manual").className).toContain("bg-primary-container");
  });
  it("redirects /stage4 → /workspace?mode=manual", () => {
    withPath("/stage4");
    expect(globalThis.__lastLocation?.pathname).toBe("/workspace");
    expect(globalThis.__lastLocation?.search).toBe("?mode=manual");
  });
  it("redirects /stage5 → /workspace?mode=manual&panel=diagnosis", () => {
    withPath("/stage5");
    expect(globalThis.__lastLocation?.pathname).toBe("/workspace");
    expect(globalThis.__lastLocation?.search).toBe("?mode=manual&panel=diagnosis");
  });
  it("redirects /stage6 → /workspace?mode=manual&panel=export", () => {
    withPath("/stage6");
    expect(globalThis.__lastLocation?.pathname).toBe("/workspace");
    expect(globalThis.__lastLocation?.search).toBe("?mode=manual&panel=export");
  });
  it("clicking the managed switcher from default-manual opens the start modal", async () => {
    withPath("/workspace");
    fireEvent.click(screen.getByTestId("mode-managed"));
    // manual → managed goes through the start modal (was: confirm modal).
    expect(await screen.findByTestId("managed-start-modal")).toBeInTheDocument();
  });
});

// v1.8.1: /workspace is now a top-level route (no MainLayout). The page must
// be self-contained — no SideNavBar wrapper, but the in-page
// "← 项目中心" back button replaces it.
describe("/workspace top-level route (no MainLayout)", () => {
  it("renders workspace-page without SideNavBar wrapping it", () => {
    withPath("/workspace");
    expect(screen.getByTestId("workspace-page")).toBeInTheDocument();
    // If SideNavBar is present, MainLayout is wrapping us again.
    expect(screen.queryByTestId("side-nav-bar")).not.toBeInTheDocument();
  });

  it("renders the in-page back-to-home button as the navigation entry", () => {
    withPath("/workspace");
    expect(screen.getByTestId("topbar-back-home")).toBeInTheDocument();
  });
});