import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useSidebar } from "../../hooks/useSidebar";

const STORAGE_KEY = "storyforge.sidebar";

describe("useSidebar - initialization", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("returns default state when localStorage is empty", () => {
    const { result } = renderHook(() => useSidebar());
    expect(result.current.collapsed).toBe(false);
    expect(result.current.width).toBe(280);
    expect(result.current.MIN).toBe(200);
    expect(result.current.MAX).toBe(480);
  });

  it("restores state from localStorage", () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ collapsed: true, width: 320 })
    );
    const { result } = renderHook(() => useSidebar());
    expect(result.current.collapsed).toBe(true);
    expect(result.current.width).toBe(320);
  });

  it("clamps width below MIN", () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ collapsed: false, width: 100 })
    );
    const { result } = renderHook(() => useSidebar());
    expect(result.current.width).toBe(200);
  });

  it("clamps width above MAX", () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ collapsed: false, width: 999 })
    );
    const { result } = renderHook(() => useSidebar());
    expect(result.current.width).toBe(480);
  });

  it("falls back to default when JSON is malformed", () => {
    localStorage.setItem(STORAGE_KEY, "not-json{");
    const { result } = renderHook(() => useSidebar());
    expect(result.current.collapsed).toBe(false);
    expect(result.current.width).toBe(280);
  });

  it("falls back to default when value is not an object", () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify("hello"));
    const { result } = renderHook(() => useSidebar());
    expect(result.current.collapsed).toBe(false);
    expect(result.current.width).toBe(280);
  });

  it("falls back when width field is missing or wrong type", () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ collapsed: true, width: "abc" })
    );
    const { result } = renderHook(() => useSidebar());
    expect(result.current.width).toBe(280);
  });

  it("falls back when getItem throws (e.g. private mode)", () => {
    const original = Storage.prototype.getItem;
    Storage.prototype.getItem = vi.fn(() => {
      throw new Error("QuotaExceeded");
    });
    try {
      const { result } = renderHook(() => useSidebar());
      expect(result.current.collapsed).toBe(false);
      expect(result.current.width).toBe(280);
    } finally {
      Storage.prototype.getItem = original;
    }
  });
});
