import type { ReactNode } from "react";
import type { WorkspaceMode } from "../../hooks/useWorkspaceMode";

interface Props {
  mode: WorkspaceMode;
  left: ReactNode;
  /** Only rendered in manual mode. */
  center?: ReactNode;
  right: ReactNode;
}

export default function WorkspaceLayout({ mode, left, center, right }: Props) {
  if (mode === "managed") {
    return (
      <div
        data-testid="workspace-layout"
        data-mode="managed"
        className="flex-1 flex overflow-hidden"
      >
        <div className="flex-1 overflow-y-auto">{left}</div>
        <aside className="w-[320px] border-l border-outline-variant overflow-y-auto shrink-0">
          {right}
        </aside>
      </div>
    );
  }
  return (
    <div
      data-testid="workspace-layout"
      data-mode="manual"
      className="flex-1 flex overflow-hidden"
    >
      <aside className="w-[260px] border-r border-outline-variant overflow-y-auto shrink-0">
        {left}
      </aside>
      <main className="flex-1 overflow-y-auto">{center}</main>
      <aside className="w-[360px] border-l border-outline-variant overflow-y-auto shrink-0">
        {right}
      </aside>
    </div>
  );
}
