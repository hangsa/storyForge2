# WorldStep 数组数据「一行一条」展示 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `WorldStep` 4 个数组字段 (PowerSystem.stages/core_rules/ceilings, World.core_rules 按 category 分组) 的展示形态从 `TagEditor` (chip 风) 改为新组件 `LineListEditor` (一行一条 textarea, 全宽, 高度自适应内容, 保留删/增/编辑, 保持顺序)。

**Architecture:**
- 前端新建 `frontend/src/components/shared/LineListEditor.tsx`: 与 TagEditor 相同 props (`items: string[]` + `onItemsChange` + `saving`)。每条 = 一个全宽 `<textarea>` (用现成的 `AutoTextarea` 实现高度自适应), 行尾一个 `×` 删除按钮; 列表底部一个 `+ 添加一条` 按钮 (点击追加空字符串并立即 focus)。
- WorldStep.tsx 4 个 TagEditor 调用点替换为 LineListEditor: PowerSystem.stages / core_rules / ceilings (3 处) + CategoryGroup 内 (1 处)。
- TagEditor 在 WorldStep 不再被引用; CharacterStep、Stage2Page、CharacterStep.inline_edit 测试等继续使用 TagEditor (本任务不动)。

**Tech Stack:** React 18 + TypeScript + Tailwind (Material 3 tokens) · vitest + Testing Library (jsdom) · 复用现有 `AutoTextarea` 组件

---

## 文件改动范围

| 文件 | 改动 | 任务 |
|---|---|---|
| `frontend/src/components/shared/LineListEditor.tsx` | 新建组件 | Task 1 |
| `frontend/src/test/LineListEditor.test.tsx` | 新增组件测试 | Task 1 |
| `frontend/src/components/wizard/WorldStep.tsx` | 4 个 TagEditor 调用替换为 LineListEditor | Task 2 |
| `frontend/src/test/WorldStep.test.tsx` | 修正 3 个 TagEditor 相关断言 + 新增行级 edit/delete/add 断言 | Task 3 |

不删除任何文件; TagEditor 保留供 CharacterStep / Stage2Page 使用。

---

## Task 1: 新建 `LineListEditor` 组件 + 单元测试

**Files:**
- Create: `frontend/src/components/shared/LineListEditor.tsx`
- Test: `frontend/src/test/LineListEditor.test.tsx`

### Step 1: 写失败测试 — 渲染 / 编辑 / 删除 / 添加

新建 `frontend/src/test/LineListEditor.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import LineListEditor from "../components/shared/LineListEditor";

describe("LineListEditor", () => {
  it("renders one textarea per item", () => {
    render(
      <LineListEditor
        items={["炼气", "筑基", "金丹"]}
        onItemsChange={() => {}}
        saving={false}
      />,
    );
    expect(screen.getByDisplayValue("炼气")).toBeInTheDocument();
    expect(screen.getByDisplayValue("筑基")).toBeInTheDocument();
    expect(screen.getByDisplayValue("金丹")).toBeInTheDocument();
  });

  it("renders empty-state copy and +添加一条 button when items=[]", () => {
    render(
      <LineListEditor items={[]} onItemsChange={() => {}} saving={false} />,
    );
    expect(screen.getByText("暂无")).toBeInTheDocument();
    expect(screen.getByTestId("linelist-add")).toBeInTheDocument();
  });

  it("clicking +添加一条 appends an empty string and fires onItemsChange", () => {
    const onChange = vi.fn();
    render(
      <LineListEditor items={["a"]} onItemsChange={onChange} saving={false} />,
    );
    fireEvent.click(screen.getByTestId("linelist-add"));
    expect(onChange).toHaveBeenCalledWith(["a", ""]);
  });

  it("editing a textarea fires onItemsChange with the new array", () => {
    const onChange = vi.fn();
    render(
      <LineListEditor items={["old"]} onItemsChange={onChange} saving={false} />,
    );
    const ta = screen.getByDisplayValue("old") as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: "new" } });
    expect(onChange).toHaveBeenCalledWith(["new"]);
  });

  it("clicking × removes that item", () => {
    const onChange = vi.fn();
    render(
      <LineListEditor
        items={["a", "b", "c"]}
        onItemsChange={onChange}
        saving={false}
      />,
    );
    fireEvent.click(screen.getByTestId("linelist-1-remove"));
    expect(onChange).toHaveBeenCalledWith(["a", "c"]);
  });

  it("disables +添加一条 and × buttons when saving=true", () => {
    render(
      <LineListEditor
        items={["a"]}
        onItemsChange={() => {}}
        saving={true}
      />,
    );
    expect(screen.getByTestId("linelist-add")).toBeDisabled();
    expect(screen.getByTestId("linelist-0-remove")).toBeDisabled();
  });

  it("uses AutoTextarea so textarea expands with content (rows hint >=1)", () => {
    const long = "line1\nline2\nline3";
    render(
      <LineListEditor items={[long]} onItemsChange={() => {}} saving={false} />,
    );
    const ta = screen.getByDisplayValue(long) as HTMLTextAreaElement;
    expect(ta.tagName).toBe("TEXTAREA");
    // minRows=1 first-paint hint; AutoTextarea's useLayoutEffect resizes
    // post-mount which jsdom doesn't fully simulate, but rows attribute
    // tells us the contract.
    expect(parseInt(ta.getAttribute("rows") ?? "0", 10)).toBeGreaterThanOrEqual(1);
  });
});
```

