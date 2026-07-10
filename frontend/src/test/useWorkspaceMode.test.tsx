import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { useWorkspaceMode } from "../hooks/useWorkspaceMode";

function wrap(initialPath = "/workspace") {
  return ({ children }: { children: React.ReactNode }) => (
    <MemoryRouter initialEntries={[initialPath]}>{children}</MemoryRouter>
  );
}

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
});

describe("useWorkspaceMode", () => {
  it("defaults to 'managed' when URL has no mode and no localStorage", () => {
    const { result } = renderHook(() => useWorkspaceMode(), { wrapper: wrap() });
    expect(result.current.mode).toBe("managed");
  });

  it("reads mode from URL when ?mode=manual", () => {
    const { result } = renderHook(() => useWorkspaceMode(), {
      wrapper: wrap("/workspace?mode=manual"),
    });
    expect(result.current.mode).toBe("manual");
  });

  it("falls back to localStorage when URL omits mode", () => {
    localStorage.setItem("storyforge.workspace.mode", "manual");
    const { result } = renderHook(() => useWorkspaceMode(), { wrapper: wrap() });
    expect(result.current.mode).toBe("manual");
  });

  it("URL takes precedence over localStorage", () => {
    localStorage.setItem("storyforge.workspace.mode", "managed");
    const { result } = renderHook(() => useWorkspaceMode(), {
      wrapper: wrap("/workspace?mode=manual"),
    });
    expect(result.current.mode).toBe("manual");
  });

  it("setMode('managed') updates URL and localStorage", () => {
    const { result } = renderHook(() => useWorkspaceMode(), {
      wrapper: wrap("/workspace?mode=manual"),
    });
    act(() => result.current.setMode("managed"));
    expect(result.current.mode).toBe("managed");
    expect(localStorage.getItem("storyforge.workspace.mode")).toBe("managed");
  });

  it("falls back to 'managed' if ?mode=garbage", () => {
    const { result } = renderHook(() => useWorkspaceMode(), {
      wrapper: wrap("/workspace?mode=robot"),
    });
    expect(result.current.mode).toBe("managed");
  });
});