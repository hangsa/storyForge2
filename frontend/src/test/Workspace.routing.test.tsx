import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter, Navigate, Routes, Route, useLocation } from "react-router-dom";

vi.mock("../api/client", () => ({
  default: {
    getProjectStatus: vi.fn().mockResolvedValue({ title: "T" }),
    getOutline: vi.fn().mockResolvedValue({ chapters: [] }),
    // v2.x (Plan Task 12, 2026-08-30): WorkspacePage runs a 5-endpoint
    // preflight. The routing tests assume the manuscript panel is mounted
    // directly (no wizard), so we mock the 6 wizard-data endpoints to
    // succeed with content that satisfies the `has_selection` check.
    getCreativeDivergencePrefill: vi
      .fn()
      .mockResolvedValue({ exists: true, has_selection: true }),
    getConcept: vi.fn().mockResolvedValue({ concept: null, story_dna: null }),
    getWorld: vi.fn().mockResolvedValue({}),
    getCharacter: vi.fn().mockResolvedValue({ characters: [] }),
    getNovelOutline: vi.fn().mockResolvedValue({ volumes: [] }),
    getStage4Progress: vi.fn().mockResolvedValue({ chapters: [], total_chapters: 0 }),
    getSceneDrafts: vi.fn().mockResolvedValue({ chapter_number: 0, scenes: [] }),
    getSceneDraft: vi.fn().mockResolvedValue({ draft_text: "" }),
    // v2.x (Plan Task 12, 2026-08-30): WorkspacePage renders the wizard
    // panel on first paint and preflight races against it. The wizard's
    // CreativeDivergenceStep calls these endpoints — mock them so the
    // panel mounts without crashing while the preflight resolves.
    listCreativeDivergenceVariants: vi.fn().mockResolvedValue({ variants: [] }),
    generateCreativeDivergenceVariants: vi.fn().mockResolvedValue({ variants: [] }),
    selectCreativeDivergenceVariant: vi.fn().mockResolvedValue({ ok: true }),
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
  // v2.x (Plan Task 12, 2026-08-30): the page now hosts a tab switcher.
  // These legacy routing tests are about the panel chrome + mode switcher,
  // so they append ?tab=manuscript to force the writing panel to mount
  // (otherwise the wizard would render first, since the preflight hasn't
  // resolved yet — and with the legacy mocks, allStepsDone would flip
  // false anyway).
  it("renders /workspace with mode=manual by default", async () => {
    withPath("/workspace?tab=manuscript");
    // v2.x (Plan Task 12, 2026-08-30): workspace-page testid now lives on
    // the writing panel (after Task 11 extraction). It only mounts after
    // the 6-endpoint preflight resolves + landing effect flips the tab.
    await screen.findByTestId("workspace-page");
    expect(screen.getByTestId("mode-manual").className).toContain("bg-primary-container");
  });
  it("renders /workspace?mode=manual", async () => {
    withPath("/workspace?mode=manual");
    // v2.x (Plan Task 12, 2026-08-30): wait for preflight + landing effect
    // to flip the tab and mount the writing panel before checking mode.
    await screen.findByTestId("workspace-page");
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
    withPath("/workspace?tab=manuscript");
    // v2.x (Plan Task 12, 2026-08-30): the writing panel only mounts after
    // the 6-endpoint preflight resolves and `allStepsDone` flips true. Wait
    // for the writing-panel testid (workspace-page lives on the panel after
    // Task 11 extraction) before exercising the mode switcher.
    await screen.findByTestId("workspace-page");
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
    withPath("/workspace?tab=manuscript");
    expect(screen.getByTestId("workspace-page-shell")).toBeInTheDocument();
    // If SideNavBar is present, MainLayout is wrapping us again.
    expect(screen.queryByTestId("side-nav-bar")).not.toBeInTheDocument();
  });

  it("renders the in-page back-to-home button as the navigation entry", () => {
    withPath("/workspace?tab=manuscript");
    expect(screen.getByTestId("topbar-back-home")).toBeInTheDocument();
  });
});