### Step 2: 跑测试验证它失败

```bash
cd frontend && npx vitest run src/test/LineListEditor.test.tsx
```

Expected: FAIL with `Cannot find module '../components/shared/LineListEditor'`.

### Step 3: 实现 `LineListEditor` 组件

新建 `frontend/src/components/shared/LineListEditor.tsx`:

```tsx
import { useRef } from "react";
import { AutoTextarea } from "./AutoTextarea";

interface LineListEditorProps {
  items: string[];
  onItemsChange: (items: string[]) => void;
  saving: boolean;
}

/**
 * 2026-09-20: 与 TagEditor (chip 风) 并存的另一种数组编辑形态。
 *
 * 每条数据 = 独立一行, 全宽 textarea, 高度随内容自适应
 * (复用 AutoTextarea 的 useLayoutEffect 自动 resize); 行尾 × 删除;
 * 列表底部一个 + 添加一条 按钮, 点击在末尾追加空字符串。
 *
 * 与 TagEditor 选哪种:
 * - 短文本多条并列 (chip 风好看) → TagEditor (CharacterStep 人格层、Stage2Page)
 * - 长文本需要多行可扩展 (列表语义更清晰) → LineListEditor (WorldStep 4 处)
 *
 * 两者共享同一组 props (items / onItemsChange / saving), 调用方按需切换。
 */
export default function LineListEditor({ items, onItemsChange, saving }: LineListEditorProps) {
  const lastAddedRef = useRef<number>(-1);

  const handleEdit = (index: number, value: string) => {
    onItemsChange(items.map((it, i) => (i === index ? value : it)));
  };

  const handleRemove = (index: number) => {
    onItemsChange(items.filter((_, i) => i !== index));
  };

  const handleAdd = () => {
    const next = [...items, ""];
    lastAddedRef.current = next.length - 1;
    onItemsChange(next);
  };

  return (
    <div className="space-y-2" data-testid="linelist-root">
      {items.length === 0 && (
        <span className="text-xs text-system-log/40 font-body-ui">暂无</span>
      )}

      {items.map((item, index) => (
        <div
          key={`linelist-row-${index}`}
          className="flex items-start gap-2"
        >
          <AutoTextarea
            data-testid={`linelist-${index}-input`}
            minRows={1}
            value={item}
            disabled={saving}
            onChange={(e) => handleEdit(index, e.target.value)}
            className="flex-1 bg-surface-container border border-outline-variant rounded px-2 py-1.5 text-xs text-primary focus:outline-none focus:border-primary-container resize-none"
            ref={lastAddedRef.current === index ? (el) => { if (el) el.focus(); } : undefined}
          />
          <button
            type="button"
            data-testid={`linelist-${index}-remove`}
            onClick={() => handleRemove(index)}
            disabled={saving}
            aria-label={`删除第 ${index + 1} 条`}
            className="shrink-0 inline-flex items-center justify-center h-6 w-6 mt-1 rounded text-system-log/40 hover:text-error transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <span aria-hidden="true" className="material-symbols-outlined text-xs">close</span>
          </button>
        </div>
      ))}

      <button
        type="button"
        data-testid="linelist-add"
        onClick={handleAdd}
        disabled={saving}
        className="inline-flex items-center gap-0.5 px-2 py-1 border border-dashed border-system-log/30 rounded text-xs text-system-log/50 hover:text-primary-container hover:border-primary-container/50 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
      >
        <span aria-hidden="true" className="material-symbols-outlined text-xs">add</span>
        添加一条
      </button>
    </div>
  );
}
```

### Step 4: 跑测试验证它通过

```bash
cd frontend && npx vitest run src/test/LineListEditor.test.tsx
```

Expected: PASS (7/7).

### Step 5: Commit

