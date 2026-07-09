# 左侧导航栏：收起/展开 + 拖拽调宽度 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 `SideNavBar` 加收起/展开与拖拽调宽度能力，状态与宽度持久化到 localStorage。

**Architecture:** 新增 `useSidebar` hook 封装 state + localStorage 持久化 + 边界裁剪；新增 `ResizeHandle`（拖拽手柄）与 `SidebarToggleButton`（TopHeader 汉堡按钮）两个小组件；`MainLayout` 通过 hook 取状态并透传给 `SideNavBar` / `TopHeader`。

**Tech Stack:** React 18 + TypeScript + Tailwind CSS + Vitest + @testing-library/react

---

## File Map

**新增文件：**
- `frontend/src/hooks/useSidebar.ts` — 状态 + localStorage + 裁剪 + toggle
- `frontend/src/components/layout/ResizeHandle.tsx` — 拖拽手柄（pointer events）
- `frontend/src/components/layout/SidebarToggleButton.tsx` — 汉堡按钮
- `frontend/src/test/hooks/useSidebar.test.ts` — hook 单测
- `frontend/src/test/ResizeHandle.test.tsx` — 手柄单测
- `frontend/src/test/SidebarToggleButton.test.tsx` — 按钮单测

**修改文件：**
- `frontend/src/components/layout/MainLayout.tsx` — 调 hook，透传 state
- `frontend/src/components/layout/SideNavBar.tsx` — 新增 props + collapsed 时返回 null + 末尾挂 ResizeHandle
- `frontend/src/components/layout/TopHeader.tsx` — 新增 props + 最左渲染 SidebarToggleButton
- `frontend/src/test/layout.test.tsx` — 更新 render 调用 + 新增 collapsed/hamburger 用例

---

## Task 1: `useSidebar` hook —— 初始化逻辑

**Files:**
- Create: `frontend/src/hooks/useSidebar.ts`
- Create: `frontend/src/test/hooks/useSidebar.test.ts`

- [ ] **Step 1.1: 写失败测试 —— 默认状态 / 从 localStorage 恢复 / 越界裁剪 / 异常回落**

在 `frontend/src/test/hooks/useSidebar.test.ts` 写入：

```ts
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
```

- [ ] **Step 1.2: 运行测试，确认失败**

```bash
cd frontend && npx vitest run src/test/hooks/useSidebar.test.ts
```

预期：FAIL — `Cannot find module '../../hooks/useSidebar'` 或类似。

- [ ] **Step 1.3: 实现 hook（仅初始化逻辑）**

创建 `frontend/src/hooks/useSidebar.ts`：

```ts
import { useState, useCallback } from "react";

const STORAGE_KEY = "storyforge.sidebar";
const DEFAULT_WIDTH = 280;
const MIN = 200;
const MAX = 480;

interface PersistedState {
  collapsed: boolean;
  width: number;
}

function loadFromStorage(): PersistedState {
  const fallback: PersistedState = { collapsed: false, width: DEFAULT_WIDTH };
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch {
    return fallback;
  }
  if (!raw) return fallback;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return fallback;
  }
  if (typeof parsed !== "object" || parsed === null) return fallback;
  const obj = parsed as Record<string, unknown>;
  const widthNum = typeof obj.width === "number" ? obj.width : DEFAULT_WIDTH;
  const collapsedBool = typeof obj.collapsed === "boolean" ? obj.collapsed : false;
  const clampedWidth = Math.max(MIN, Math.min(MAX, widthNum));
  return { collapsed: collapsedBool, width: clampedWidth };
}

function saveToStorage(state: PersistedState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // ignore
  }
}

export interface UseSidebarReturn {
  collapsed: boolean;
  width: number;
  MIN: number;
  MAX: number;
  setWidthLive: (w: number) => void;
  commitWidth: (w: number) => void;
  toggle: () => void;
}

export function useSidebar(): UseSidebarReturn {
  const initial = loadFromStorage();
  const [collapsed, setCollapsed] = useState<boolean>(initial.collapsed);
  const [width, setWidth] = useState<number>(initial.width);

  return {
    collapsed,
    width,
    MIN,
    MAX,
    setWidthLive: () => {},
    commitWidth: () => {},
    toggle: () => {},
  };
}
```

