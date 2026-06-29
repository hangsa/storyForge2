import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useToast, ToastProvider } from "../../hooks/useToast";

describe("useToast", () => {
  it("starts with no toasts", () => {
    const { result } = renderHook(() => useToast(), { wrapper: ToastProvider });
    expect(result.current.toasts).toEqual([]);
  });

  it("show_addsToastWithMessage", () => {
    const { result } = renderHook(() => useToast(), { wrapper: ToastProvider });
    act(() => result.current.show("hello"));
    expect(result.current.toasts).toHaveLength(1);
    expect(result.current.toasts[0].message).toBe("hello");
    expect(result.current.toasts[0].onClick).toBeUndefined();
  });

  it("show_withOnClick_preservesCallback", () => {
    const cb = () => {};
    const { result } = renderHook(() => useToast(), { wrapper: ToastProvider });
    act(() => result.current.show("click me", { onClick: cb }));
    expect(result.current.toasts[0].onClick).toBe(cb);
  });

  it("dismiss_removesToastById", () => {
    const { result } = renderHook(() => useToast(), { wrapper: ToastProvider });
    let id!: string;
    act(() => { id = result.current.show("bye"); });
    expect(result.current.toasts).toHaveLength(1);
    act(() => result.current.dismiss(id));
    expect(result.current.toasts).toHaveLength(0);
  });
});