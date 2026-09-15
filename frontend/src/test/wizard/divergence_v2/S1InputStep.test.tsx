import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("@/hooks/useCreativeDimensions", () => ({
  useCreativeDimensions: vi.fn(),
  __resetCacheForTests: vi.fn(),
}));
import { useCreativeDimensions } from "@/hooks/useCreativeDimensions";
import S1InputStep from "@/components/wizard/divergence_v2/S1InputStep";

const stubAll = {
  subject: [
    { id: "xuanhuan", name: "玄幻", description: "东方仙侠", status: "active" as const, order: 0, created_at: "a", updated_at: "a" },
    { id: "dushi",    name: "都市", description: "现代都市",   status: "active" as const, order: 1, created_at: "a", updated_at: "a" },
    { id: "xianxia",  name: "仙侠", description: "修仙问道",   status: "active" as const, order: 2, created_at: "a", updated_at: "a" },
  ],
  tone:    [{ id: "rexue", name: "热血", description: "", status: "active" as const, order: 0, created_at: "a", updated_at: "a" }],
  style:   [{ id: "shuangwen", name: "爽文", description: "节奏紧凑", status: "active" as const, order: 0, created_at: "a", updated_at: "a" }],
};

const stubAllInactive = {
  subject: [],
  tone:    [{ id: "rexue", name: "热血", description: "", status: "active" as const, order: 0, created_at: "a", updated_at: "a" }],
  style:   [{ id: "shuangwen", name: "爽文", description: "节奏紧凑", status: "active" as const, order: 0, created_at: "a", updated_at: "a" }],
};