- [ ] **Step 1.4: 运行测试，确认通过**

```bash
cd frontend && npx vitest run src/test/hooks/useSidebar.test.ts
```

预期：全部 8 个用例 PASS。

- [ ] **Step 1.5: Commit**

```bash
git add frontend/src/hooks/useSidebar.ts frontend/src/test/hooks/useSidebar.test.ts
git commit -m "feat(sidebar): add useSidebar hook with init logic + localStorage"
```

---

## Task 2: `useSidebar` hook —— 修改逻辑（toggle / setWidthLive / commitWidth）

**Files:**
- Modify: `frontend/src/hooks/useSidebar.ts`
- Modify: `frontend/src/test/hooks/useSidebar.test.ts`

- [ ] **Step 2.1: 追加失败测试 —— 修改行为**

在 `frontend/src/test/hooks/useSidebar.test.ts` 末尾追加：

```ts
describe("useSidebar - mutations", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("toggle flips collapsed and persists", () => {
    const { result } = renderHook(() => useSidebar());
    expect(result.current.collapsed).toBe(false);
    act(() => result.current.toggle());
    expect(result.current.collapsed).toBe(true);
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    expect(stored).toEqual({ collapsed: true, width: 280 });

    act(() => result.current.toggle());
    expect(result.current.collapsed).toBe(false);
    const stored2 = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    expect(stored2.collapsed).toBe(false);
  });

  it("toggle persists current width, not stale", () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ collapsed: false, width: 280 })
    );
    const { result } = renderHook(() => useSidebar());
    act(() => result.current.commitWidth(350));
    expect(result.current.width).toBe(350);
    act(() => result.current.toggle());
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    expect(stored.width).toBe(350);
  });

  it("setWidthLive updates state but does NOT persist", () => {
    const setItemSpy = vi.spyOn(Storage.prototype, "setItem");
    const { result } = renderHook(() => useSidebar());
    act(() => result.current.setWidthLive(400));
    expect(result.current.width).toBe(400);
    expect(setItemSpy).not.toHaveBeenCalled();
    setItemSpy.mockRestore();
  });

  it("commitWidth clamps to MIN/MAX and persists", () => {
    const setItemSpy = vi.spyOn(Storage.prototype, "setItem");
    const { result } = renderHook(() => useSidebar());

    act(() => result.current.commitWidth(50));
    expect(result.current.width).toBe(200);
    expect(setItemSpy).toHaveBeenLastCalledWith(
      STORAGE_KEY,
      JSON.stringify({ collapsed: false, width: 200 })
    );

    act(() => result.current.commitWidth(999));
    expect(result.current.width).toBe(480);
    expect(setItemSpy).toHaveBeenLastCalledWith(
      STORAGE_KEY,
      JSON.stringify({ collapsed: false, width: 480 })
    );

    setItemSpy.mockRestore();
  });
});
```

- [ ] **Step 2.2: 运行测试，确认失败**

```bash
cd frontend && npx vitest run src/test/hooks/useSidebar.test.ts
```

预期：4 个 mutation 用例 FAIL（因为现在的实现是空函数）。

- [ ] **Step 2.3: 替换 hook 实现为完整版**

修改 `frontend/src/hooks/useSidebar.ts`：

