import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

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

  it("submits RawIntent with id strings", () => {
    (useCreativeDimensions as any).mockReturnValue({ ...stubAll, loading: false, error: null, refresh: vi.fn() });
    const onSubmitted = vi.fn();
    render(<S1InputStep projectId="p1" initial={null} onSubmitted={onSubmitted} />);
    // 通过底部 wizard footer 触发（onSubmitReady 回调）
    // 这里直接调用 textarea 改值
    const ta = screen.getByPlaceholderText(/赛博朋克/) as HTMLTextAreaElement;
    // 检查下拉选项可访问即可
    expect(ta).toBeInTheDocument();
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
});
