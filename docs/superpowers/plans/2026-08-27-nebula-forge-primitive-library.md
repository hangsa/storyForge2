# Nebula Forge Primitive Library — Implementation Plan (Plan 2 of 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the 11 remaining `ds/*` primitives (Buttons × 3, Inputs × 2, Display × 4, Layout × 2) that compose the refactored HomePage, plus extract the `STAGE_COLORS` + `STAGE_LABELS` maps into a shared `ds/stages.ts`. Each primitive ships TDD-style with a colocated test file.

**Architecture:** Source files live in `frontend/src/components/ds/`; tests live in `frontend/src/test/ds/` (matching the codebase's existing test convention — see `frontend/src/test/`). Shared constants (`STAGE_COLORS`, `STAGE_LABELS`, `isPreWizardStage`) live in `components/ds/stages.ts` so all stage-aware primitives read from one source. Material 3 utility classes (`bg-primary`, `text-on-surface-variant`, etc.) resolve via the CSS variables migrated in Plan 1 — primitives write `bg-surface-container` and the value is whatever Plan 1 set. No new CSS.

**Tech Stack:** TypeScript + React 18 + Tailwind 3 + Vitest + jsdom + @testing-library/react (frontend). No new dependencies.

**Spec:** `docs/superpowers/specs/2026-08-27-nebula-forge-homepage-refactor-design.md` (commit `bd0bed9`), §"Design-System Primitives".

**Depends on:** Plan 1 (CSS palette + Tailwind fontSize/fontFamily + `ds/tokens.ts` + `ds/BrandHeader`).

---

## Task 1: ds/stages.ts — extract STAGE_COLORS + STAGE_LABELS

**Files:**
- Create: `frontend/src/components/ds/stages.ts`
- Create: `frontend/src/components/ds/stages.test.ts`
- Modify (deferred): `frontend/src/components/home/BookShelf.tsx` and `frontend/src/components/home/BookShelfModal.tsx` will switch imports in Plan 3.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { STAGE_COLORS, STAGE_LABELS } from "../../components/ds/stages";

describe("stages constants", () => {
  const EXPECTED_STAGES = [
    "INIT", "STAGE1", "STAGE2", "STAGE3", "STAGE4", "STAGE5", "STAGE6", "COMPLETED",
  ] as const;

  it("STAGE_COLORS maps every known stage to a Tailwind utility class string", () => {
    for (const stage of EXPECTED_STAGES) {
      expect(STAGE_COLORS[stage]).toBeTruthy();
      expect(STAGE_COLORS[stage]).toMatch(/^bg-/);
      expect(STAGE_COLORS[stage]).toMatch(/text-/);
    }
  });

  it("INIT chip uses surface-tint (per spec table, not the legacy system-log token)", () => {
    expect(STAGE_COLORS.INIT).toBe("bg-surface-tint/20 text-surface-tint");
  });

  it("STAGE_LABELS exposes a Chinese label for every known stage", () => {
    for (const stage of EXPECTED_STAGES) {
      expect(STAGE_LABELS[stage]).toBeTruthy();
    }
    expect(STAGE_LABELS.STAGE4).toBe("工作台");
    expect(STAGE_LABELS.COMPLETED).toBe("已完成");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm test -- --run stages 2>&1 | tail -15`
Expected: FAIL with `Failed to resolve import "./stages"` or `Cannot find module './stages'`.

- [ ] **Step 3: Implement ds/stages.ts**

```ts
/**
 * Material 3 utility-class strings for each stage's status chip.
 * Sourced from the Nebula Forge design spec. Consumers wrap in a className
 * picker (e.g. `STAGE_COLORS[stage] ?? STAGE_COLORS.INIT`) — there's no
 * "unknown stage" color by design (callers always have a stage string).
 */
export const STAGE_COLORS: Record<string, string> = {
  INIT:      "bg-surface-tint/20 text-surface-tint",
  STAGE1:    "bg-blue-500/20 text-blue-300",
  STAGE2:    "bg-purple-500/20 text-purple-300",
  STAGE3:    "bg-amber-500/20 text-amber-300",
  STAGE4:    "bg-primary-container/20 text-primary-container",
  STAGE5:    "bg-pink-500/20 text-pink-300",
  STAGE6:    "bg-emerald-500/20 text-emerald-300",
  COMPLETED: "bg-green-500/20 text-green-300",
};

export const STAGE_LABELS: Record<string, string> = {
  INIT:      "初始化",
  STAGE1:    "概念",
  STAGE2:    "世界观",
  STAGE3:    "大纲",
  STAGE4:    "工作台",
  STAGE5:    "诊断",
  STAGE6:    "导出",
  COMPLETED: "已完成",
};

/**
 * True when the project is still mid-init-wizard. Bookshelf uses this to
 * decide between re-opening the wizard modal (resume at next uncompleted
 * step) and dropping the user into the workspace at /stage1.
 *
 * STAGE4+ means the wizard has finished (user clicked "进入工作台" on step 6).
 */
export function isPreWizardStage(stage: string): boolean {
  return stage === "INIT" || stage === "STAGE1" || stage === "STAGE2" || stage === "STAGE3";
}
```

Note: `STAGE_COLORS.INIT` is the spec's value (`bg-surface-tint/20 text-surface-tint`), replacing the legacy `bg-system-log/20 text-system-log` from the old `home/BookShelf.tsx`. Plan 3 updates the call sites.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npm test -- --run stages 2>&1 | tail -10`
Expected: PASS (3 tests, all green).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/ds/stages.ts frontend/src/components/ds/stages.test.ts
git commit -m "feat(ds): extract STAGE_COLORS + STAGE_LABELS into shared stages module"
```

---

## Task 2: ds/PrimaryButton — failing test

**Files:**
- Create: `frontend/src/test/ds/PrimaryButton.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import PrimaryButton from "../../components/ds/PrimaryButton";

describe("PrimaryButton", () => {
  it("renders the label", () => {
    render(<PrimaryButton label="查询" onClick={() => {}} />);
    expect(screen.getByRole("button", { name: "查询" })).toBeInTheDocument();
  });

  it("fires onClick when clicked", () => {
    const onClick = vi.fn();
    render(<PrimaryButton label="Go" onClick={onClick} />);
    fireEvent.click(screen.getByRole("button"));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("disables click and shows spinner when loading", () => {
    const onClick = vi.fn();
    render(<PrimaryButton label="查询" loading onClick={onClick} />);
    const btn = screen.getByRole("button");
    expect(btn).toBeDisabled();
    fireEvent.click(btn);
    expect(onClick).not.toHaveBeenCalled();
    // spinner replaces the icon (or label) — class-based check
    expect(btn.querySelector("svg, .animate-spin")).toBeInTheDocument();
  });

  it("does not fire onClick when disabled", () => {
    const onClick = vi.fn();
    render(<PrimaryButton label="查询" disabled onClick={onClick} />);
    fireEvent.click(screen.getByRole("button"));
    expect(onClick).not.toHaveBeenCalled();
  });

  it("renders an icon when icon prop is provided", () => {
    render(<PrimaryButton label="查询" icon="plus" onClick={() => {}} />);
    // plus icon renders as a material-symbols-outlined span
    expect(screen.getByText("plus")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm test -- --run PrimaryButton 2>&1 | tail -15`
Expected: FAIL with `Failed to resolve import "./PrimaryButton"`.

- [ ] **Step 3: (No commit yet — implementation follows in next task)**

---

## Task 3: ds/PrimaryButton — implement

**Files:**
- Create: `frontend/src/components/ds/PrimaryButton.tsx`

- [ ] **Step 1: Implement PrimaryButton**

```tsx
export interface PrimaryButtonProps {
  label: string;
  icon?: "plus" | "search" | "delete";
  iconPosition?: "leading" | "trailing";
  size?: "sm" | "md";
  loading?: boolean;
  disabled?: boolean;
  onClick: () => void;
}

const SIZE_CLASS: Record<NonNullable<PrimaryButtonProps["size"]>, string> = {
  sm: "px-3 py-1 text-sm",
  md: "px-4 py-2 text-base",
};

export default function PrimaryButton({
  label,
  icon,
  iconPosition = "leading",
  size = "md",
  loading = false,
  disabled = false,
  onClick,
}: PrimaryButtonProps) {
  const isDisabled = disabled || loading;
  const iconEl = loading ? (
    <span className="material-symbols-outlined animate-spin" aria-hidden="true">progress_activity</span>
  ) : icon ? (
    <span className="material-symbols-outlined" aria-hidden="true">{icon}</span>
  ) : null;

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={isDisabled}
      className={`inline-flex items-center gap-2 bg-primary text-on-primary rounded ${SIZE_CLASS[size]} hover:bg-primary/90 transition disabled:opacity-50 disabled:cursor-not-allowed`}
    >
      {iconEl && iconPosition === "leading" && iconEl}
      <span>{label}</span>
      {iconEl && iconPosition === "trailing" && iconEl}
    </button>
  );
}
```

- [ ] **Step 2: Run test to verify it passes**

Run: `cd frontend && npm test -- --run PrimaryButton 2>&1 | tail -10`
Expected: PASS (5 tests, all green).

- [ ] **Step 3: Commit**

```bash
git add frontend/src/test/ds/PrimaryButton.tsx frontend/src/components/ds/PrimaryButton.test.tsx
git commit -m "feat(ds): add PrimaryButton with loading + icon + size variants"
```

---

## Task 4: ds/SecondaryButton — test + impl

**Files:**
- Create: `frontend/src/test/ds/SecondaryButton.test.tsx`
- Create: `frontend/src/components/ds/SecondaryButton.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import SecondaryButton from "../../components/ds/SecondaryButton";

describe("SecondaryButton", () => {
  it("renders the label and fires onClick", () => {
    const onClick = vi.fn();
    render(<SecondaryButton label="删除" onClick={onClick} />);
    fireEvent.click(screen.getByRole("button", { name: "删除" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("uses error colors when variant is destructive", () => {
    render(<SecondaryButton label="删除" variant="destructive" onClick={() => {}} />);
    const btn = screen.getByRole("button");
    expect(btn.className).toMatch(/border-error-container/);
    expect(btn.className).toMatch(/text-error/);
  });

  it("uses default surface colors when variant is omitted", () => {
    render(<SecondaryButton label="取消" onClick={() => {}} />);
    const btn = screen.getByRole("button");
    expect(btn.className).toMatch(/border-outline-variant/);
    expect(btn.className).not.toMatch(/border-error-container/);
  });

  it("renders an icon when icon prop is provided", () => {
    render(<SecondaryButton label="删除" icon="delete" onClick={() => {}} />);
    expect(screen.getByText("delete")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm test -- --run SecondaryButton 2>&1 | tail -10`
Expected: FAIL with `Failed to resolve import`.

- [ ] **Step 3: Implement SecondaryButton**

```tsx
export interface SecondaryButtonProps {
  label: string;
  icon?: "plus" | "search" | "delete";
  variant?: "default" | "destructive";
  size?: "sm" | "md";
  disabled?: boolean;
  onClick: () => void;
}

const SIZE_CLASS: Record<NonNullable<SecondaryButtonProps["size"]>, string> = {
  sm: "px-3 py-1 text-sm",
  md: "px-4 py-2 text-base",
};

export default function SecondaryButton({
  label,
  icon,
  variant = "default",
  size = "md",
  disabled = false,
  onClick,
}: SecondaryButtonProps) {
  const colorClass =
    variant === "destructive"
      ? "border-error-container text-error"
      : "border-outline-variant text-on-surface";

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center gap-2 bg-surface-container border ${colorClass} rounded ${SIZE_CLASS[size]} hover:bg-surface-container-high transition disabled:opacity-50`}
    >
      {icon && <span className="material-symbols-outlined" aria-hidden="true">{icon}</span>}
      <span>{label}</span>
    </button>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npm test -- --run SecondaryButton 2>&1 | tail -10`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/test/ds/SecondaryButton.tsx frontend/src/components/ds/SecondaryButton.test.tsx
git commit -m "feat(ds): add SecondaryButton with destructive variant"
```

---

## Task 5: ds/GhostButton — test + impl

**Files:**
- Create: `frontend/src/test/ds/GhostButton.test.tsx`
- Create: `frontend/src/components/ds/GhostButton.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import GhostButton from "../../components/ds/GhostButton";

describe("GhostButton", () => {
  it("renders the label and fires onClick", () => {
    const onClick = vi.fn();
    render(<GhostButton label="查看全部 →" onClick={onClick} />);
    fireEvent.click(screen.getByRole("button", { name: "查看全部 →" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("uses font-mono + on-surface-variant styling", () => {
    render(<GhostButton label="清空" onClick={() => {}} />);
    const btn = screen.getByRole("button");
    expect(btn.className).toMatch(/font-mono/);
    expect(btn.className).toMatch(/text-on-surface-variant/);
  });

  it("is disabled when disabled prop is set", () => {
    render(<GhostButton label="清空" disabled onClick={() => {}} />);
    expect(screen.getByRole("button")).toBeDisabled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm test -- --run GhostButton 2>&1 | tail -10`
Expected: FAIL with `Failed to resolve import`.

- [ ] **Step 3: Implement GhostButton**

```tsx
export interface GhostButtonProps {
  label: string;
  size?: "sm" | "md";
  disabled?: boolean;
  onClick: () => void;
}

const SIZE_CLASS: Record<NonNullable<GhostButtonProps["size"]>, string> = {
  sm: "text-xs",
  md: "text-sm",
};

export default function GhostButton({
  label,
  size = "md",
  disabled = false,
  onClick,
}: GhostButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`font-mono text-on-surface-variant hover:text-primary transition disabled:opacity-50 ${SIZE_CLASS[size]}`}
    >
      {label}
    </button>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npm test -- --run GhostButton 2>&1 | tail -10`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/test/ds/GhostButton.tsx frontend/src/components/ds/GhostButton.test.tsx
git commit -m "feat(ds): add GhostButton text-link primitive"
```

---

## Task 6: ds/SearchInput — test + impl

**Files:**
- Create: `frontend/src/test/ds/SearchInput.test.tsx`
- Create: `frontend/src/components/ds/SearchInput.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import SearchInput from "../../components/ds/SearchInput";

describe("SearchInput", () => {
  it("renders with controlled value", () => {
    render(<SearchInput value="hello" onChange={() => {}} />);
    expect(screen.getByDisplayValue("hello")).toBeInTheDocument();
  });

  it("uses default placeholder '搜索项目…' when placeholder prop is omitted", () => {
    render(<SearchInput value="" onChange={() => {}} />);
    expect(screen.getByPlaceholderText("搜索项目…")).toBeInTheDocument();
  });

  it("fires onChange when the user types", () => {
    const onChange = vi.fn();
    render(<SearchInput value="" onChange={onChange} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "x" } });
    expect(onChange).toHaveBeenCalledWith("x");
  });

  it("uses a custom placeholder when provided", () => {
    render(<SearchInput value="" placeholder="搜索…" onChange={() => {}} />);
    expect(screen.getByPlaceholderText("搜索…")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm test -- --run SearchInput 2>&1 | tail -10`
Expected: FAIL with `Failed to resolve import`.

- [ ] **Step 3: Implement SearchInput**

```tsx
export interface SearchInputProps {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  width?: string;
}

export default function SearchInput({
  value,
  onChange,
  placeholder = "搜索项目…",
  width = "w-60",
}: SearchInputProps) {
  return (
    <div className={`relative ${width}`}>
      <span
        className="material-symbols-outlined absolute left-2.5 top-1/2 -translate-y-1/2 text-on-surface-variant pointer-events-none"
        aria-hidden="true"
      >
        search
      </span>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full bg-surface-container border border-outline-variant rounded pl-9 pr-3 py-1.5 text-sm text-primary placeholder:text-on-surface-variant/50 focus:outline-none focus:border-primary"
      />
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npm test -- --run SearchInput 2>&1 | tail -10`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/test/ds/SearchInput.tsx frontend/src/components/ds/SearchInput.test.tsx
git commit -m "feat(ds): add SearchInput with leading icon + Electric Blue focus border"
```

---

## Task 7: ds/DropdownSelect — test + impl

**Files:**
- Create: `frontend/src/test/ds/DropdownSelect.test.tsx`
- Create: `frontend/src/components/ds/DropdownSelect.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import DropdownSelect from "../../components/ds/DropdownSelect";

const OPTIONS = [
  { value: "all", label: "全部题材" },
  { value: "xuanhuan", label: "玄幻" },
  { value: "yanqing", label: "言情" },
];

describe("DropdownSelect", () => {
  it("renders the label and current value", () => {
    render(
      <DropdownSelect label="题材" options={OPTIONS} value="xuanhuan" onChange={() => {}} />
    );
    expect(screen.getByText("题材")).toBeInTheDocument();
    expect(screen.getByText("玄幻")).toBeInTheDocument();
  });

  it("opens options when clicked", () => {
    render(<DropdownSelect label="题材" options={OPTIONS} value="all" onChange={() => {}} />);
    expect(screen.queryByText("玄幻")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByText("玄幻")).toBeInTheDocument();
    expect(screen.getByText("言情")).toBeInTheDocument();
  });

  it("fires onChange when an option is picked", () => {
    const onChange = vi.fn();
    render(<DropdownSelect label="题材" options={OPTIONS} value="all" onChange={onChange} />);
    fireEvent.click(screen.getByRole("button"));
    fireEvent.click(screen.getByText("言情"));
    expect(onChange).toHaveBeenCalledWith("yanqing");
  });

  it("closes the dropdown after a selection", () => {
    render(<DropdownSelect label="题材" options={OPTIONS} value="all" onChange={() => {}} />);
    fireEvent.click(screen.getByRole("button"));
    fireEvent.click(screen.getByText("言情"));
    expect(screen.queryByText("玄幻")).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm test -- --run DropdownSelect 2>&1 | tail -10`
Expected: FAIL with `Failed to resolve import`.

- [ ] **Step 3: Implement DropdownSelect**

```tsx
import { useEffect, useRef, useState } from "react";

export interface DropdownSelectProps {
  label: string;
  options: Array<{ value: string; label: string }>;
  value: string;
  onChange: (v: string) => void;
}

export default function DropdownSelect({
  label,
  options,
  value,
  onChange,
}: DropdownSelectProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const currentLabel = options.find((o) => o.value === value)?.label ?? "";

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 bg-surface-container border border-outline-variant rounded px-3 py-1.5 text-sm text-primary hover:bg-surface-container-high"
      >
        <span className="font-mono text-on-surface-variant">{label}：</span>
        <span>{currentLabel}</span>
        <span
          className={`material-symbols-outlined text-base transition-transform ${open ? "rotate-180" : ""}`}
          aria-hidden="true"
        >
          expand_more
        </span>
      </button>
      {open && (
        <div className="absolute z-10 mt-1 w-full bg-surface-container-high border border-outline-variant rounded shadow-lg">
          {options.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => {
                onChange(opt.value);
                setOpen(false);
              }}
              className="block w-full text-left px-3 py-1.5 text-sm text-on-surface hover:bg-surface-container"
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npm test -- --run DropdownSelect 2>&1 | tail -10`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/test/ds/DropdownSelect.tsx frontend/src/components/ds/DropdownSelect.test.tsx
git commit -m "feat(ds): add DropdownSelect with click-outside close + chevron rotation"
```

---

## Task 8: ds/StatCard — test + impl

**Files:**
- Create: `frontend/src/test/ds/StatCard.test.tsx`
- Create: `frontend/src/components/ds/StatCard.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import StatCard from "../../components/ds/StatCard";

describe("StatCard", () => {
  it("renders label and value", () => {
    render(<StatCard label="总字数" value={45200} />);
    expect(screen.getByText("总字数")).toBeInTheDocument();
    expect(screen.getByText("45200")).toBeInTheDocument();
  });

  it("renders an em-dash when value is null", () => {
    render(<StatCard label="总字数" value={null} />);
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("appends the unit suffix when provided", () => {
    render(<StatCard label="字数" value={45.2} unit="w" />);
    expect(screen.getByText("45.2w")).toBeInTheDocument();
  });

  it("uses compact styling when size is sm", () => {
    const { container } = render(<StatCard label="字数" value={100} size="sm" />);
    // size="sm" → value rendered as text-base rather than text-stats-number
    const valueEl = container.querySelector(".text-base");
    expect(valueEl).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm test -- --run StatCard 2>&1 | tail -10`
Expected: FAIL with `Failed to resolve import`.

- [ ] **Step 3: Implement StatCard**

```tsx
import type { ReactNode } from "react";

export interface StatCardProps {
  label: string;
  value: number | string | null;
  sparkline?: ReactNode;
  size?: "sm" | "md";
  unit?: string;
}

export default function StatCard({
  label,
  value,
  sparkline,
  size = "md",
  unit,
}: StatCardProps) {
  const display = value === null ? "—" : `${value}${unit ?? ""}`;
  const valueClass =
    size === "sm"
      ? "font-mono text-base text-primary"
      : "font-mono text-stats-number text-primary";

  return (
    <div className="bg-surface-container-low border border-outline-variant rounded-lg p-3">
      <div className="font-mono text-label-sm uppercase tracking-wider text-on-surface-variant">
        {label}
      </div>
      <div className={`mt-1 ${valueClass}`}>{display}</div>
      {sparkline && <div className="mt-2">{sparkline}</div>}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npm test -- --run StatCard 2>&1 | tail -10`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/test/ds/StatCard.tsx frontend/src/components/ds/StatCard.test.tsx
git commit -m "feat(ds): add StatCard with null/unit/size variants"
```

---

## Task 9: ds/PanelCard — test + impl

**Files:**
- Create: `frontend/src/test/ds/PanelCard.test.tsx`
- Create: `frontend/src/components/ds/PanelCard.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import PanelCard from "../../components/ds/PanelCard";

describe("PanelCard", () => {
  it("renders children", () => {
    render(<PanelCard><span>hello</span></PanelCard>);
    expect(screen.getByText("hello")).toBeInTheDocument();
  });

  it("uses md padding (p-4) by default", () => {
    const { container } = render(<PanelCard>x</PanelCard>);
    expect(container.firstChild).toHaveClass("p-4");
  });

  it("applies the requested padding size", () => {
    const { container: sm } = render(<PanelCard padding="sm">x</PanelCard>);
    expect(sm.firstChild).toHaveClass("p-3");
    const { container: lg } = render(<PanelCard padding="lg">x</PanelCard>);
    expect(lg.firstChild).toHaveClass("p-6");
  });

  it("fires onClick when interactive and clicked", () => {
    const onClick = vi.fn();
    render(<PanelCard interactive onClick={onClick}>x</PanelCard>);
    fireEvent.click(screen.getByText("x"));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("adds cursor-pointer when interactive", () => {
    const { container } = render(<PanelCard interactive>x</PanelCard>);
    expect(container.firstChild).toHaveClass("cursor-pointer");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm test -- --run PanelCard 2>&1 | tail -10`
Expected: FAIL with `Failed to resolve import`.

- [ ] **Step 3: Implement PanelCard**

```tsx
import type { ReactNode } from "react";

export interface PanelCardProps {
  children: ReactNode;
  padding?: "sm" | "md" | "lg";
  interactive?: boolean;
  onClick?: () => void;
}

const PADDING_CLASS: Record<NonNullable<PanelCardProps["padding"]>, string> = {
  sm: "p-3",
  md: "p-4",
  lg: "p-6",
};

export default function PanelCard({
  children,
  padding = "md",
  interactive = false,
  onClick,
}: PanelCardProps) {
  const interactiveClass = interactive
    ? "cursor-pointer hover:border-primary-container/40"
    : "";

  return (
    <div
      onClick={interactive ? onClick : undefined}
      className={`bg-surface-container-low border border-outline-variant rounded-lg ${PADDING_CLASS[padding]} ${interactiveClass}`}
    >
      {children}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npm test -- --run PanelCard 2>&1 | tail -10`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/test/ds/PanelCard.tsx frontend/src/components/ds/PanelCard.test.tsx
git commit -m "feat(ds): add PanelCard with padding + interactive variants"
```

---

## Task 10: ds/PhaseIndicator — test + impl

**Files:**
- Create: `frontend/src/test/ds/PhaseIndicator.test.tsx`
- Create: `frontend/src/components/ds/PhaseIndicator.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import PhaseIndicator from "../../components/ds/PhaseIndicator";

const PHASES = [
  { key: "init", label: "初始化", count: 1 },
  { key: "stage1", label: "概念", count: 2, active: true },
  { key: "stage2", label: "世界观", count: 0, completed: true },
];

describe("PhaseIndicator", () => {
  it("renders every phase label and count", () => {
    render(<PhaseIndicator phases={PHASES} />);
    expect(screen.getByText("初始化")).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument();
    expect(screen.getByText("概念")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
  });

  it("marks the active phase with ring + animate-pulse", () => {
    const { container } = render(<PhaseIndicator phases={PHASES} />);
    const markers = container.querySelectorAll("span.bg-primary.rounded-full");
    expect(markers.length).toBeGreaterThan(0);
    const activeMarker = Array.from(markers).find((m) =>
      m.classList.contains("animate-pulse")
    );
    expect(activeMarker).toBeTruthy();
  });

  it("marks completed phases with bg-primary (solid)", () => {
    const { container } = render(<PhaseIndicator phases={PHASES} />);
    const completedMarker = container.querySelector(".bg-primary:not(.animate-pulse)");
    expect(completedMarker).toBeTruthy();
  });

  it("fires onPhaseClick with the clicked phase key", () => {
    const onPhaseClick = vi.fn();
    render(<PhaseIndicator phases={PHASES} onPhaseClick={onPhaseClick} />);
    fireEvent.click(screen.getByText("概念"));
    expect(onPhaseClick).toHaveBeenCalledWith("stage1");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm test -- --run PhaseIndicator 2>&1 | tail -10`
Expected: FAIL with `Failed to resolve import`.

- [ ] **Step 3: Implement PhaseIndicator**

```tsx
export interface PhaseIndicatorPhase {
  key: string;
  label: string;
  count: number;
  active?: boolean;
  completed?: boolean;
}

export interface PhaseIndicatorProps {
  phases: PhaseIndicatorPhase[];
  onPhaseClick?: (key: string) => void;
}

function markerClass(phase: PhaseIndicatorPhase): string {
  if (phase.active) return "w-2 h-2 rounded-full bg-primary ring-4 ring-primary/20 animate-pulse";
  if (phase.completed) return "w-2 h-2 rounded-full bg-primary";
  return "w-2 h-2 rounded-full bg-outline-variant";
}

export default function PhaseIndicator({ phases, onPhaseClick }: PhaseIndicatorProps) {
  return (
    <ul className="flex flex-col gap-2">
      {phases.map((p) => (
        <li key={p.key}>
          <button
            type="button"
            onClick={() => onPhaseClick?.(p.key)}
            className="flex items-center justify-between w-full text-left"
          >
            <span className="flex items-center gap-2">
              <span className={markerClass(p)} aria-hidden="true" />
              <span className="font-mono text-label-sm uppercase tracking-wider text-on-surface-variant">
                {p.label}
              </span>
            </span>
            <span className="text-label-sm text-on-surface font-mono">{p.count}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npm test -- --run PhaseIndicator 2>&1 | tail -10`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/test/ds/PhaseIndicator.tsx frontend/src/components/ds/PhaseIndicator.test.tsx
git commit -m "feat(ds): add PhaseIndicator with active/completed/click variants"
```

---

## Task 11: ds/ProjectTableRow — test + impl

**Files:**
- Create: `frontend/src/test/ds/ProjectTableRow.test.tsx`
- Create: `frontend/src/components/ds/ProjectTableRow.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ProjectSummary } from "../../api/client";
import ProjectTableRow from "../../components/ds/ProjectTableRow";
import { STAGE_COLORS, STAGE_LABELS } from "./stages";

const PROJECT: ProjectSummary = {
  id: "p1",
  title: "翻天",
  genre: "xuanhuan",
  current_stage: "STAGE4",
  created_at: "2026-01-01T00:00:00Z",
  updated_at: 1700000000,
  min_words: 1000,
  target_total_words: 200000,
  target_length_category: "标准连载",
  chapter_count: 118,
  word_count: 45200,
};

describe("ProjectTableRow", () => {
  it("renders the project title and stats", () => {
    render(<ProjectTableRow project={PROJECT} />);
    expect(screen.getByText("翻天")).toBeInTheDocument();
    expect(screen.getByText("118")).toBeInTheDocument();
    expect(screen.getByText("45.2w")).toBeInTheDocument();
  });

  it("renders the status chip with the spec color and label", () => {
    render(<ProjectTableRow project={PROJECT} />);
    const chip = screen.getByText(STAGE_LABELS.STAGE4);
    expect(chip).toBeInTheDocument();
    // The chip uses STAGE_COLORS[STAGE4] which must include 'bg-primary-container/20'
    const chipEl = chip.closest("span");
    expect(chipEl?.className).toMatch(/bg-primary-container\/20/);
  });

  it("fires onClick when row body is clicked", () => {
    const onClick = vi.fn();
    render(<ProjectTableRow project={PROJECT} onClick={onClick} />);
    fireEvent.click(screen.getByText("翻天"));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("does NOT fire onClick when the checkbox is toggled", () => {
    const onClick = vi.fn();
    const onSelectChange = vi.fn();
    render(
      <ProjectTableRow
        project={PROJECT}
        onClick={onClick}
        onSelectChange={onSelectChange}
      />
    );
    fireEvent.click(screen.getByRole("checkbox"));
    expect(onClick).not.toHaveBeenCalled();
    expect(onSelectChange).toHaveBeenCalledWith(true);
  });

  it("shows the left border when selected", () => {
    const { container } = render(<ProjectTableRow project={PROJECT} selected />);
    expect(container.firstChild).toHaveClass("border-l-4");
    expect(container.firstChild).toHaveClass("border-primary");
  });

  it("uses the INIT chip when current_stage is INIT", () => {
    render(<ProjectTableRow project={{ ...PROJECT, current_stage: "INIT" }} />);
    const chip = screen.getByText(STAGE_LABELS.INIT);
    expect(chip).toBeInTheDocument();
    // INIT should use surface-tint per ds/stages.ts (not system-log)
    expect(STAGE_COLORS.INIT).toMatch(/surface-tint/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm test -- --run ProjectTableRow 2>&1 | tail -10`
Expected: FAIL with `Failed to resolve import`.

- [ ] **Step 3: Implement ProjectTableRow**

```tsx
import type { ProjectSummary } from "../../api/client";
import { useGenres } from "../../hooks/useGenres";
import { STAGE_COLORS, STAGE_LABELS } from "./stages";

export interface ProjectTableRowProps {
  project: ProjectSummary;
  selected?: boolean;
  onClick?: () => void;
  onSelectChange?: (selected: boolean) => void;
}

function formatWordCount(n: number): string {
  if (n >= 10000) return `${(n / 10000).toFixed(1)}w`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

function formatDate(unixSeconds: number | string): string {
  const ts = typeof unixSeconds === "string" ? Date.parse(unixSeconds) / 1000 : unixSeconds;
  const d = new Date(ts * 1000);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export default function ProjectTableRow({
  project,
  selected = false,
  onClick,
  onSelectChange,
}: ProjectTableRowProps) {
  const genres = useGenres(false);
  const genreLabel = genres.find((g) => g.id === project.genre)?.label_zh ?? project.genre;
  const stage = project.current_stage;
  const chipClass = STAGE_COLORS[stage] ?? STAGE_COLORS.INIT;
  const stageLabel = STAGE_LABELS[stage] ?? stage;

  const selectedClass = selected ? "border-l-4 border-primary" : "border-l-4 border-transparent";

  return (
    <div
      role="row"
      onClick={onClick}
      className={`group grid grid-cols-[40px_2fr_1fr_1fr_1fr_1fr_120px] items-center px-3 py-2 border-b border-outline-variant hover:bg-surface-container-low cursor-pointer ${selectedClass}`}
    >
      <div className="flex items-center justify-center">
        <input
          type="checkbox"
          checked={selected}
          onChange={(e) => onSelectChange?.(e.target.checked)}
          onClick={(e) => e.stopPropagation()}
          className="opacity-0 group-hover:opacity-100 checked:opacity-100 w-4 h-4 accent-primary"
          aria-label="select row"
        />
      </div>
      <div className="flex items-center gap-2 min-w-0">
        <span className="material-symbols-outlined text-primary-container shrink-0" aria-hidden="true">
          auto_stories
        </span>
        <div className="flex flex-col min-w-0">
          <span className="font-display text-on-surface truncate">{project.title}</span>
          <div className="flex items-center gap-1">
            <span className="text-label-sm text-on-surface-variant font-mono">[{genreLabel}]</span>
            <span className={`text-label-sm px-1.5 py-0.5 rounded font-mono ${chipClass}`}>
              {stageLabel}
            </span>
          </div>
        </div>
      </div>
      <div className="text-center font-mono text-body-md text-on-surface">{project.chapter_count}</div>
      <div className="text-center font-mono text-body-md text-on-surface">
        {formatWordCount(project.word_count)}
      </div>
      <div className="text-center font-mono text-body-md text-on-surface-variant">
        {project.target_length_category}
      </div>
      <div className="text-right font-mono text-label-sm text-on-surface-variant">
        {formatDate(project.updated_at)}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npm test -- --run ProjectTableRow 2>&1 | tail -15`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/test/ds/ProjectTableRow.tsx frontend/src/components/ds/ProjectTableRow.test.tsx
git commit -m "feat(ds): add ProjectTableRow with selection + status chip + word formatting"
```

---

## Task 12: ds/Sidebar — test + impl

**Files:**
- Create: `frontend/src/test/ds/Sidebar.test.tsx`
- Create: `frontend/src/components/ds/Sidebar.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, beforeEach } from "vitest";
import Sidebar from "../../components/ds/Sidebar";

describe("Sidebar", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("renders header, children, and footer", () => {
    render(
      <Sidebar header={<span>brand</span>} footer={<span>foot</span>}>
        <span>body</span>
      </Sidebar>
    );
    expect(screen.getByText("brand")).toBeInTheDocument();
    expect(screen.getByText("body")).toBeInTheDocument();
    expect(screen.getByText("foot")).toBeInTheDocument();
  });

  it("toggles collapsed state when the toggle button is clicked", () => {
    render(
      <Sidebar header={<span>brand</span>} persistKey="test.sidebar">
        <span data-testid="content">body</span>
      </Sidebar>
    );
    expect(screen.getByTestId("content")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /collapse/i }));
    // After collapse, content still in DOM but width reduced
    const sidebar = screen.getByTestId("content").closest("aside, div");
    expect(sidebar).toBeTruthy();
  });

  it("persists collapsed state to localStorage under the provided key", () => {
    render(
      <Sidebar header={<span>brand</span>} persistKey="test.sidebar.persist">
        <span>x</span>
      </Sidebar>
    );
    fireEvent.click(screen.getByRole("button", { name: /collapse/i }));
    expect(localStorage.getItem("test.sidebar.persist")).toBe("true");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm test -- --run Sidebar 2>&1 | tail -10`
Expected: FAIL with `Failed to resolve import`.

- [ ] **Step 3: Implement Sidebar**

```tsx
import { useEffect, useState, type ReactNode } from "react";

export interface SidebarProps {
  width?: number;
  collapsedWidth?: number;
  collapsible?: boolean;
  persistKey?: string;
  header?: ReactNode;
  children: ReactNode;
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
        {showText ? header : null}
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
      <div className="flex-1 overflow-y-auto p-3">{children}</div>
      {footer && (
        <div className="p-3 border-t border-outline-variant">{showText ? footer : null}</div>
      )}
    </aside>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npm test -- --run Sidebar 2>&1 | tail -10`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/test/ds/Sidebar.tsx frontend/src/components/ds/Sidebar.test.tsx
git commit -m "feat(ds): add Sidebar with collapsible state + localStorage persistence"
```

---

## Task 13: ds/SidebarNavItem — test + impl

**Files:**
- Create: `frontend/src/test/ds/SidebarNavItem.test.tsx`
- Create: `frontend/src/components/ds/SidebarNavItem.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import SidebarNavItem from "../../components/ds/SidebarNavItem";

describe("SidebarNavItem", () => {
  it("renders the icon and label by default", () => {
    render(<SidebarNavItem icon="home" label="主页" />);
    expect(screen.getByText("home")).toBeInTheDocument();
    expect(screen.getByText("主页")).toBeInTheDocument();
  });

  it("applies active border + background when active", () => {
    const { container } = render(<SidebarNavItem icon="home" label="主页" active />);
    expect(container.firstChild).toHaveClass("border-primary");
    expect(container.firstChild).toHaveClass("bg-surface-container");
  });

  it("hides the label when collapsed", () => {
    render(<SidebarNavItem icon="home" label="主页" collapsed />);
    expect(screen.queryByText("主页")).not.toBeInTheDocument();
    expect(screen.getByText("home")).toBeInTheDocument();
  });

  it("fires onClick when clicked", () => {
    const onClick = vi.fn();
    render(<SidebarNavItem icon="home" label="主页" onClick={onClick} />);
    fireEvent.click(screen.getByRole("button"));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm test -- --run SidebarNavItem 2>&1 | tail -10`
Expected: FAIL with `Failed to resolve import`.

- [ ] **Step 3: Implement SidebarNavItem**

```tsx
export interface SidebarNavItemProps {
  icon: string;
  label: string;
  active?: boolean;
  onClick?: () => void;
  collapsed?: boolean;
}

export default function SidebarNavItem({
  icon,
  label,
  active = false,
  onClick,
  collapsed = false,
}: SidebarNavItemProps) {
  const activeClass = active
    ? "bg-surface-container text-primary border-l-2 border-primary -ml-0.5 pl-3.5"
    : "text-on-surface-variant hover:text-primary hover:bg-surface-container-low";

  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full flex items-center gap-2 py-2 pl-4 pr-3 text-sm transition border-l-2 border-transparent ${activeClass}`}
    >
      <span className="material-symbols-outlined" aria-hidden="true">
        {icon}
      </span>
      {!collapsed && <span>{label}</span>}
    </button>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npm test -- --run SidebarNavItem 2>&1 | tail -10`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/test/ds/SidebarNavItem.tsx frontend/src/components/ds/SidebarNavItem.test.tsx
git commit -m "feat(ds): add SidebarNavItem with active + collapsed variants"
```

---

## Task 14: ds/index.ts — full barrel export

**Files:**
- Modify: `frontend/src/components/ds/index.ts`

- [ ] **Step 1: Replace the barrel to re-export every primitive + shared types**

```ts
// Nebula Forge design-system primitives.
// Re-exported here so consumers can `import { BrandHeader, PrimaryButton } from "../components/ds"`
// instead of reaching into individual files.

export { default as BrandHeader } from "./BrandHeader";
export type { BrandHeaderProps } from "./BrandHeader";

export { default as PrimaryButton } from "./PrimaryButton";
export type { PrimaryButtonProps } from "./PrimaryButton";

export { default as SecondaryButton } from "./SecondaryButton";
export type { SecondaryButtonProps } from "./SecondaryButton";

export { default as GhostButton } from "./GhostButton";
export type { GhostButtonProps } from "./GhostButton";

export { default as SearchInput } from "./SearchInput";
export type { SearchInputProps } from "./SearchInput";

export { default as DropdownSelect } from "./DropdownSelect";
export type { DropdownSelectProps } from "./DropdownSelect";

export { default as StatCard } from "./StatCard";
export type { StatCardProps } from "./StatCard";

export { default as PanelCard } from "./PanelCard";
export type { PanelCardProps } from "./PanelCard";

export { default as PhaseIndicator } from "./PhaseIndicator";
export type { PhaseIndicatorProps, PhaseIndicatorPhase } from "./PhaseIndicator";

export { default as ProjectTableRow } from "./ProjectTableRow";
export type { ProjectTableRowProps } from "./ProjectTableRow";

export { default as Sidebar } from "./Sidebar";
export type { SidebarProps } from "./Sidebar";

export { default as SidebarNavItem } from "./SidebarNavItem";
export type { SidebarNavItemProps } from "./SidebarNavItem";

export { STAGE_COLORS, STAGE_LABELS, isPreWizardStage } from "./stages";
```

- [ ] **Step 2: Type-check**

Run: `cd frontend && npx tsc --noEmit`
Expected: exit 0. If `PhaseIndicatorPhase` isn't actually exported from `./PhaseIndicator` (e.g., the impl file uses an inline-only interface), fix by adding `export type { PhaseIndicatorPhase }` to `ds/PhaseIndicator.tsx`.

- [ ] **Step 3: Run all ds/ tests as one suite**

Run: `cd frontend && npm test -- --run 'ds' 2>&1 | tail -20`
Expected: PASS — all primitive tests green in one run.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/ds/index.ts frontend/src/components/ds/PhaseIndicator.tsx
git commit -m "feat(ds): export all 12 primitives + stage constants from barrel"
```

---

## Task 15: Final regression — Plan 2 doesn't break Plan 1

**Files:** (no file changes)

- [ ] **Step 1: Run the full frontend test suite**

Run: `cd frontend && npm test -- --run 2>&1 | tail -30`
Expected: PASS. Pre-existing tests may still reference the old `STAGE_COLORS` from `home/stages.ts` via `home/BookShelf.tsx` and `home/BookShelfModal.tsx` — those files still work because their local `STAGE_COLORS` definitions are unchanged. Plan 3 will delete the duplicates.

- [ ] **Step 2: Type-check backend (sanity, no backend changes in Plan 2)**

Run: `cd backend && python -c "from backend.api.project import list_projects; print('OK')"`
Expected: prints `OK`.

- [ ] **Step 3: Commit summary report (no commit needed if no changes)**

Tell the user:
- Plan 2 complete; 12 primitives + shared stages.ts shipped; all primitive tests green.
- Hand off to Plan 3 (HomePage assembly + cleanup) which rewires consumers and deletes obsolete files.