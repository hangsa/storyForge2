import { ReactNode, useEffect, useRef } from "react";
import {
  DrawerTab, DRAWER_TAB_LABELS,
  DRAWER_PEEK_HEIGHT_PX, DRAWER_EXPANDED_HEIGHT_PX, DRAWER_SLIDE_DURATION_MS,
  DRAWER_TABLIST_ID,
} from "../../types/stage4";

interface Stage4DrawerProps {
  counts: {
    precheck: number;
    impact: number;
    exemption: number;
    sfLogSuggestions: number;
  };
  activeTab: DrawerTab | null;
  onTabChange: (tab: DrawerTab) => void;
  onCollapse: () => void;
  children: {
    precheck: ReactNode;
    impact: ReactNode;
    exemption: ReactNode;
    sfLogSuggestions: ReactNode;
  };
}

const TABS: DrawerTab[] = ["precheck", "impact", "exemption", "sfLogSuggestions"];

function badgeClass(urgency: "action" | "info"): string {
  return `drawer-badge drawer-badge--${urgency}`;
}

export default function Stage4Drawer({ counts, activeTab, onTabChange, onCollapse, children }: Stage4DrawerProps) {
  const tablistRef = useRef<HTMLDivElement>(null);
  const isExpanded = activeTab !== null;

  // Escape to collapse.
  useEffect(() => {
    if (!isExpanded) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onCollapse();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [isExpanded, onCollapse]);

  // Roving tabindex + arrow keys.
  function onTabKeyDown(e: React.KeyboardEvent<HTMLButtonElement>, current: DrawerTab) {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft" && e.key !== "Home" && e.key !== "End") return;
    e.preventDefault();
    const i = TABS.indexOf(current);
    const next =
      e.key === "ArrowRight" ? TABS[(i + 1) % TABS.length] :
      e.key === "ArrowLeft"  ? TABS[(i - 1 + TABS.length) % TABS.length] :
      e.key === "Home"       ? TABS[0] :
                              TABS[TABS.length - 1];
    onTabChange(next);
  }

  return (
    <div
      className="stage4-drawer"
      style={{
        position: "fixed",
        bottom: 0, left: 0, right: 0,
        height: isExpanded ? DRAWER_EXPANDED_HEIGHT_PX : DRAWER_PEEK_HEIGHT_PX,
        transition: `height ${DRAWER_SLIDE_DURATION_MS}ms`,
        zIndex: 50,
        background: "var(--drawer-bg, rgba(20,20,30,0.85))",
        color: "inherit",
      }}
    >
      <button
        type="button"
        className="drawer-collapse-btn"
        onClick={onCollapse}
        aria-label="收起"
        style={{ position: "absolute", top: 4, right: 8 }}
      >×</button>
      <div
        ref={tablistRef}
        role="tablist"
        id={DRAWER_TABLIST_ID}
        aria-label="Stage4 抽屉"
        className="drawer-strip"
        aria-live="polite"
        style={{ display: "flex", gap: 12, padding: "8px 16px" }}
      >
        {TABS.map((tab) => {
          const count = counts[tab];
          const urgency: "action" | "info" =
            tab === "exemption" ? "action" : "info";
          const selected = activeTab === tab;
          return (
            <button
              key={tab}
              type="button"
              id={`drawer-tab-${tab}`}
              role="tab"
              aria-selected={selected}
              aria-controls={`drawer-panel-${tab}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => onTabChange(tab)}
              onKeyDown={(e) => onTabKeyDown(e, tab)}
            >
              {DRAWER_TAB_LABELS[tab]} {count > 0 && (
                <span className={badgeClass(urgency)}>{count}</span>
              )}
            </button>
          );
        })}
      </div>
      {isExpanded && (
        <div
          id={`drawer-panel-${activeTab}`}
          role="tabpanel"
          aria-labelledby={`drawer-tab-${activeTab}`}
          aria-busy={false}
          className="drawer-panel"
          style={{ padding: 16, height: DRAWER_EXPANDED_HEIGHT_PX - DRAWER_PEEK_HEIGHT_PX - 16, overflow: "auto" }}
        >
          {children[activeTab]}
        </div>
      )}
    </div>
  );
}