describe("S1InputStep with creative dimensions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders three dropdowns when all dimensions have active entries", () => {
    (useCreativeDimensions as any).mockReturnValue({ ...stubAll, loading: false, error: null, refresh: vi.fn() });
    render(<S1InputStep projectId="p1" initial={null} onSubmitted={() => {}} />);
    expect(screen.getByText("玄幻")).toBeInTheDocument();
    expect(screen.getByText("热血")).toBeInTheDocument();
    expect(screen.getByText("爽文")).toBeInTheDocument();
  });

  it("disables dropdown when dimension has no active entries", () => {
    (useCreativeDimensions as any).mockReturnValue({ ...stubAllInactive, loading: false, error: null, refresh: vi.fn() });
    render(<S1InputStep projectId="p1" initial={null} onSubmitted={() => {}} />);
    // 题材下拉应禁用:在 subject 为空时,第一个 dropdown 按钮(subject)是 disabled 的
    const buttons = screen.getAllByRole("button");
    const dropdownButtons = buttons.filter((b) =>
      b.querySelector(".material-symbols-outlined") !== null,
    );
    // subject 是第一个 dropdown,所以第一个 dropdown button 应 disabled
    expect(dropdownButtons[0]).toBeDisabled();
    // 提示文字应出现
    expect(screen.getByText(/暂无生效选项/)).toBeInTheDocument();
  });

  it("falls back to first entry when initial value is stale", () => {
    (useCreativeDimensions as any).mockReturnValue({ ...stubAll, loading: false, error: null, refresh: vi.fn() });
    // initial.tone 引用 'stale_id' 不在 active 列表
    const initial = { prompt: "a long enough prompt for validation", genre_primary: "xuanhuan", tone: "stale_id", style: "shuangwen" };
    render(<S1InputStep projectId="p1" initial={initial} onSubmitted={() => {}} />);
    // 默认应回退到首项 'rexue'
    expect(screen.getByText("热血")).toBeInTheDocument();
  });

  it("submits RawIntent with name strings (not id slugs)", async () => {
    // 契约变更:旧实现把 dropdown value 设成 store id(如 "xuanhuan"/"rexue"),
    // 后端 raw_intent 持久化的也是 id;修复后 dropdown value 改为 name,
    // 用户看到什么标签 = 后端收到什么值。
    (useCreativeDimensions as any).mockReturnValue({ ...stubAll, loading: false, error: null, refresh: vi.fn() });
    const onSubmitted = vi.fn();
    let submitHandler: (() => void) | null = null;
    const onSubmitReady = vi.fn((handler: (() => void) | null, _valid: boolean) => {
      submitHandler = handler;
    });
    render(
      <S1InputStep
        projectId="p1"
        initial={null}
        onSubmitted={onSubmitted}
        onSubmitReady={onSubmitReady}
      />,
    );
    // prompt 必须 ≥10 字才会让 valid 变 true → useEffect 才会把 handler 注入 onSubmitReady
    const ta = screen.getByPlaceholderText(/赛博朋克/) as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: "一个足够长的灵感点子用来通过校验" } });
    expect(submitHandler).not.toBeNull();
    submitHandler!();
    expect(onSubmitted).toHaveBeenCalledTimes(1);
    expect(onSubmitted).toHaveBeenCalledWith({
      prompt: "一个足够长的灵感点子用来通过校验",
      genre_primary: "玄幻",  // stubAll.subject[0].name,NOT id "xuanhuan"
      tone: "热血",           // NOT id "rexue"
      style: "爽文",          // NOT id "shuangwen"
    });
  });

  it("prefills genre from defaultGenre when initial is null", () => {
    (useCreativeDimensions as any).mockReturnValue({ ...stubAll, loading: false, error: null, refresh: vi.fn() });
    // defaultGenre="xianxia" 是 subject[2](不是 subject[0]=xuanhuan),无 defaultGenre 时会回退到「玄幻」
    render(<S1InputStep projectId="p1" initial={null} defaultGenre="xianxia" onSubmitted={() => {}} />);
    expect(screen.getByText("仙侠")).toBeInTheDocument();
  });

  it("initial.genre_primary takes precedence over defaultGenre", () => {
    (useCreativeDimensions as any).mockReturnValue({ ...stubAll, loading: false, error: null, refresh: vi.fn() });
    // initial.genre_primary="xianxia" + defaultGenre="dushi" → initial 应胜出 → 「仙侠」
    const initial = { prompt: "a long enough prompt for validation", genre_primary: "xianxia", tone: "rexue", style: "shuangwen" };
    render(<S1InputStep projectId="p1" initial={initial} defaultGenre="dushi" onSubmitted={() => {}} />);
    expect(screen.getByText("仙侠")).toBeInTheDocument();
  });

  it("falls back to first active subject when defaultGenre is stale (not in active set)", () => {
    (useCreativeDimensions as any).mockReturnValue({ ...stubAll, loading: false, error: null, refresh: vi.fn() });
    // defaultGenre "deleted_genre" 不在 stubAll.subject 里,应回退到首项「玄幻」(xuanhuan)
    render(<S1InputStep projectId="p1" initial={null} defaultGenre="deleted_genre" onSubmitted={() => {}} />);
    expect(screen.getByText("玄幻")).toBeInTheDocument();
  });

  it("applies defaultGenre when it arrives AFTER first render (async fetch race)", async () => {
    // 真实场景:CreativeDivergenceStep mount 时 defaultGenre 还未加载(async fetch),
    // useThreeBDivergence 完成 getProjectStatus 后 defaultGenre 从 "" 变成 "xianxia",
    // S1InputStep 必须 react 这一变化,而不是锁死在首次渲染的 "cool_novel" fallback。
    const { rerender } = render(<S1InputStep projectId="p1" initial={null} defaultGenre="" onSubmitted={() => {}} />);
    expect(screen.getByText("玄幻")).toBeInTheDocument();  // 初始 fallback 是 subject[0]
    // 模拟异步 fetch 完成后 defaultGenre 到达
    rerender(<S1InputStep projectId="p1" initial={null} defaultGenre="xianxia" onSubmitted={() => {}} />);
    expect(screen.getByText("仙侠")).toBeInTheDocument();  // 异步到达后应切换到 defaultGenre
  });

  it("recovers legacy id like '黑暗' to its name when initial carries polluted old id", () => {
    // 回归测试,对应 2026-09-14 修复的 raw_intent id 污染 bug。
    // 旧 config/creative_dimensions.json 把 tone[5] id/name 互换 (id="黑暗",name="热血"),
    // 用户在 S1 选「热血」时,旧 S1InputStep 把 dropdown value=id="黑暗" 写进 raw_intent,
    // 重开 S1 时 initial.tone="黑暗"。
    // 修复后 S1InputStep 必须通过 resolveInitialValue 的 byId 分支把它反查为 name "热血",
    // 让 dropdown 显示用户原选的标签,而不是显示空字符串或首项。
    const legacyPollutedStore = {
      subject: stubAll.subject,
      tone: [
        // 模拟互换态:id="黑暗",name="热血"(这就是旧数据里"用户选热血但持久化为黑暗"的形态)
        { id: "黑暗", name: "热血", description: "", status: "active" as const, order: 0, created_at: "a", updated_at: "a" },
      ],
      style: stubAll.style,
    };
    (useCreativeDimensions as any).mockReturnValue({
      ...legacyPollutedStore, loading: false, error: null, refresh: vi.fn(),
    });
    const initial = {
      prompt: "a long enough prompt for validation",
      genre_primary: "xuanhuan",
      tone: "黑暗",     // 旧 raw_intent 里被污染的旧 id
      style: "shuangwen",
    };
    render(<S1InputStep projectId="p1" initial={initial} onSubmitted={() => {}} />);
    // dropdown 应显示「热血」(byId("黑暗") → name="热血"),不是「黑暗」也不是首项
    expect(screen.getByText("热血")).toBeInTheDocument();
  });
});