```ts
import { useState, useCallback } from "react";

const STORAGE_KEY = "storyforge.sidebar";
const DEFAULT_WIDTH = 280;
const MIN = 200;
const MAX = 480;

interface PersistedState {
  collapsed: boolean;
  width: number;
}

function loadFromStorage(): PersistedState {
  const fallback: PersistedState = { collapsed: false, width: DEFAULT_WIDTH };
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch {
    return fallback;
  }
  if (!raw) return fallback;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return fallback;
  }
  if (typeof parsed !== "object" || parsed === null) return fallback;
  const obj = parsed as Record<string, unknown>;
  const widthNum = typeof obj.width === "number" ? obj.width : DEFAULT_WIDTH;
  const collapsedBool =
    typeof obj.collapsed === "boolean" ? obj.collapsed : false;
  const clampedWidth = Math.max(MIN, Math.min(MAX, widthNum));
  return { collapsed: collapsedBool, width: clampedWidth };
}

function saveToStorage(state: PersistedState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // ignore
  }
}

export interface UseSidebarReturn {
  collapsed: boolean;
  width: number;
  MIN: number;
  MAX: number;
  setWidthLive: (w: number) => void;
  commitWidth: (w: number) => void;
  toggle: () => void;
}

function clamp(w: number): number {
  return Math.max(MIN, Math.min(MAX, w));
}

export function useSidebar(): UseSidebarReturn {
  const initial = loadFromStorage();
  const [collapsed, setCollapsed] = useState<boolean>(initial.collapsed);
  const [width, setWidth] = useState<number>(initial.width);

  const setWidthLive = useCallback((w: number) => {
    setWidth(clamp(w));
  }, []);

  const commitWidth = useCallback(
    (w: number) => {
      const next = clamp(w);
      setWidth(next);
      saveToStorage({ collapsed, width: next });
    },
    [collapsed]
  );

  const toggle = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      saveToStorage({ collapsed: next, width });
      return next;
    });
  }, [width]);

  return {
    collapsed,
    width,
    MIN,
    MAX,
    setWidthLive,
    commitWidth,
    toggle,
  };
}
```

- [ ] **Step 2.4: 运行测试，确认通过**

```bash
cd frontend && npx vitest run src/test/hooks/useSidebar.test.ts
```

预期：全部 12 个用例 PASS。

- [ ] **Step 2.5: Commit**

```bash
git add frontend/src/hooks/useSidebar.ts frontend/src/test/hooks/useSidebar.test.ts
git commit -m "feat(sidebar): implement toggle, setWidthLive, commitWidth"
```

---

## Task 3: `SidebarToggleButton` 组件

**Files:**
- Create: `frontend/src/components/layout/SidebarToggleButton.tsx`
- Create: `frontend/src/test/SidebarToggleButton.test.tsx`

- [ ] **Step 3.1: 写失败测试 —— 渲染 / 点击 / ARIA**

创建 `frontend/src/test/SidebarToggleButton.test.tsx`：

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import SidebarToggleButton from "../../components/layout/SidebarToggleButton";