```bash
git add frontend/src/components/shared/LineListEditor.tsx frontend/src/test/LineListEditor.test.tsx
git commit -m "$(cat <<'EOF'
feat(shared): add LineListEditor (one-row-per-item full-width textarea array editor)

For PowerSystem.stages/core_rules/ceilings and World.core_rules in WorldStep —
each item renders as its own full-width textarea row (height auto-grows via
existing AutoTextarea), with × on the right and a + 添加一条 button at the
bottom. Same props as TagEditor (items / onItemsChange / saving) so call
sites can swap by component name.

TagEditor remains for short-text chip-style needs (CharacterStep personality,
Stage2Page, etc).

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: WorldStep 替换 4 个 TagEditor 调用

**Files:**
- Modify: `frontend/src/components/wizard/WorldStep.tsx` (1 处 import + 4 处 JSX 替换)

### Step 1: 加 import + 删 TagEditor import

在 `frontend/src/components/wizard/WorldStep.tsx` 第 4 行附近,把:

```tsx
import TagEditor from "../shared/TagEditor";
```

替换成:

```tsx
import LineListEditor from "../shared/LineListEditor";
```

### Step 2: 替换 PowerSystemsPanel 3 个 TagEditor 调用

在 `frontend/src/components/wizard/WorldStep.tsx` (大约行 825-844 区间,`stages` / `core_rules` / `ceilings` 三段),每段:

```tsx
<TagEditor items={ps.stages ?? []} onItemsChange={(items) => onUpdateField(idx, "stages", items)} saving={busy} />
```

替换成:

```tsx
<LineListEditor items={ps.stages ?? []} onItemsChange={(items) => onUpdateField(idx, "stages", items)} saving={busy} />
```

`core_rules` 和 `ceilings` 同理,只换组件名,onItemsChange 的 key (`"core_rules"` / `"ceilings"`) 不变。

### Step 3: 替换 CategoryGroup 内的 TagEditor 调用

在 `frontend/src/components/wizard/WorldStep.tsx` 的 `CategoryGroup` 函数体内 (大约行 912 附近):

```tsx
<TagEditor items={rules} onItemsChange={onChange} saving={saving} />
```

替换成:

```tsx
<LineListEditor items={rules} onItemsChange={onChange} saving={saving} />
```

### Step 4: 跑 WorldStep 相关测试看哪些断言需要更新

```bash
cd frontend && npx vitest run src/test/WorldStep.test.tsx src/test/WorldStep.subtabs.test.tsx 2>&1 | tail -40
```

预期会看到 `WorldStep.test.tsx` 里的几个测试失败 — 它们查 `.textContent).toContain("炼气")` 之类的,LineListEditor 把"炼气"放在 `<textarea value>` 里,textContent 仍包含它 (textarea 也算 element 的 textContent),所以这些断言大概率仍能过; 但 `TagEditor expects a string array` 等注释需要更新,真正可能失败的是下面 Step 5 要处理的「× 删除」语义断言(若有)。

如果仍有失败,记录具体的 testid / 行号,进入 Task 3 集中修。

### Step 5: Commit

```bash
git add frontend/src/components/wizard/WorldStep.tsx
git commit -m "$(cat <<'EOF'
refactor(worldstep): swap TagEditor → LineListEditor for 4 array fields

PowerSystem.stages/core_rules/ceilings (3) + CategoryGroup world.core_rules
(1) now render one textarea row per item (full width, auto-grows) instead
of chip tags. + 添加一条 button at the bottom replaces TagEditor's chip +
inline-input add flow. Deletion + editing + ordering semantics unchanged.

TagEditor import removed from WorldStep; still used by CharacterStep and
Stage2Page.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: 更新 WorldStep.test.tsx 旧 TagEditor 断言 + 加 LineListEditor 行级测试

**Files:**
- Modify: `frontend/src/test/WorldStep.test.tsx` (3 处注释 + 1 处新增测试)

### Step 1: 更新注释 "Each TagEditor renders existing items as buttons"

`frontend/src/test/WorldStep.test.tsx` 第 154 行附近:

```tsx
// Each TagEditor renders existing items as buttons.
expect(screen.getByTestId("world-power-system-0-stages").textContent).toContain("炼气");
expect(screen.getByTestId("world-power-system-0-ceilings").textContent).toContain("最高元婴");
expect(screen.getByTestId("world-core-rules-physical").textContent).toContain("弱肉强食");
```

替换注释为:

```tsx
// Each LineListEditor renders existing items as <textarea> rows.
expect(screen.getByTestId("world-power-system-0-stages").textContent).toContain("炼气");
expect(screen.getByTestId("world-power-system-0-ceilings").textContent).toContain("最高元婴");
expect(screen.getByTestId("world-core-rules-physical").textContent).toContain("弱肉强食");
```

(textContent 仍含 textarea value,因为 textarea 节点本身也算子节点的文本。)

### Step 2: 更新另一处 TagEditor 注释

