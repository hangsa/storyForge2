import type { JSX } from "react";

interface SubTab {
  key: string;
  label: string;
  testidSuffix?: string;
}

interface SubTabStripProps {
  tabs: SubTab[];
  active: string;
  onChange: (key: string) => void;
  testidPrefix: string;
}

/**
 * 2026-09-21: 从 WorldStep.tsx file-internal 版本提取到 shared, 供 CharacterStep 复用。
 * 视觉与交互不变 (sticky 横条, ←/→ 切换由调用方在外层实现)。
 */
export function SubTabStrip({ tabs, active, onChange, testidPrefix }: SubTabStripProps): JSX.Element {
  return (
    <div
      role="tablist"
      data-testid={`${testidPrefix}-strip`}
      className="sticky top-[40px] z-[5] -mx-1 px-1 bg-surface-container-low/95 backdrop-blur-sm flex gap-1 border-b border-outline-variant overflow-x-auto"
    >
      {tabs.map((t) => {
        const isActive = t.key === active;
        const tid = `${testidPrefix}-${t.testidSuffix ?? t.key}`;
        return (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={isActive}
            aria-controls={`${testidPrefix}-panel-${t.key}`}
            data-testid={tid}
            onClick={() => onChange(t.key)}
            className={
              "shrink-0 px-2 py-1 text-sm font-display font-medium border-b-2 -mb-px inline-flex items-center gap-1 whitespace-nowrap transition-colors outline-none focus-visible:ring-2 ring-primary-container " +
              (isActive
                ? "border-primary text-primary"
                : "border-transparent text-on-surface-variant hover:text-primary")
            }
          >
            <span>{t.label}</span>
          </button>
        );
      })}
    </div>
  );
}