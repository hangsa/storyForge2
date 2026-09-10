import { renderHook, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/api/client", () => ({
  default: {
    listActiveCreativeDimensions: vi.fn(),
  },
}));

import api from "@/api/client";
import { useCreativeDimensions, __resetCacheForTests } from "@/hooks/useCreativeDimensions";

describe("useCreativeDimensions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetCacheForTests();
  });

  it("loads from api on mount", async () => {
    const stub = {
      subject: [{ id: "x", name: "X", description: "", status: "active" as const, order: 0, created_at: "a", updated_at: "a" }],
      tone: [],
      style: [],
    };
    (api.listActiveCreativeDimensions as any).mockResolvedValue(stub);

    const { result } = renderHook(() => useCreativeDimensions());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.subject).toEqual(stub.subject);
    expect(result.current.tone).toEqual([]);
    expect(api.listActiveCreativeDimensions).toHaveBeenCalledTimes(1);
  });

  it("caches between mounts", async () => {
    const stub = {
      subject: [{ id: "x", name: "X", description: "", status: "active" as const, order: 0, created_at: "a", updated_at: "a" }],
      tone: [],
      style: [],
    };
    (api.listActiveCreativeDimensions as any).mockResolvedValue(stub);

    const { result: r1 } = renderHook(() => useCreativeDimensions());
    await waitFor(() => expect(r1.current.loading).toBe(false));

    const { result: r2 } = renderHook(() => useCreativeDimensions());
    expect(r2.current.subject).toEqual(stub.subject);
    expect(api.listActiveCreativeDimensions).toHaveBeenCalledTimes(1);
  });

  it("captures error on api failure", async () => {
    (api.listActiveCreativeDimensions as any).mockRejectedValue(new Error("boom"));
    const { result } = renderHook(() => useCreativeDimensions());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("boom");
  });
});
