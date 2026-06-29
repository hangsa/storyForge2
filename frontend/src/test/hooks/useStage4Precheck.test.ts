import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useStage4Precheck } from "../../hooks/useStage4Precheck";

describe("useStage4Precheck", () => {
  it("setData_populatesState", () => {
    const { result } = renderHook(() => useStage4Precheck());
    const data = { precheck_passed: true, suggestions: [], tokens_used: 0 };
    act(() => result.current.setData(data));
    expect(result.current.data).toEqual(data);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("clear_emptiesState", () => {
    const { result } = renderHook(() => useStage4Precheck());
    act(() => result.current.setData({ precheck_passed: true, suggestions: [], tokens_used: 0 }));
    act(() => result.current.clear());
    expect(result.current.data).toBeNull();
  });
});