describe("SidebarToggleButton", () => {
  it("renders a menu icon", () => {
    render(<SidebarToggleButton collapsed={false} onToggle={() => {}} />);
    expect(screen.getByText("menu")).toBeInTheDocument();
  });

  it("calls onToggle when clicked", () => {
    const onToggle = vi.fn();
    render(<SidebarToggleButton collapsed={false} onToggle={onToggle} />);
    fireEvent.click(screen.getByRole("button"));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("title/aria-label/aria-expanded reflect collapsed state", () => {
    const { rerender } = render(
      <SidebarToggleButton collapsed={false} onToggle={() => {}} />
    );
    const btn = screen.getByRole("button");
    expect(btn).toHaveAttribute("title", "收起侧边栏");
    expect(btn).toHaveAttribute("aria-label", "收起侧边栏");
    expect(btn).toHaveAttribute("aria-expanded", "true");

    rerender(<SidebarToggleButton collapsed={true} onToggle={() => {}} />);
    expect(btn).toHaveAttribute("title", "展开侧边栏");
    expect(btn).toHaveAttribute("aria-label", "展开侧边栏");
    expect(btn).toHaveAttribute("aria-expanded", "false");
  });
});
```

- [ ] **Step 3.2: 运行测试，确认失败**

```bash
cd frontend && npx vitest run src/test/SidebarToggleButton.test.tsx
```

预期：FAIL — `Cannot find module` 或 render error。

- [ ] **Step 3.3: 实现组件**

创建 `frontend/src/components/layout/SidebarToggleButton.tsx`：

```tsx
interface SidebarToggleButtonProps {
  collapsed: boolean;
  onToggle: () => void;
}

export default function SidebarToggleButton({
  collapsed,
  onToggle,
}: SidebarToggleButtonProps) {
  const label = collapsed ? "展开侧边栏" : "收起侧边栏";
  return (
    <button
      type="button"
      onClick={onToggle}
      title={label}
      aria-label={label}
      aria-expanded={!collapsed}
      className="font-body-ui text-system-log hover:text-primary transition-colors p-1 -ml-1 rounded"
    >
      <span className="material-symbols-outlined text-xl">menu</span>
    </button>
  );
}
```

- [ ] **Step 3.4: 运行测试，确认通过**

```bash
cd frontend && npx vitest run src/test/SidebarToggleButton.test.tsx
```

预期：3 个用例 PASS。

- [ ] **Step 3.5: Commit**

```bash
git add frontend/src/components/layout/SidebarToggleButton.tsx frontend/src/test/SidebarToggleButton.test.tsx
git commit -m "feat(sidebar): add SidebarToggleButton with menu icon + ARIA"
```

---

## Task 4: `ResizeHandle` 组件 —— 渲染

**Files:**
- Create: `frontend/src/components/layout/ResizeHandle.tsx`
- Create: `frontend/src/test/ResizeHandle.test.tsx`

- [ ] **Step 4.1: 写失败测试 —— 渲染**

创建 `frontend/src/test/ResizeHandle.test.tsx`：

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { afterEach } from "vitest";
import ResizeHandle from "../../components/layout/ResizeHandle";

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
```

- [ ] **Step 4.2: 运行测试，确认失败**

```bash
cd frontend && npx vitest run src/test/ResizeHandle.test.tsx
```

预期：FAIL — module not found。

- [ ] **Step 4.3: 实现组件**

创建 `frontend/src/components/layout/ResizeHandle.tsx`：

```tsx
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
    e.currentTarget.setPointerCapture(e.pointerId);
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
```

- [ ] **Step 4.4: 运行测试，确认通过**

```bash
cd frontend && npx vitest run src/test/ResizeHandle.test.tsx
```

预期：4 个用例 PASS。

- [ ] **Step 4.5: Commit**

```bash
git add frontend/src/components/layout/ResizeHandle.tsx frontend/src/test/ResizeHandle.test.tsx
git commit -m "feat(sidebar): add ResizeHandle with pointer events + body cursor"
```

---

## Task 5: `SideNavBar` —— 接受新 props 并支持 collapsed=null

**Files:**
- Modify: `frontend/src/components/layout/SideNavBar.tsx`
- Modify: `frontend/src/test/layout.test.tsx`

- [ ] **Step 5.1: 更新现有测试 + 加新用例**

打开 `frontend/src/test/layout.test.tsx`，先做以下两处机械更新：

**5.1.a** 在 `describe("SideNavBar", ...)` 内，把现有 5 处 render 调用从：

```tsx
render(<SideNavBar currentStage="..." onNavigate={...} />);
```

改为：

```tsx
render(
  <SideNavBar
    currentStage="..."
    onNavigate={...}
    collapsed={false}
    width={280}
    onLiveWidthChange={() => {}}
    onCommitWidth={() => {}}
  />
);
```

**5.1.b** 在 `describe("SideNavBar", ...)` 末尾追加新 describe：

```tsx
describe("SideNavBar - collapsed", () => {
  it("returns null when collapsed is true", () => {
    const onNavigate = vi.fn();
    const { container } = render(
      <SideNavBar
        currentStage="STAGE4"
        onNavigate={onNavigate}
        collapsed={true}
        width={280}
        onLiveWidthChange={() => {}}
        onCommitWidth={() => {}}
      />
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders ResizeHandle when expanded", () => {
    const onNavigate = vi.fn();
    render(
      <SideNavBar
        currentStage="STAGE4"
        onNavigate={onNavigate}
        collapsed={false}
        width={280}
        onLiveWidthChange={() => {}}
        onCommitWidth={() => {}}
      />
    );
    expect(screen.getByTestId("resize-handle")).toBeInTheDocument();
  });
});
```

- [ ] **Step 5.2: 运行测试，确认失败**

```bash
cd frontend && npx vitest run src/test/layout.test.tsx
```

预期：旧用例因新 props 缺失败；新用例因 `collapsed=null` 还没生效失败。

- [ ] **Step 5.3: 改造 `SideNavBar.tsx`**

把 `frontend/src/components/layout/SideNavBar.tsx` 替换为：

```tsx
import ResizeHandle from "./ResizeHandle";

interface SideNavBarProps {
  currentStage: string;
  onNavigate: (stage: string) => void;
  collapsed: boolean;
  width: number;
  onLiveWidthChange: (w: number) => void;
  onCommitWidth: (w: number) => void;
}

interface StageItem {
  key: string;
  label: string;
  icon: string;
  subItems?: { key: string; label: string; icon: string; path: string }[];
}

const STAGES: StageItem[] = [
  { key: "STAGE1", label: "概念讨论", icon: "lightbulb" },
  { key: "STAGE2", label: "世界观+角色", icon: "public" },
  { key: "STAGE3", label: "情节头脑风暴", icon: "account_tree" },
  { key: "STAGE4", label: "写作中心", icon: "edit_note" },
  { key: "STAGE5", label: "全书诊断", icon: "clinical_notes" },
  { key: "STAGE6", label: "导出中心", icon: "download" },
];

export default function SideNavBar({
  currentStage,
  onNavigate,
  collapsed,
  width,
  onLiveWidthChange,
  onCommitWidth,
}: SideNavBarProps) {
  if (collapsed) return null;

  return (
    <nav
      style={{ width }}
      className="fixed left-0 top-16 h-[calc(100vh-64px)] bg-surface-container-low border-r border-outline-variant flex flex-col py-4 overflow-y-auto transition-all duration-200"
    >
      {/* Project section */}
      <div className="px-4 mb-4">
        <div className="font-label-mono text-system-log uppercase tracking-wider mb-2">
          项目
        </div>
        <button
          onClick={() => onNavigate("dashboard")}
          className="w-full text-left font-body-ui text-primary hover:bg-surface-container px-3 py-2 rounded transition-colors flex items-center gap-2"
        >
          <span className="material-symbols-outlined text-lg text-system-log">
            folder_open
          </span>
          项目中心
        </button>
      </div>

      <div className="border-t border-outline-variant mx-4 mb-4" />

      {/* Stage navigation */}
      <div className="px-4 mb-4">
        <div className="font-label-mono text-system-log uppercase tracking-wider mb-2">
          叙事阶段
        </div>
        {STAGES.map((stage) => {
          const isMainActive = currentStage === stage.key;
          const hasSubItems = stage.subItems && stage.subItems.length > 0;
          const isSubActive =
            hasSubItems &&
            stage.subItems!.some((sub) => currentStage === sub.key);

          return (
            <div key={stage.key} className="mb-1">
              <button
                onClick={() => onNavigate(stage.key)}
                className={`w-full text-left font-body-ui px-3 py-2 rounded transition-colors flex items-center gap-2 ${
                  isMainActive || isSubActive
                    ? "bg-primary-container/10 border-l-2 border-primary-container text-primary-container"
                    : "text-system-log hover:bg-surface-container hover:text-primary"
                }`}
              >
                <span className="material-symbols-outlined text-lg">
                  {stage.icon}
                </span>
                {stage.label}
              </button>

              {hasSubItems && (
                <div className="ml-4 mt-0.5 space-y-0.5">
                  {stage.subItems!.map((sub) => (
                    <button
                      key={sub.key}
                      onClick={() => onNavigate(sub.key)}
                      className={`w-full text-left font-body-ui text-sm px-3 py-1.5 rounded transition-colors flex items-center gap-2 ${
                        currentStage === sub.key
                          ? "bg-primary-container/5 text-primary-container"
                          : "text-system-log/70 hover:text-primary hover:bg-surface-container"
                      }`}
                    >
                      <span className="material-symbols-outlined text-base">
                        {sub.icon}
                      </span>
                      {sub.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="border-t border-outline-variant mx-4 mb-4" />

      {/* Workspace */}
      <div className="px-4 mb-4">
        <div className="font-label-mono text-system-log uppercase tracking-wider mb-2">
          工作区
        </div>
        {[
          { label: "灵感库", icon: "draw" },
          { label: "风格沙盒", icon: "palette", stage: "STYLE" },
          { label: "章节审查", icon: "rate_review", stage: "REVIEW" },
          { label: "影响分析", icon: "find_in_page", stage: "IMPACT" },
          { label: "资产中心", icon: "database", stage: "STORYOS" },
        ].map((item) => {
          if ("stage" in item) {
            return (
              <button
                key={item.label}
                onClick={() => onNavigate(item.stage!)}
                className={`w-full text-left font-body-ui px-3 py-2 rounded transition-colors flex items-center gap-2 ${
                  currentStage === item.stage
                    ? "bg-primary-container/10 border-l-2 border-primary-container text-primary-container"
                    : "text-system-log hover:bg-surface-container hover:text-primary"
                }`}
              >
                <span className="material-symbols-outlined text-lg">
                  {item.icon}
                </span>
                {item.label}
              </button>
            );
          }
          return (
            <button
              key={item.label}
              disabled
              className="w-full text-left font-body-ui text-system-log/50 px-3 py-2 rounded flex items-center gap-2 opacity-50 pointer-events-none"
            >
              <span className="material-symbols-outlined text-lg">{item.icon}</span>
              {item.label}
            </button>
          );
        })}
      </div>

      {/* Settings */}
      <div className="px-4">
        <button
          onClick={() => onNavigate("SETTINGS")}
          className={`w-full text-left font-body-ui px-3 py-2 rounded transition-colors flex items-center gap-2 ${
            currentStage === "SETTINGS"
              ? "bg-primary-container/10 border-l-2 border-primary-container text-primary-container"
              : "text-system-log hover:text-primary hover:bg-surface-container"
          }`}
        >
          <span className="material-symbols-outlined text-lg">settings</span>
          设置
        </button>
      </div>

      <ResizeHandle
        width={width}
        onLiveChange={onLiveWidthChange}
        onCommit={onCommitWidth}
      />
    </nav>
  );
}
```

- [ ] **Step 5.4: 运行测试，确认通过**

```bash
cd frontend && npx vitest run src/test/layout.test.tsx
```

预期：全部 `TopHeader` + `SideNavBar` 用例 PASS（含两个新 collapsed 用例）。

- [ ] **Step 5.5: Commit**

```bash
git add frontend/src/components/layout/SideNavBar.tsx frontend/src/test/layout.test.tsx
git commit -m "feat(sidebar): SideNavBar accepts collapsed/width + renders ResizeHandle"
```

---

## Task 6: `TopHeader` —— 渲染汉堡按钮

**Files:**
- Modify: `frontend/src/components/layout/TopHeader.tsx`
- Modify: `frontend/src/test/layout.test.tsx`

- [ ] **Step 6.1: 更新现有测试 + 加新用例**

在 `frontend/src/test/layout.test.tsx` 的 `describe("TopHeader", ...)` 内：

**6.1.a** 把现有 render 调用（约 5 处）从：

```tsx
render(<TopHeader projectName="..." currentStage="..." ... />);
```

改为：

```tsx
render(
  <TopHeader
    projectName="..."
    currentStage="..."
    collaborationMode="..."
    autoSaveStatus="..."
    collapsed={false}
    onToggleSidebar={() => {}}
  />
);
```

**6.1.b** 在 `describe("TopHeader", ...)` 末尾追加：

```tsx
describe("TopHeader - sidebar toggle", () => {
  it("renders the hamburger button", () => {
    render(
      <TopHeader
        projectName=""
        currentStage="INIT"
        collaborationMode="live"
        autoSaveStatus="saved"
        collapsed={false}
        onToggleSidebar={() => {}}
      />
    );
    expect(screen.getByRole("button", { name: "收起侧边栏" })).toBeInTheDocument();
  });

  it("clicking the hamburger calls onToggleSidebar", () => {
    const onToggleSidebar = vi.fn();
    render(
      <TopHeader
        projectName=""
        currentStage="INIT"
        collaborationMode="live"
        autoSaveStatus="saved"
        collapsed={false}
        onToggleSidebar={onToggleSidebar}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "收起侧边栏" }));
    expect(onToggleSidebar).toHaveBeenCalledTimes(1);
  });

  it("hamburger label flips when collapsed", () => {
    const { rerender } = render(
      <TopHeader
        projectName=""
        currentStage="INIT"
        collaborationMode="live"
        autoSaveStatus="saved"
        collapsed={true}
        onToggleSidebar={() => {}}
      />
    );
    expect(screen.getByRole("button", { name: "展开侧边栏" })).toBeInTheDocument();
  });
});
```

- [ ] **Step 6.2: 运行测试，确认失败**

```bash
cd frontend && npx vitest run src/test/layout.test.tsx
```

预期：旧 TopHeader 用例因缺新 props 失败；新用例因按钮未渲染失败。

- [ ] **Step 6.3: 改造 `TopHeader.tsx`**

把 `frontend/src/components/layout/TopHeader.tsx` 替换为：

```tsx
import SidebarToggleButton from "./SidebarToggleButton";

interface TopHeaderProps {
  projectName: string;
  currentStage: string;
  collaborationMode: string;
  autoSaveStatus: "saved" | "saving" | "error";
  collapsed: boolean;
  onToggleSidebar: () => void;
}

export default function TopHeader({
  projectName,
  currentStage,
  collaborationMode,
  autoSaveStatus,
  collapsed,
  onToggleSidebar,
}: TopHeaderProps) {
  return (
    <header className="fixed top-0 left-0 w-full z-50 h-16 bg-surface-container-low border-b border-outline-variant flex items-center justify-between px-6">
      <div className="flex items-center gap-4">
        <SidebarToggleButton collapsed={collapsed} onToggle={onToggleSidebar} />
        <span className="font-display text-lg text-primary-container font-semibold">
          StoryForge
        </span>
        {projectName && (
          <>
            <span className="text-system-log">/</span>
            <span className="font-body text-sm text-primary">{projectName}</span>
          </>
        )}
        <span className="font-label-mono text-primary-container bg-primary-container/10 px-2 py-0.5 rounded">
          {currentStage}
        </span>
        <span className="font-body-ui text-tertiary-container flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-tertiary-container" />
          {collaborationMode === "live" ? "实时写作" : "讨论模式"}
        </span>
      </div>
      <div className="flex items-center gap-3">
        <button className="font-body-ui text-system-log hover:text-primary transition-colors">
          <span className="material-symbols-outlined text-lg">search</span>
        </button>
        <button className="font-body-ui text-system-log hover:text-primary transition-colors">
          <span className="material-symbols-outlined text-lg">
            notifications
          </span>
        </button>
        <div className="w-8 h-8 rounded-full bg-primary-container/20 flex items-center justify-center">
          <span className="material-symbols-outlined text-primary-container text-sm">
            person
          </span>
        </div>
      </div>
    </header>
  );
}
```

- [ ] **Step 6.4: 运行测试，确认通过**

```bash
cd frontend && npx vitest run src/test/layout.test.tsx
```

预期：所有 TopHeader + SideNavBar 用例 PASS。

- [ ] **Step 6.5: Commit**

```bash
git add frontend/src/components/layout/TopHeader.tsx frontend/src/test/layout.test.tsx
git commit -m "feat(sidebar): TopHeader renders SidebarToggleButton at leftmost"
```

---

## Task 7: `MainLayout` —— 集成 hook 与状态透传

**Files:**
- Modify: `frontend/src/components/layout/MainLayout.tsx`

- [ ] **Step 7.1: 改造 `MainLayout.tsx`**

替换 `frontend/src/components/layout/MainLayout.tsx`：

```tsx
import { useState, useEffect, useCallback } from "react";
import { Outlet, useParams, useLocation, useMatch, useNavigate } from "react-router-dom";
import TopHeader from "./TopHeader";
import SideNavBar from "./SideNavBar";
import { useSidebar } from "../../hooks/useSidebar";
import api from "../../api/client";

const STAGE_FROM_PATH: Record<string, string> = {
  stage1: "STAGE1",
  stage2: "STAGE2",
  stage3: "STAGE3",
  stage4: "STAGE4",
  stage5: "STAGE5",
  stage6: "STAGE6",
  style: "STYLE",
  settings: "SETTINGS",
  review: "REVIEW",
  impact: "IMPACT",
  storyos: "STORYOS",
  "stage1/canvas": "STAGE1",
  "stage3/outline": "STAGE3",
  "stage3/branches": "STAGE3",
};

const STAGE_TO_PATH: Record<string, string> = {
  STAGE1: "stage1",
  STAGE2: "stage2",
  STAGE3: "stage3",
  STAGE4: "stage4",
  STAGE5: "stage5",
  STAGE6: "stage6",
  STYLE: "style",
  SETTINGS: "settings",
  REVIEW: "review",
  IMPACT: "impact",
  STORYOS: "storyos",
};

export default function MainLayout() {
  const { projectId: paramId } = useParams<{ projectId: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const match = useMatch("/project/:projectId/*");
  const projectId = match?.params.projectId || paramId || "";

  const [projectName, setProjectName] = useState("");

  const pathStage = match?.params["*"] || "";
  const currentStage = STAGE_FROM_PATH[pathStage] || "INIT";

  const { collapsed, width, setWidthLive, commitWidth, toggle } = useSidebar();

  useEffect(() => {
    if (!projectId) return;
    api
      .getProjectStatus(projectId)
      .then((status) => {
        if (status?.title) setProjectName(status.title);
      })
      .catch(() => {});
  }, [projectId]);

  const handleNavigate = useCallback(
    (stage: string) => {
      if (stage === "dashboard") {
        navigate("/");
        return;
      }
      const path = STAGE_TO_PATH[stage];
      if (path && projectId) {
        navigate(`/project/${projectId}/${path}`);
      }
    },
    [projectId, navigate]
  );

  return (
    <div className="min-h-screen bg-canvas-bg">
      <TopHeader
        projectName={projectName || projectId || "StoryForge"}
        currentStage={currentStage}
        collaborationMode="live"
        autoSaveStatus="saved"
        collapsed={collapsed}
        onToggleSidebar={toggle}
      />
      <SideNavBar
        currentStage={currentStage}
        onNavigate={handleNavigate}
        collapsed={collapsed}
        width={width}
        onLiveWidthChange={setWidthLive}
        onCommitWidth={commitWidth}
      />
      <main
        style={{ marginLeft: collapsed ? 0 : width }}
        className="mt-16 p-6 transition-all duration-200"
      >
        <Outlet />
      </main>
    </div>
  );
}
```

- [ ] **Step 7.2: 类型检查 + 全量 frontend 测试**

```bash
cd frontend && npx tsc --noEmit && npx vitest run
```

预期：
- `tsc` 无错误
- 全部测试 PASS（约 62 个测试文件，含本计划新增的 3 个文件 + 改动的 layout.test.tsx）

- [ ] **Step 7.3: Commit**

```bash
git add frontend/src/components/layout/MainLayout.tsx
git commit -m "feat(sidebar): MainLayout wires useSidebar into SideNavBar/TopHeader/main"
```

---

## Task 8: 验收 —— 手动 smoke + TypeScript 严格检查

- [ ] **Step 8.1: 启动 dev servers 并手动验收**

```bash
# 后端
cd /Users/longsa/Codes/storyForge2
source venv/bin/activate
uvicorn backend.main:app --reload --port 8000 &

# 前端
cd frontend
npm run dev
```

打开 http://localhost:5173，验证：

| 步骤 | 期望 |
|---|---|
| 进入任意项目页面 | 侧边栏展开，宽度 280px |
| 点击 TopHeader 左侧汉堡按钮 | 侧边栏消失，main 占满屏幕；按钮 title 变 "展开侧边栏" |
| 再次点击汉堡 | 侧边栏恢复为上次宽度 |
| 拖动侧边栏右边缘到 ~400px 后松开 | 宽度变为 400px；main 同步让位 |
| 刷新页面 | 收起/展开状态与宽度保持 |
| 关闭侧边栏标签页后重新打开 | localStorage 中状态保留 |
| 拖拽出 sidebar 右边缘外松开 | 仍能正确 commit（pointer capture 生效） |

- [ ] **Step 8.2: 严格 TypeScript 检查**

```bash
cd frontend && npx tsc --noEmit --strict
```

预期：无 error / 无 warning。

- [ ] **Step 8.3: 全量测试再跑一次**

```bash
cd frontend && npx vitest run
```

预期：全部测试 PASS。

---

## Notes for the Executor

- **TDD 严格度**：每个 Task 的 Step 1 必须先写测试再写实现；运行测试确认先 FAIL 再 PASS 才算完成。
- **commit 粒度**：每 Step 末尾一次 commit。失败或回退时单步 git revert 即可，不影响后续步骤。
- **localStorage 测试隔离**：每次 `beforeEach(() => localStorage.clear())` 是必须的，否则用例间污染。
- **不要引入第三方库**：`framer-motion`、`react-resizable-panels` 等都禁止；本计划只用 React + 现有 Tailwind。
- **键盘快捷键** 不在本计划范围（用户在 brainstorming 中明确否决）。
- **响应式处理** 不在本计划范围（用户在 brainstorming 中明确选择不动）。
