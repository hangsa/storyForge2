import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter, Navigate, Routes, Route, useLocation } from "react-router-dom";

vi.mock("../../api/client", () => ({
  default: {
    getProjectStatus: vi.fn().mockResolvedValue({ title: "T" }),
    getOutline: vi.fn().mockResolvedValue({ chapters: [] }),
  },
}));

import WorkspacePage from "../pages/WorkspacePage";

beforeEach(() => sessionStorage.clear());

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
    <MemoryRouter initialEntries={[path]}>
      <LocationSpy />
      <Routes>
        <Route path="/workspace" element={<WorkspacePage projectId="p" />} />
        <Route path="/stage4" element={<Navigate replace to="/workspace?mode=manual" />} />
        <Route path="/stage5" element={<Navigate replace to="/workspace?mode=manual&panel=diagnosis" />} />
        <Route path="/stage6" element={<Navigate replace to="/workspace?mode=manual&panel=export" />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("Workspace routing", () => {
  it("renders /workspace with mode=managed by default", () => {
    withPath("/workspace");
    expect(screen.getByTestId("workspace-page")).toBeInTheDocument();
    expect(screen.getByTestId("mode-managed").className).toContain("bg-primary-container");
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
  it("clicking the manual switcher opens confirm modal; confirming persists 'manual' to localStorage", () => {
    withPath("/workspace");
    fireEvent.click(screen.getByTestId("mode-manual"));
    expect(screen.getByTestId("mode-switch-confirm")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("confirm-confirm"));
    expect(localStorage.getItem("storyforge.workspace.mode")).toBe("manual");
  });
});
