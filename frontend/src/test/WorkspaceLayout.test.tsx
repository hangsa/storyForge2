import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import WorkspaceLayout from "../components/workspace/WorkspaceLayout";

const STORAGE_KEY = "storyforge.workspace.column-widths";

// JSDOM doesn't compute layout — stub getBoundingClientRect so the resize
// handler sees a known container width (2000px — wide enough for tests to
// drag left column past 400px without bumping into minCenter constraints).
beforeEach(() => {
  localStorage.clear();
  HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
    return {
      left: 0, top: 0, right: 2000, bottom: 500,
      x: 0, y: 0, width: 2000, height: 500,
      toJSON: () => ({}),
    };
  };
});

describe("WorkspaceLayout", () => {
  it("renders managed slots (left, right) when mode=managed", () => {
    render(
      <WorkspaceLayout
        mode="managed"
        left={<div data-testid="l">L</div>}
        center={<div data-testid="c">C</div>}
        right={<div data-testid="r">R</div>}
      />,
    );
    expect(screen.getByTestId("l")).toBeInTheDocument();
    expect(screen.queryByTestId("c")).not.toBeInTheDocument();
    expect(screen.getByTestId("r")).toBeInTheDocument();
  });

  it("renders manual slots (left, center, right) when mode=manual", () => {
    render(
      <WorkspaceLayout
        mode="manual"
        left={<div data-testid="l">L</div>}
        center={<div data-testid="c">C</div>}
        right={<div data-testid="r">R</div>}
      />,
    );
    expect(screen.getByTestId("l")).toBeInTheDocument();
    expect(screen.getByTestId("c")).toBeInTheDocument();
    expect(screen.getByTestId("r")).toBeInTheDocument();
  });

  describe("draggable column borders", () => {
    it("manual mode renders two resize handles (left-center and center-right)", () => {
      render(
        <WorkspaceLayout
          mode="manual"
          left={<div>L</div>}
          center={<div>C</div>}
          right={<div>R</div>}
        />,
      );
      expect(screen.getByTestId("resize-handle-left")).toBeInTheDocument();
      expect(screen.getByTestId("resize-handle-right")).toBeInTheDocument();
    });

    it("managed mode renders one resize handle (left-right)", () => {
      render(
        <WorkspaceLayout
          mode="managed"
          left={<div>L</div>}
          right={<div>R</div>}
        />,
      );
      expect(screen.getByTestId("resize-handle-left")).toBeInTheDocument();
      expect(screen.queryByTestId("resize-handle-right")).not.toBeInTheDocument();
    });

    it("default widths: left=260, right=360 (no localStorage)", () => {
      render(
        <WorkspaceLayout
          mode="manual"
          left={<div>L</div>}
          center={<div>C</div>}
          right={<div>R</div>}
        />,
      );
      expect((screen.getByTestId("left-column") as HTMLElement).style.width).toBe("260px");
      expect((screen.getByTestId("right-column") as HTMLElement).style.width).toBe("360px");
    });

    it("dragging the left handle right increases the left column width", () => {
      render(
        <WorkspaceLayout
          mode="manual"
          left={<div>L</div>}
          center={<div>C</div>}
          right={<div>R</div>}
        />,
      );
      const handle = screen.getByTestId("resize-handle-left");
      const leftCol = screen.getByTestId("left-column") as HTMLElement;
      expect(leftCol.style.width).toBe("260px");
      fireEvent.mouseDown(handle, { clientX: 260 });
      fireEvent.mouseMove(document, { clientX: 400 });
      fireEvent.mouseUp(document);
      expect(parseInt(leftCol.style.width)).toBe(400);
    });

    it("width persists to localStorage after a drag", () => {
      render(
        <WorkspaceLayout
          mode="manual"
          left={<div>L</div>}
          center={<div>C</div>}
          right={<div>R</div>}
        />,
      );
      fireEvent.mouseDown(screen.getByTestId("resize-handle-left"), { clientX: 260 });
      fireEvent.mouseMove(document, { clientX: 400 });
      fireEvent.mouseUp(document);
      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
      expect(stored.left).toBe(400);
    });

    it("widths are restored from localStorage on mount", () => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ left: 500, right: 400 }));
      render(
        <WorkspaceLayout
          mode="manual"
          left={<div>L</div>}
          center={<div>C</div>}
          right={<div>R</div>}
        />,
      );
      expect((screen.getByTestId("left-column") as HTMLElement).style.width).toBe("500px");
      expect((screen.getByTestId("right-column") as HTMLElement).style.width).toBe("400px");
    });

    it("left column width does not shrink below min (200px)", () => {
      render(
        <WorkspaceLayout
          mode="manual"
          left={<div>L</div>}
          center={<div>C</div>}
          right={<div>R</div>}
        />,
      );
      fireEvent.mouseDown(screen.getByTestId("resize-handle-left"), { clientX: 260 });
      fireEvent.mouseMove(document, { clientX: 0 });
      fireEvent.mouseUp(document);
      expect((screen.getByTestId("left-column") as HTMLElement).style.width).toBe("200px");
    });
  });
});