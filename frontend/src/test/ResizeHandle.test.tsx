import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import ResizeHandle from "../components/layout/ResizeHandle";

afterEach(() => {
  cleanup();
  document.body.style.cursor = "";
  document.body.style.userSelect = "";
});

describe("ResizeHandle - rendering", () => {
  it("renders with col-resize cursor and position classes", () => {
    const { container } = render(
      <ResizeHandle
        width={280}
        onLiveChange={() => {}}
        onCommit={() => {}}
      />
    );
    const handle = container.firstChild as HTMLElement;
    expect(handle).toHaveClass("cursor-col-resize");
    expect(handle).toHaveClass("absolute");
    expect(handle).toHaveClass("right-0");
  });
});

describe("ResizeHandle - pointer drag flow", () => {
  it("onPointerMove between down and up calls onLiveChange", () => {
    const onLiveChange = vi.fn();
    const { container } = render(
      <ResizeHandle
        width={280}
        onLiveChange={onLiveChange}
        onCommit={() => {}}
      />
    );
    const handle = container.firstChild as HTMLElement;

    fireEvent.pointerDown(handle, { clientX: 280, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientX: 320, pointerId: 1 });
    expect(onLiveChange).toHaveBeenLastCalledWith(320);

    fireEvent.pointerMove(handle, { clientX: 300, pointerId: 1 });
    expect(onLiveChange).toHaveBeenLastCalledWith(300);
  });

  it("onPointerUp calls onCommit with current width", () => {
    const onCommit = vi.fn();
    const { container } = render(
      <ResizeHandle
        width={280}
        onLiveChange={() => {}}
        onCommit={onCommit}
      />
    );
    const handle = container.firstChild as HTMLElement;

    fireEvent.pointerDown(handle, { clientX: 280, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientX: 350, pointerId: 1 });
    fireEvent.pointerUp(handle, { clientX: 350, pointerId: 1 });
    expect(onCommit).toHaveBeenCalledWith(350);
  });

  it("sets body cursor and userSelect during drag; restores on unmount", () => {
    const { container, unmount } = render(
      <ResizeHandle
        width={280}
        onLiveChange={() => {}}
        onCommit={() => {}}
      />
    );
    const handle = container.firstChild as HTMLElement;

    fireEvent.pointerDown(handle, { clientX: 280, pointerId: 1 });
    expect(document.body.style.cursor).toBe("col-resize");
    expect(document.body.style.userSelect).toBe("none");

    unmount();
    expect(document.body.style.cursor).toBe("");
    expect(document.body.style.userSelect).toBe("");
  });
});
