import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { useWorkspacePanel } from "../hooks/useWorkspacePanel";

const wrap = (path = "/workspace") =>
  ({ children }: { children: React.ReactNode }) =>
    <MemoryRouter initialEntries={[path]}>{children}</MemoryRouter>;

beforeEach(() => sessionStorage.clear());

describe("useWorkspacePanel", () => {
  it("defaults to 'concept'", () => {
    const { result } = renderHook(() => useWorkspacePanel(), { wrapper: wrap() });
    expect(result.current.panel).toBe("concept");
  });

  it("reads each valid ?panel= value", () => {
    for (const p of ["concept", "world", "character", "outline", "diagnosis", "export"]) {
      const { result } = renderHook(() => useWorkspacePanel(), {
        wrapper: wrap(`/workspace?panel=${p}`),
      });
      expect(result.current.panel).toBe(p);
    }
  });

  it("falls back to 'concept' for garbage values", () => {
    const { result } = renderHook(() => useWorkspacePanel(), {
      wrapper: wrap("/workspace?panel=teleport"),
    });
    expect(result.current.panel).toBe("concept");
  });

  it("setPanel updates URL without overwriting other params", () => {
    const { result } = renderHook(() => useWorkspacePanel(), {
      wrapper: wrap("/workspace?mode=manual&panel=world"),
    });
    act(() => result.current.setPanel("outline"));
    expect(result.current.panel).toBe("outline");
  });
});