import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

import * as api from "../api/autopilot";

const defaults = {
  scope: "all_planned" as const,
  cadence: "balanced" as const,
  policy: "auto" as const,
  notify: "milestones" as const,
};

vi.mock("../api/autopilot", async (importActual) => {
  const actual = await importActual<typeof api>();
  return {
    ...actual,
    getAutopilotSession: vi.fn(),
    startAutopilotSession: vi.fn(),
  };
});

beforeEach(() => {
  vi.clearAllMocks();
});

import { useAutopilotConfig } from "../hooks/useAutopilotConfig";

describe("useAutopilotConfig", () => {
  it("exposes defaults when no session exists", async () => {
    vi.mocked(api.getAutopilotSession).mockResolvedValue(null as any);
    const { result } = renderHook(() => useAutopilotConfig("p"));
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.config).toEqual(defaults);
  });

  it("prefills from session.config when present", async () => {
    vi.mocked(api.getAutopilotSession).mockResolvedValue({
      project_id: "p",
      state: "stopped",
      current_task: null,
      queue: [],
      history: [],
      config: { scope: "next_chapter", cadence: "fast", policy: "ask", notify: "all" },
    } as any);
    const { result } = renderHook(() => useAutopilotConfig("p"));
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.config?.scope).toBe("next_chapter");
    expect(result.current.config?.cadence).toBe("fast");
  });

  it("falls back to defaults when session.config is null", async () => {
    vi.mocked(api.getAutopilotSession).mockResolvedValue({
      project_id: "p",
      state: "stopped",
      current_task: null,
      queue: [],
      history: [],
      config: null,
    } as any);
    const { result } = renderHook(() => useAutopilotConfig("p"));
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.config).toEqual(defaults);
  });

  it("setConfig + submit calls startAutopilotSession", async () => {
    vi.mocked(api.getAutopilotSession).mockResolvedValue(null as any);
    vi.mocked(api.startAutopilotSession).mockResolvedValue({
      project_id: "p",
      state: "running",
      current_task: { description: "writing" },
      queue: [],
      history: [],
      config: defaults,
    } as any);
    const { result } = renderHook(() => useAutopilotConfig("p"));
    await waitFor(() => expect(result.current.loaded).toBe(true));
    act(() => result.current.setConfig({ ...defaults, cadence: "careful" }));
    await act(async () => {
      await result.current.submit();
    });
    expect(api.startAutopilotSession).toHaveBeenCalledWith("p", {
      ...defaults,
      cadence: "careful",
    });
  });
});