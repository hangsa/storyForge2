import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import PromptListPanel from "../../components/home/promptPlaza/PromptListPanel";

const SAMPLE = [
  { name: "scene_writing",          category: "",                   label: "场景写作",   has_override: false, modified_at: null, builtin: true },
  { name: "outline_generation",     category: "",                   label: "章节大纲",   has_override: false, modified_at: null, builtin: true },
  { name: "meta_decompose",         category: "creative",           label: "元提示词",   has_override: true,  modified_at: "2026-07-19T00:00:00Z", builtin: true },
  { name: "narrative_guard",        category: "",                   label: "叙事守护",   has_override: false, modified_at: null, builtin: true },
];

describe("PromptListPanel", () => {
  it("renders prompts grouped by workspace stage in canonical order", () => {
    // SAMPLE 覆盖 4 个组:divergence / chapter / chapter_writing / review。
    // 期望顺序: 创意发散 → 章节大纲 → 章节写作 → 审校与诊断
    // (chapter 在 chapter_writing 之前,符合 PROMPT_STAGE_ORDER)
    const { container } = render(
      <PromptListPanel prompts={SAMPLE} selectedName={null} onSelect={vi.fn()} />,
    );
    // 行级断言 — 用 plaza-row 限定到 prompt 行,避免「章节大纲」 heading/label 文本冲突
    expect(screen.getByText("场景写作").closest('[data-testid="plaza-row"]')).toBeInTheDocument();
    expect(screen.getByText("元提示词").closest('[data-testid="plaza-row"]')).toBeInTheDocument();
    expect(screen.getByText("叙事守护").closest('[data-testid="plaza-row"]')).toBeInTheDocument();
    // 「章节大纲」既是 chapter 组 heading 又是 outline_generation 行 label —
    // 这里直接断言至少有一个 plaza-row 包含它
    const outlineRows = Array.from(
      container.querySelectorAll<HTMLElement>('[data-testid="plaza-row"]'),
    ).filter((row) => row.textContent === "章节大纲");
    expect(outlineRows.length).toBeGreaterThanOrEqual(1);
    const headings = Array.from(
      container.querySelectorAll<HTMLElement>(
        "div.font-mono.text-\\[10px\\].text-on-surface-variant",
      ),
    ).map((el) => el.textContent);
    // indexOf 顺序断言:创意发散 < 章节大纲 < 章节写作 < 审校与诊断
    expect(headings.indexOf("创意发散")).toBeGreaterThanOrEqual(0);
    expect(headings.indexOf("章节大纲")).toBeGreaterThan(headings.indexOf("创意发散"));
    expect(headings.indexOf("章节写作")).toBeGreaterThan(headings.indexOf("章节大纲"));
    expect(headings.indexOf("审校与诊断")).toBeGreaterThan(headings.indexOf("章节写作"));
  });

  it("renders prompts within a group in canonical usage order", () => {
    // 用户要求:元提示词 必须排在 自适应追问方法论 之前。
    // 这个测试用 SAMPLE 里没有的提示词扩充,验证 PROMPT_NAME_TO_STAGE
    // 数组顺序就是 DOM 顺序。
    const sample = [
      ...SAMPLE,
      { name: "adaptive_diverge", category: "creative", label: "自适应追问方法论", has_override: false, modified_at: null, builtin: true },
    ];
    const { container } = render(
      <PromptListPanel prompts={sample} selectedName={null} onSelect={vi.fn()} />,
    );
    const allRows = Array.from(
      container.querySelectorAll<HTMLElement>("[data-testid='plaza-row']"),
    );
    const labels = allRows.map((el) => el.querySelector("span")?.textContent);
    const metaIdx = labels.indexOf("元提示词");
    const adaptiveIdx = labels.indexOf("自适应追问方法论");
    expect(metaIdx).toBeGreaterThanOrEqual(0);
    expect(adaptiveIdx).toBeGreaterThan(metaIdx);
  });

  it("shows has_override badge for prompts with override", () => {
    render(<PromptListPanel prompts={SAMPLE} selectedName={null} onSelect={vi.fn()} />);
    // meta_decompose has override; should have a badge marked somehow
    const meta = screen.getByText("元提示词").closest('[data-testid="plaza-row"]')!;
    expect(meta.querySelector('[data-testid="override-dot"]')).toBeInTheDocument();
    // scene_writing has no override
    const scene = screen.getByText("场景写作").closest('[data-testid="plaza-row"]')!;
    expect(scene.querySelector('[data-testid="override-dot"]')).not.toBeInTheDocument();
  });

  it("highlights the selected prompt", () => {
    render(<PromptListPanel prompts={SAMPLE} selectedName="scene_writing" onSelect={vi.fn()} />);
    const scene = screen.getByText("场景写作").closest('[data-testid="plaza-row"]')!;
    expect(scene.getAttribute("data-selected")).toBe("true");
  });

  it("calls onSelect when a row is clicked", () => {
    const onSelect = vi.fn();
    render(<PromptListPanel prompts={SAMPLE} selectedName={null} onSelect={onSelect} />);
    fireEvent.click(screen.getByText("场景写作"));
    expect(onSelect).toHaveBeenCalledWith("scene_writing");
  });

  it("filters by search query", () => {
    render(<PromptListPanel prompts={SAMPLE} selectedName={null} onSelect={vi.fn()} />);
    const input = screen.getByPlaceholderText(/搜索/) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "outline" } });
    expect(screen.queryByText("场景写作")).not.toBeInTheDocument();
    // 行级断言 — 搜出 outline_generation,「章节大纲」同时是 chapter heading,
    // 所以限定到 plaza-row 才能稳定找到这一行
    const rows = screen.getAllByText("章节大纲");
    expect(rows.some((el) => el.closest('[data-testid="plaza-row"]'))).toBe(true);
  });

  it("renders empty state when no prompts", () => {
    render(<PromptListPanel prompts={[]} selectedName={null} onSelect={vi.fn()} />);
    expect(screen.getByText(/暂无提示词/)).toBeInTheDocument();
  });

  it("shows has_override badge when only the global layer is in play", () => {
    // proj_1a7d7fcf 2026-08-24 regression: before the fix, the badge stayed
    // hidden when only the global default had a tier-1 override, so users
    // could not tell that the YAML default was being shadowed.
    const withGlobal = [
      ...SAMPLE,
      { name: "novel_outline_generation", category: "", label: "全文大纲", has_override: true, modified_at: "2026-08-24T00:00:00Z", builtin: true, override_source: "global" as const },
    ];
    render(<PromptListPanel prompts={withGlobal} selectedName={null} onSelect={vi.fn()} />);
    // 「全文大纲」同时是 outline 阶段 heading 和 novel_outline_generation 行 label —
    // 找到那个 span 后回退到 plaza-row 按钮(因为 override-dot 是 span 的兄弟,
    // 不是后代),然后从按钮里查 override-dot。
    const labelSpan = screen.getAllByText("全文大纲").find(
      (el) => el.tagName === "SPAN" && el.closest('[data-testid="plaza-row"]') !== null,
    )!;
    const row = labelSpan.closest('[data-testid="plaza-row"]')!;
    expect(row.querySelector('[data-testid="override-dot"]')).toBeInTheDocument();
  });

  it("falls back to the '其他' group for unmapped prompts", () => {
    // 新增 YAML 但忘记更新 stageGroups 时不应丢失,落在「其他」组里。
    const withUnknown = [
      ...SAMPLE,
      { name: "totally_new_future_prompt", category: "", label: "未来新提示词", has_override: false, modified_at: null, builtin: true },
    ];
    render(<PromptListPanel prompts={withUnknown} selectedName={null} onSelect={vi.fn()} />);
    expect(screen.getByText("其他")).toBeInTheDocument();
    const row = screen.getByText("未来新提示词").closest('[data-testid="plaza-row"]')!;
    // 「其他」 heading 必须先于这个 row(同组内 heading 在 row 上方)
    expect(row.compareDocumentPosition(screen.getByText("其他")) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
  });

  it("renders the '其他' group when expected-orphan prompts are present (was hidden when empty)", () => {
    // 2026-09-11 用户反馈:侧栏没看到「其他」组。原因是此前所有 30 个内置
    // prompt 都映射到了具体 stage,「其他」组始终为空、被 groupByStage 过滤掉。
    // 现在 11 个 EXPECTED_ORPHAN_PROMPTS 落在「其他」,该组应该可见。
    const withOrphans = [
      ...SAMPLE,
      // 模拟后端把 EXPECTED_ORPHAN_PROMPTS 列出来 (实际清单见 stageGroups.ts)
      { name: "trope_extraction", category: "", label: "题材标签", has_override: false, modified_at: null, builtin: true },
      { name: "genre_fusion", category: "", label: "题材融合", has_override: false, modified_at: null, builtin: true },
      { name: "novelty_evaluation_llm", category: "", label: "新颖度评分", has_override: false, modified_at: null, builtin: true },
    ];
    render(<PromptListPanel prompts={withOrphans} selectedName={null} onSelect={vi.fn()} />);
    expect(screen.getByText("其他")).toBeInTheDocument();
    // 至少 3 个孤儿应出现在「其他」组下
    expect(screen.getByText("题材标签").closest('[data-testid="plaza-row"]')).toBeInTheDocument();
    expect(screen.getByText("题材融合").closest('[data-testid="plaza-row"]')).toBeInTheDocument();
    expect(screen.getByText("新颖度评分").closest('[data-testid="plaza-row"]')).toBeInTheDocument();
  });

  it("divergence group contains meta_decompose + firstness_decompose + adaptive_diverge (2026-09-20: adaptive_diverge restored)", () => {
    // 2026-09-15 行为变更:第一性拆解 (firstness_decompose) 从 HIDDEN_BUILTIN_PROMPTS
    // 移除,以「兜底拆解提示词」label 暴露在 Plaza UI 创意发散分组下。后端 YAML 仍
    // 是 S1→S2 流程被破坏时的兜底;Plaza 编辑会写 global/project override,流程
    // 正常时仍以 meta_decompose 生成的 per-project prompt 为准。
    //
    // 2026-09-20 行为变更:`adaptive_diverge` 重新进入「创意发散」主流程 — 它是
    // follow_up.yaml 的 {operator_instructions} 占位方法论源(用户在追问 modal
    // 选「自适应」operator 时,本 prompt 的 methodology_block 字段会被拼到
    // follow_up 的 system_prompt 末尾)。Plaza 编辑本 prompt 可调整自适应追问
    // 方法论。
    const fullBuiltin = [
      { name: "meta_decompose", category: "", label: "元提示词", has_override: false, modified_at: null, builtin: true },
      { name: "adaptive_diverge", category: "", label: "自适应追问方法论", has_override: false, modified_at: null, builtin: true },
      { name: "firstness_decompose", category: "", label: "兜底拆解提示词", has_override: false, modified_at: null, builtin: true },
    ];
    const { container } = render(
      <PromptListPanel prompts={fullBuiltin} selectedName={null} onSelect={vi.fn()} />,
    );
    const headings = Array.from(
      container.querySelectorAll<HTMLElement>(
        "div.font-mono.text-\\[10px\\].text-on-surface-variant",
      ),
    ).map((el) => el.textContent);
    // 三个 prompt 全部归到「创意发散」,没有「其他」组渲染
    expect(headings.sort()).toEqual(["创意发散"].sort());
    const rows = Array.from(container.querySelectorAll<HTMLElement>('[data-testid="plaza-row"]'));
    const rowLabels = rows.map((r) => r.textContent);
    // 用 Set 比较内容(避免 Unicode 排序把「自适」推到最前)
    expect(new Set(rowLabels)).toEqual(
      new Set(["自适应追问方法论", "兜底拆解提示词", "元提示词"]),
    );
    // 三个 prompt 都在「创意发散」组,没有任一被踢到「其他」兜底
    for (const label of ["元提示词", "兜底拆解提示词", "自适应追问方法论"]) {
      expect(rowLabels.filter((l) => l === label)).toHaveLength(1);
    }
  });
});
