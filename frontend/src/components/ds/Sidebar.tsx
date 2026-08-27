import { useEffect, useState, type ReactNode } from "react";

export interface SidebarProps {
  width?: number;
  collapsedWidth?: number;
  collapsible?: boolean;
  persistKey?: string;
  header?: ReactNode;
  children: ReactNode | ((collapsed: boolean) => ReactNode);
  footer?: ReactNode;
}

export default function Sidebar({
  width = 300,
  collapsedWidth = 52,
  collapsible = true,
  persistKey = "ds.sidebar.collapsed",
  header,
  children,
  footer,
}: SidebarProps) {
  const [collapsedState, setCollapsed] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(persistKey) === "true";
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(persistKey, String(collapsedState));
  }, [collapsedState, persistKey]);

  const currentWidth = collapsedState ? collapsedWidth : width;
  const showText = !collapsedState;

  return (
    <aside
      style={{ width: currentWidth }}
      className="shrink-0 bg-canvas-bg border-r border-outline-variant flex flex-col transition-[width] duration-200"
    >
      <div className="flex items-center justify-between p-3 border-b border-outline-variant">
        {header}
        {collapsible && (
          <button
            type="button"
            aria-label={collapsedState ? "expand sidebar" : "collapse sidebar"}
            onClick={() => setCollapsed((v) => !v)}
            className="text-on-surface-variant hover:text-primary"
          >
            <span className="material-symbols-outlined" aria-hidden="true">
              {collapsedState ? "chevron_right" : "chevron_left"}
            </span>
          </button>
        )}
      </div>
      <div className="flex-1 overflow-y-auto p-3">
        {typeof children === "function" ? children(collapsedState) : children}
      </div>
      {footer && (
        <div className="p-3 border-t border-outline-variant">{showText ? footer : null}</div>
      )}
    </aside>
  );
}