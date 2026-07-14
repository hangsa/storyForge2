import { useEffect, useRef, useState, type ReactNode } from "react";
import type { WorkspaceMode } from "../../hooks/useWorkspaceMode";

interface Props {
  mode: WorkspaceMode;
  left: ReactNode;
  /** Only rendered in manual mode. */
  center?: ReactNode;
  right: ReactNode;
}

const STORAGE_KEY = "storyforge.workspace.column-widths";
const DEFAULT_LEFT = 260;
const DEFAULT_RIGHT = 360;
const MIN_COL = 200;
const MIN_CENTER = 400;

function loadWidths(): { left: number; right: number } {
  if (typeof localStorage === "undefined") {
    return { left: DEFAULT_LEFT, right: DEFAULT_RIGHT };
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { left: DEFAULT_LEFT, right: DEFAULT_RIGHT };
    const parsed = JSON.parse(raw);
    const left =
      typeof parsed?.left === "number" && parsed.left >= MIN_COL
        ? parsed.left
        : DEFAULT_LEFT;
    const right =
      typeof parsed?.right === "number" && parsed.right >= MIN_COL
        ? parsed.right
        : DEFAULT_RIGHT;
    return { left, right };
  } catch {
    return { left: DEFAULT_LEFT, right: DEFAULT_RIGHT };
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export default function WorkspaceLayout({ mode, left, center, right }: Props) {
  const [widths, setWidths] = useState(() => loadWidths());
  const containerRef = useRef<HTMLDivElement>(null);
  const widthsRef = useRef(widths);
  const dragState = useRef<{
    side: "left" | "right";
    startX: number;
    startLeft: number;
    startRight: number;
    containerWidth: number;
  } | null>(null);

  // Keep ref in sync so the global mousemove handler always reads the
  // latest widths without re-attaching listeners on every state change.
  useEffect(() => {
    widthsRef.current = widths;
  }, [widths]);

  // Persist widths across reloads.
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(widths));
    } catch {
      // localStorage unavailable (SSR, quota) — non-fatal.
    }
  }, [widths]);

  const startDrag = (side: "left" | "right") => (e: React.MouseEvent) => {
    e.preventDefault();
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    dragState.current = {
      side,
      startX: e.clientX,
      startLeft: widthsRef.current.left,
      startRight: widthsRef.current.right,
      containerWidth: rect.width,
    };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  };

  useEffect(() => {
    const onMove = (ev: MouseEvent) => {
      const s = dragState.current;
      if (!s) return;
      const dx = ev.clientX - s.startX;
      const minCenter = mode === "manual" ? MIN_CENTER : 0;
      if (s.side === "left") {
        const maxLeft = s.containerWidth - widthsRef.current.right - minCenter;
        setWidths((w) => ({
          ...w,
          left: clamp(s.startLeft + dx, MIN_COL, Math.max(MIN_COL, maxLeft)),
        }));
      } else {
        const maxRight = s.containerWidth - widthsRef.current.left - minCenter;
        setWidths((w) => ({
          ...w,
          right: clamp(s.startRight - dx, MIN_COL, Math.max(MIN_COL, maxRight)),
        }));
      }
    };
    const onUp = () => {
      if (!dragState.current) return;
      dragState.current = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    return () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [mode]);

  const renderHandle = (side: "left" | "right") => (
    <div
      role="separator"
      aria-orientation="vertical"
      data-testid={`resize-handle-${side}`}
      onMouseDown={startDrag(side)}
      className="w-1 bg-outline-variant hover:bg-primary cursor-col-resize shrink-0 transition-colors"
    />
  );

  if (mode === "managed") {
    return (
      <div
        ref={containerRef}
        data-testid="workspace-layout"
        data-mode="managed"
        className="flex-1 flex overflow-hidden"
      >
        <div
          data-testid="left-column"
          style={{ width: widths.left }}
          className="overflow-y-auto shrink-0"
        >
          {left}
        </div>
        {renderHandle("left")}
        <aside
          data-testid="right-column"
          style={{ width: widths.right }}
          className="overflow-y-auto shrink-0"
        >
          {right}
        </aside>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      data-testid="workspace-layout"
      data-mode="manual"
      className="flex-1 flex overflow-hidden"
    >
      <aside
        data-testid="left-column"
        style={{ width: widths.left }}
        className="overflow-y-auto shrink-0"
      >
        {left}
      </aside>
      {renderHandle("left")}
      <main
        data-testid="center-column"
        className="flex-1 overflow-y-auto min-w-0"
      >
        {center}
      </main>
      {renderHandle("right")}
      <aside
        data-testid="right-column"
        style={{ width: widths.right }}
        className="overflow-y-auto shrink-0"
      >
        {right}
      </aside>
    </div>
  );
}