第 535 行附近:

```tsx
// power_system is folded into power_systems[0] and its object-shaped
// stages flattened — all string values appear in the TagEditor.
```

替换为:

```tsx
// power_system is folded into power_systems[0] and its object-shaped
// stages flattened — all string values appear in the LineListEditor.
```

### Step 3: 加一个 LineListEditor 行级交互测试

在 `frontend/src/test/WorldStep.test.tsx` 末尾(最后一个 `});` 之前)追加一个测试:

```tsx
  it("LineListEditor +添加一条 appends an empty row and × removes", async () => {
    (api.generateWorld as ReturnType<typeof vi.fn>).mockResolvedValue({
      era: "古代",
      geography: "中原",
      power_systems: [
        { name: "灵力", description: "", stages: ["炼气"], core_rules: [], ceilings: [] },
      ],
      factions: [],
      core_rules: [],
    });
    setup();
    await screen.findByTestId("world-form");
    fireEvent.click(screen.getByTestId("world-tab-power_system"));
    const stages = screen.getByTestId("world-power-system-0-stages");
    // 初始 1 条 + 添加一条 = 2 个 input
    expect(stages.querySelectorAll('[data-testid^="linelist-"][data-testid$="-input"]').length).toBe(1);
    fireEvent.click(within(stages).getByTestId("linelist-add"));
    expect(stages.querySelectorAll('[data-testid^="linelist-"][data-testid$="-input"]').length).toBe(2);
    // × 删除第二条 (index=1)
    fireEvent.click(within(stages).getByTestId("linelist-1-remove"));
    expect(stages.querySelectorAll('[data-testid^="linelist-"][data-testid$="-input"]').length).toBe(1);
  });
```

文件顶部 `import` 区追加:

```tsx
import { within } from "@testing-library/react";
```

(如果已经在 from "@testing-library/react" 里就合一起; 否则单独加。)

### Step 4: 跑测试验证全部通过

```bash
cd frontend && npx vitest run src/test/WorldStep.test.tsx src/test/WorldStep.subtabs.test.tsx src/test/LineListEditor.test.tsx 2>&1 | tail -10
```

Expected: 全部通过 (具体数字: WorldStep.test 19/19, WorldStep.subtabs 13/13, LineListEditor 7/7)。

### Step 5: 全量 vitest 跑一遍确认无回归

```bash
cd frontend && npx vitest run 2>&1 | tail -8
```

Known pre-existing failures (与本任务无关, 不计入):
- `ConceptStep.test.tsx`, `ChapterOutlineStep.test.tsx`, `Workspace.test.tsx`,
  `WizardSidebar.test.tsx`, `WorkspaceWizardPanel.test.tsx` (这些在
  `git stash` 前后失败数一致,基线 22 failed / 4 files)。

确认失败数与改动前基线一致即可。

### Step 6: tsc 检查

```bash
cd frontend && npx tsc --noEmit 2>&1 | grep -E "LineListEditor|WorldStep\.tsx" | head
```

Expected: 无新增错误 (基线只有 1 个 `WorldStep.test.tsx(328,80) array.at` 错误,与本次无关)。

### Step 7: Commit

```bash
git add frontend/src/test/WorldStep.test.tsx
git commit -m "$(cat <<'EOF'
test(worldstep): update TagEditor-comments to LineListEditor + row-level coverage

- Bump 2 stale 'TagEditor' comments to reflect the new component name.
- Add a LineListEditor integration test in WorldStep.test: +添加一条
  appends a row, × removes it. Asserts via querySelectorAll on the
  per-row testids.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review

1. **Spec coverage:**
   - 「每条数据单独做一行展示」 → Task 1 LineListEditor 每条一个 textarea row ✓
   - 「固定全长度」 → Task 1 flex-1 让 textarea 占满 row ✓
   - 「编辑时展示长度不变」 → 解释为"高度自适应内容(多行),宽度永远全宽" → Task 1 AutoTextarea + flex-1 ✓
   - 「删增编辑动作保留」 → Task 1 × 删除 + +添加一条 + onChange 编辑 ✓
   - 「保持顺序」 → Task 1 `items.map((it, i) => ...)` 不重排 ✓
   - 「适用于 4 个数组」 → Task 2 替换 4 处调用 ✓

2. **Placeholder scan:** 无 TBD/TODO,所有 step 都含具体代码。

3. **Type consistency:**
   - LineListEditorProps 在 Task 1 定义,Task 2/3 全部按相同签名调用 ✓
   - testid `linelist-${index}-input` / `linelist-${index}-remove` / `linelist-add` 在 Task 1 实现 + Task 3 测试使用一致 ✓
   - WorldStep 的 onUpdateField / onChange 回调签名未变 ✓
