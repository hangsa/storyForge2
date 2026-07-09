import { useEffect, useRef } from "react";

interface ResizeHandleProps {
  width: number;
  onLiveChange: (w: number) => void;
  onCommit: (w: number) => void;
}

export default function ResizeHandle({
  width,
  onLiveChange,
  onCommit,
}: ResizeHandleProps) {
  const initialClientXRef = useRef<number | null>(null);
  const initialWidthRef = useRef<number | null>(null);
  const currentWidthRef = useRef<number>(width);

  useEffect(() => {
    currentWidthRef.current = width;
  }, [width]);

  useEffect(() => {
    return () => {
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, []);

  function handlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    initialClientXRef.current = e.clientX;
    initialWidthRef.current = currentWidthRef.current;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // ignore in test envs without Pointer Capture support
    }
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }

  function handlePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (
      initialClientXRef.current === null ||
      initialWidthRef.current === null
    )
      return;
    const next =
      initialWidthRef.current + (e.clientX - initialClientXRef.current);
    currentWidthRef.current = next;
    onLiveChange(next);
  }

  function handlePointerUp(e: React.PointerEvent<HTMLDivElement>) {
    if (
      initialClientXRef.current === null ||
      initialWidthRef.current === null
    )
      return;
    onCommit(currentWidthRef.current);
    initialClientXRef.current = null;
    initialWidthRef.current = null;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  }

  return (
    <div
      data-testid="resize-handle"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      className="absolute inset-y-0 right-0 w-1 cursor-col-resize hover:bg-primary-container/30 active:bg-primary-container/50"
    />
  );
}
