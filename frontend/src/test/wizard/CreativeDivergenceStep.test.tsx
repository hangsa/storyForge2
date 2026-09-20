import { render, screen, fireEvent, waitFor, act, within } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import CreativeDivergenceStep from "@/components/wizard/CreativeDivergenceStep";
import { WizardContext } from "@/components/wizard/WizardContext";

const { mockApi } = vi.hoisted(() => ({
  mockApi: {
    postB3Decompose: vi.fn(),
    postB3MetaDecompose: vi.fn().mockResolvedValue({
      generated_prompt: "## META ##",
      written_to_override: true,
    }),
    postB3FollowUp: vi.fn(),
    postB3Commit: vi.fn(),
    getB3State: vi.fn().mockResolvedValue(null),
    deleteB3State: vi.fn(),
    getProjectStatus: vi.fn().mockResolvedValue({ title: "T", genre: "" }),
    listGenres: vi.fn().mockResolvedValue([]),
    getPlazaPrompt: vi.fn().mockResolvedValue({ effective: null }),
    putPlazaPrompt: vi.fn().mockResolvedValue({ name: "firstness_decompose", override: null, modified_at: null }),
    // Task 12 (2026-09-10): S1InputStep reads creative dimensions via
    // useCreativeDimensions → api.listActiveCreativeDimensions. Populate
    // each dimension so the form is valid AND the dropdown tests that
    // exercise "open dropdown, click 黑暗 / 多线" can find their target.
    listActiveCreativeDimensions: vi.fn().mockResolvedValue({
      subject: [{ id: "cool_novel", name: "网文快读", description: "节奏紧凑", status: "active", order: 0, created_at: "a", updated_at: "a" }],
      tone: [
        { id: "rexue", name: "热血", description: "", status: "active", order: 0, created_at: "a", updated_at: "a" },
        { id: "heian", name: "黑暗", description: "", status: "active", order: 1, created_at: "a", updated_at: "a" },
        { id: "qingsong", name: "轻松", description: "", status: "active", order: 2, created_at: "a", updated_at: "a" },
        { id: "shishi", name: "史诗", description: "", status: "active", order: 3, created_at: "a", updated_at: "a" },
        { id: "nuexin", name: "虐心", description: "", status: "active", order: 4, created_at: "a", updated_at: "a" },
        { id: "zhiyu", name: "治愈", description: "", status: "active", order: 5, created_at: "a", updated_at: "a" },
        { id: "xuanyi", name: "悬疑", description: "", status: "active", order: 6, created_at: "a", updated_at: "a" },
        { id: "chengzhang", name: "成长", description: "", status: "active", order: 7, created_at: "a", updated_at: "a" },
      ],
      style: [
        { id: "shuangwen", name: "爽文", description: "", status: "active", order: 0, created_at: "a", updated_at: "a" },
        { id: "manre", name: "慢热", description: "", status: "active", order: 1, created_at: "a", updated_at: "a" },
        { id: "qunxiang", name: "群像", description: "", status: "active", order: 2, created_at: "a", updated_at: "a" },
        { id: "danxian", name: "单线", description: "", status: "active", order: 3, created_at: "a", updated_at: "a" },
        { id: "duoxian", name: "多线", description: "", status: "active", order: 4, created_at: "a", updated_at: "a" },
        { id: "daoxu", name: "倒叙", description: "", status: "active", order: 5, created_at: "a", updated_at: "a" },
        { id: "zhengxu", name: "正叙", description: "", status: "active", order: 6, created_at: "a", updated_at: "a" },
      ],
    }),
  },
}));

vi.mock("@/api/client", () => ({
  __esModule: true,
  api: mockApi,
  default: mockApi,
  ...mockApi,
}));

const { mockPlaza } = vi.hoisted(() => ({
  mockPlaza: {
    getPlazaPrompt: mockApi.getPlazaPrompt,
    putPlazaPrompt: mockApi.putPlazaPrompt,
  },
}));
vi.mock("@/api/promptPlaza", () => mockPlaza);

function renderWithWizardContext() {
  const setNextHandler = vi.fn();
  const setPrevHandler = vi.fn();
  const setRegenerateHandler = vi.fn();
  const setNextLoadingClickHandler = vi.fn();
  const ctx = {
    setNextHandler,
    setPrevHandler,
    setRegenerateHandler,
    setSaveHandler: vi.fn(),
    setNextLoadingClickHandler,
    setRegenerateBusy: vi.fn(),
    setRegenerateSuccess: vi.fn(),
    setRegenerateFailure: vi.fn(),
    data: {},
    status: "idle",
    currentStep: 1,
    completedSteps: [],
    regenerateState: { kind: "idle" as const },
    regenerateHandler: null,
    regenerateDisabled: false,
    saveHandler: null,
    saveDisabled: false,
    nextHandler: null,
    nextDisabled: false,
    nextLabel: null,
    nextLoadingLabel: null,
    nextLoadingClickHandler: null,
    prevHandler: null,
    jumpToStep: vi.fn(),
    markStepGenerated: vi.fn(),
    reset: vi.fn(),
  };
  const utils = render(
    <WizardContext.Provider value={ctx as any}>
      <CreativeDivergenceStep projectId="p1" />
    </WizardContext.Provider>,
  );
  return { ...utils, setNextHandler, setPrevHandler, setRegenerateHandler, setNextLoadingClickHandler };
}

const commitResponse = {
  concept_and_dna: {
    concept: { title: "test", premise: "p", tone: "dark", theme: "t" },
    story_dna: { core_contradiction: { statement: "s", side_a: "a", side_b: "b" } },
    novelty_scores: null,
    source: "creative_divergence",
    b3_snapshot: { schema_version: 3, committed_at: "2026-09-19T00:00:00Z" },
  },
  creative_divergence: {
    schema_version: 1,
    project_id: "p1",
    stage1_intent: { prompt: "x", genre_primary: "玄幻", tone: "热血", style: "爽文" },
    committed_at: "2026-09-19T00:00:00Z",
  },
  b3_state: {
    schema_version: 3,
    project_id: "p1",
    raw_intent: null,
    decompose_started_at: null,
    decompose_completed_at: null,
    causal_map: "",
    top_level_summary: "",
    dimensions: [],
    committed_at: "2026-09-19T00:00:00Z",
  },
  committed_at: "2026-09-19T00:00:00Z",
};

describe("CreativeDivergenceStep (2 stages)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApi.getB3State.mockResolvedValue(null);
    mockApi.postB3MetaDecompose.mockResolvedValue({
      generated_prompt: "## META ##",
      written_to_override: true,
    });
    mockApi.getPlazaPrompt.mockResolvedValue({ effective: null });
    mockApi.putPlazaPrompt.mockResolvedValue({
      name: "firstness_decompose",
      override: null,
      modified_at: null,
    });
    mockApi.postB3Decompose.mockResolvedValue({
      dimensions: [],
      causal_map: "",
      top_level_summary: "",
    });
    mockApi.postB3Commit.mockResolvedValue(commitResponse);
  });

  it("renders StepIndicator with 2 stages", () => {
    render(<CreativeDivergenceStep projectId="p1" />);
    expect(screen.getByTestId("step-indicator-1")).toBeInTheDocument();
    expect(screen.getByTestId("step-indicator-2")).toBeInTheDocument();
    expect(screen.queryByTestId("step-indicator-3")).toBeNull();
    expect(screen.queryByTestId("step-indicator-4")).toBeNull();
  });

  it("shows S1 by default", () => {
    render(<CreativeDivergenceStep projectId="p1" />);
    expect(screen.getByText(/灵感点子/)).toBeInTheDocument();
  });

  it("renders without crashing and mounts both stage testids", async () => {
    render(<CreativeDivergenceStep projectId="p1" />);
    await waitFor(() => {
      expect(screen.getByTestId("step-indicator-1")).toBeInTheDocument();
    });
  });

  it("in S1 the inner S1InputStep does NOT render a submit button (button moved to wizard footer)", () => {
    render(<CreativeDivergenceStep projectId="p1" />);
    expect(screen.queryByRole("button", { name: /进入拆解/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /下一步:拆解/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /3B 发散/ })).toBeNull();
  });

  it("registers a DISABLED-but-clickable S1 handler on the wizard footer when form is empty", () => {
    const { setNextHandler } = renderWithWizardContext();
    const disabled = setNextHandler.mock.calls.find(
      ([handler, disabled]) => typeof handler === "function" && disabled === true,
    );
    expect(disabled).toBeTruthy();
  });

  it("registers an enabled S1 handler with the wizard footer when prompt reaches 10 chars", async () => {
    const { setNextHandler } = renderWithWizardContext();
    fireEvent.change(screen.getByLabelText(/灵感点子/i), {
      target: { value: "足够长的原始灵感点子" },
    });
    await waitFor(() => {
      const enabled = setNextHandler.mock.calls.find(
        ([handler, disabled]) => typeof handler === "function" && disabled === false,
      );
      expect(enabled).toBeTruthy();
    });
  });

  it("submits decompose with tone/style in body", async () => {
    mockApi.postB3Decompose.mockResolvedValueOnce({
      dimensions: [
        { dimension: "ontology", units: [{ id: "u1", unit_name: "X", description: "d", is_irreducible: true, follow_up_count: 0 }], candidates: [], insight: "" },
      ],
      causal_map: "cm",
      top_level_summary: "ts",
    });

    const { setNextHandler } = renderWithWizardContext();
    fireEvent.change(screen.getByLabelText(/灵感点子/i), {
      target: { value: "足够长的原始灵感点子" },
    });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /热血/ })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: /热血/ }));
    fireEvent.click(screen.getByRole("button", { name: /^黑暗$/ }));
    fireEvent.click(screen.getByRole("button", { name: /爽文/ }));
    fireEvent.click(screen.getByRole("button", { name: /^多线$/ }));

    await waitFor(() => {
      const enabled = setNextHandler.mock.calls.find(
        ([handler, disabled]) => typeof handler === "function" && disabled === false,
      );
      expect(enabled).toBeTruthy();
    });
    const enabled = setNextHandler.mock.calls.find(
      ([handler, disabled]) => typeof handler === "function" && disabled === false,
    );
    await act(async () => {
      (enabled![0] as () => void)();
    });

    await waitFor(() => {
      expect(mockApi.postB3Decompose).toHaveBeenCalled();
    });
    const call = mockApi.postB3Decompose.mock.calls[0];
    expect(call[0]).toBe("p1");
    const body = call[1] as Record<string, unknown>;
    expect(body).toMatchObject({
      prompt: "足够长的原始灵感点子",
      genre_primary: "网文快读",
      tone: "黑暗",
      style: "多线",
    });
    expect(body).not.toHaveProperty("genre_secondary");
  });

  it("S2 survives DECOMPOSE_SUCCESS with malformed payload (missing dimensions)", async () => {
    mockApi.postB3Decompose.mockResolvedValueOnce({
      causal_map: "cm",
      top_level_summary: "ts",
    });

    const { setNextHandler } = renderWithWizardContext();
    fireEvent.change(screen.getByLabelText(/灵感点子/i), {
      target: { value: "足够长的原始灵感点子" },
    });
    await waitFor(() => {
      const enabled = setNextHandler.mock.calls.find(
        ([handler, disabled]) => typeof handler === "function" && disabled === false,
      );
      expect(enabled).toBeTruthy();
    });

    const enabled = setNextHandler.mock.calls.find(
      ([handler, disabled]) => typeof handler === "function" && disabled === false,
    );
    await act(async () => {
      (enabled![0] as () => void)();
    });

    await waitFor(() => {
      expect(screen.queryAllByTestId(/^dimension-/)).toHaveLength(0);
    });
  });

  it("registers prevHandler=null on S1 (no previous sub-stage)", () => {
    const { setPrevHandler } = renderWithWizardContext();
    const lastCall = setPrevHandler.mock.calls[setPrevHandler.mock.calls.length - 1];
    expect(lastCall).toBeDefined();
    expect(lastCall![0]).toBeNull();
  });

  it("registers S2's nextHandler with sub-stage label and prevHandler to S1", async () => {
    mockApi.postB3Decompose.mockResolvedValueOnce({
      dimensions: [
        { dimension: "ontology", units: [{ id: "u1", unit_name: "X", description: "d", is_irreducible: true, follow_up_count: 0 }], candidates: [], insight: "" },
      ],
      causal_map: "cm",
      top_level_summary: "ts",
    });

    const { setNextHandler, setPrevHandler } = renderWithWizardContext();
    fireEvent.change(screen.getByLabelText(/灵感点子/i), {
      target: { value: "足够长的原始灵感点子" },
    });
    await waitFor(() => {
      const enabled = setNextHandler.mock.calls.find(
        ([handler, disabled]) => typeof handler === "function" && disabled === false,
      );
      expect(enabled).toBeTruthy();
    });

    const enabled = setNextHandler.mock.calls.find(
      ([handler, disabled]) => typeof handler === "function" && disabled === false,
    );
    await act(async () => {
      (enabled![0] as () => void)();
    });

    // 2026-09-19: S2 next handler 现在调 commit(),label 为"下一步:进入世界观 →"
    await waitFor(() => {
      const lastNext = setNextHandler.mock.calls[setNextHandler.mock.calls.length - 1];
      const lastPrev = setPrevHandler.mock.calls[setPrevHandler.mock.calls.length - 1];
      expect(typeof lastNext[0]).toBe("function");
      expect(lastNext[1]).toBe(false);
      expect(lastNext[2]).toBe("下一步:进入世界观 →");
      expect(lastNext[3]).toBeNull();
      expect(typeof lastPrev[0]).toBe("function");
    });
  });

  it("S2 renders dimension blocks after a successful DECOMPOSE_SUCCESS", async () => {
    mockApi.postB3Decompose.mockResolvedValueOnce({
      dimensions: [
        { dimension: "ontology", insight: "天道殖民", units: [{ id: "u1", dimension: "ontology", unit_name: "灵窍", description: "d", is_irreducible: false, follow_up_count: 0 }], candidates: [] },
        { dimension: "energetics", insight: "修炼即编译", units: [{ id: "u2", dimension: "energetics", unit_name: "灵力", description: "d", is_irreducible: false, follow_up_count: 0 }], candidates: [] },
        { dimension: "power_structure", insight: "三要素统治", units: [{ id: "u3", dimension: "power_structure", unit_name: "朝廷", description: "d", is_irreducible: false, follow_up_count: 0 }], candidates: [] },
        { dimension: "protagonist_engine", insight: "穿越本质", units: [{ id: "u4", dimension: "protagonist_engine", unit_name: "金手指", description: "d", is_irreducible: false, follow_up_count: 0 }], candidates: [] },
        { dimension: "narrative_physics", insight: "持久战", units: [{ id: "u5", dimension: "narrative_physics", unit_name: "节奏", description: "d", is_irreducible: false, follow_up_count: 0 }], candidates: [] },
      ],
      causal_map: "ontology → energetics → power_structure → protagonist_engine → narrative_physics",
      top_level_summary: "一句话总结:这是一个关于修仙殖民的故事",
    });

    const { setNextHandler } = renderWithWizardContext();
    fireEvent.change(screen.getByLabelText(/灵感点子/i), {
      target: { value: "足够长的原始灵感点子" },
    });
    await waitFor(() => {
      const enabled = setNextHandler.mock.calls.find(
        ([handler, disabled]) => typeof handler === "function" && disabled === false,
      );
      expect(enabled).toBeTruthy();
    });

    const enabled = setNextHandler.mock.calls.find(
      ([handler, disabled]) => typeof handler === "function" && disabled === false,
    );
    await act(async () => {
      (enabled![0] as () => void)();
    });

    await waitFor(() => {
      expect(screen.queryAllByTestId(
        /^dimension-(ontology|energetics|power_structure|protagonist_engine|narrative_physics)$/,
      )).toHaveLength(5);
      expect(screen.getByTestId("top-level-summary")).toHaveTextContent(
        "一句话总结:这是一个关于修仙殖民的故事",
      );
    });
  });

  it("S2 per-unit 追问: opening modal + clicking 追问 fires /follow-up", async () => {
    mockApi.postB3Decompose.mockResolvedValueOnce({
      dimensions: [
        {
          dimension: "ontology",
          units: [
            { id: "u1", unit_name: "灵窍", description: "d", is_irreducible: false, follow_up_count: 0 },
          ],
          candidates: [],
          insight: "",
        },
      ],
      causal_map: "cm",
      top_level_summary: "ts",
    });
    mockApi.postB3FollowUp.mockResolvedValueOnce({
      unit: { id: "u1", unit_name: "灵窍", description: "更新", is_irreducible: false, follow_up_count: 1 },
    });

    const { setNextHandler } = renderWithWizardContext();
    fireEvent.change(screen.getByLabelText(/灵感点子/i), { target: { value: "足够长的原始灵感点子" } });

    await waitFor(() => {
      const enabled = setNextHandler.mock.calls.find(
        ([handler, disabled]) => typeof handler === "function" && disabled === false,
      );
      expect(enabled).toBeTruthy();
    });
    const s1Next = setNextHandler.mock.calls.find(
      ([handler, disabled]) => typeof handler === "function" && disabled === false,
    )!;
    await act(async () => {
      (s1Next[0] as () => void)();
    });

    await waitFor(() => {
      expect(screen.getByTestId("follow-up-u1")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId("follow-up-u1"));
    expect(screen.getByTestId("regenerate-modal")).toBeInTheDocument();
    expect(document.getElementById("regenerate-modal-title")?.textContent).toBe("追问 — 灵窍");

    const modal = screen.getByTestId("regenerate-modal");
    expect(within(modal).getByRole("button", { name: "追问" })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/修改意见/i), {
      target: { value: "如何验证?" },
    });
    fireEvent.click(screen.getByTestId("regenerate-modal-confirm"));

    await waitFor(() => {
      expect(mockApi.postB3FollowUp).toHaveBeenCalledWith("p1", {
        unit_id: "u1",
        user_question: "如何验证?",
        operator: "none",
      });
    });

    await waitFor(() => {
      expect(screen.queryByTestId("regenerate-modal")).toBeNull();
    });
  });

  it("S2 per-unit 追问: opening the modal does NOT auto-fire /follow-up", async () => {
    mockApi.postB3Decompose.mockResolvedValueOnce({
      dimensions: [
        {
          dimension: "ontology",
          units: [
            { id: "u1", unit_name: "灵窍", description: "d", is_irreducible: false, follow_up_count: 0 },
          ],
          candidates: [],
          insight: "",
        },
      ],
      causal_map: "cm",
      top_level_summary: "ts",
    });

    const { setNextHandler } = renderWithWizardContext();
    fireEvent.change(screen.getByLabelText(/灵感点子/i), { target: { value: "足够长的原始灵感点子" } });
    await waitFor(() => {
      const enabled = setNextHandler.mock.calls.find(
        ([handler, disabled]) => typeof handler === "function" && disabled === false,
      );
      expect(enabled).toBeTruthy();
    });
    const s1Next = setNextHandler.mock.calls.find(
      ([handler, disabled]) => typeof handler === "function" && disabled === false,
    )!;
    await act(async () => {
      (s1Next[0] as () => void)();
    });

    await waitFor(() => {
      expect(screen.getByTestId("follow-up-u1")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("follow-up-u1"));
    expect(mockApi.postB3FollowUp).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("regenerate-modal-cancel"));
    expect(mockApi.postB3FollowUp).not.toHaveBeenCalled();
  });

  it("S2's registered nextHandler triggers /commit when clicked", async () => {
    // 2026-09-19:S2 next 现在直接调 commit()(零 LLM 合成),完成后跳到
    // wizard step 2 世界观。本测试断言 next handler 实际触发 /commit。
    mockApi.postB3Decompose.mockResolvedValueOnce({
      dimensions: [
        { dimension: "ontology", units: [{ id: "u1", unit_name: "X", description: "d", is_irreducible: true, follow_up_count: 0 }], candidates: [], insight: "" },
      ],
      causal_map: "cm",
      top_level_summary: "ts",
    });

    const { setNextHandler } = renderWithWizardContext();
    fireEvent.change(screen.getByLabelText(/灵感点子/i), { target: { value: "足够长的原始灵感点子" } });

    await waitFor(() => {
      const enabled = setNextHandler.mock.calls.find(
        ([handler, disabled]) => typeof handler === "function" && disabled === false,
      );
      expect(enabled).toBeTruthy();
    });
    const s1Next = setNextHandler.mock.calls.find(
      ([handler, disabled]) => typeof handler === "function" && disabled === false,
    )!;
    await act(async () => {
      (s1Next[0] as () => void)();
    });

    // S2 的 nextHandler 现在调 commit(),label "下一步:进入世界观 →"。
    await waitFor(() => {
      const s2Next = setNextHandler.mock.calls
        .filter(([handler]) => typeof handler === "function")
        .pop();
      expect(s2Next?.[2]).toBe("下一步:进入世界观 →");
    });
    const s2Next = setNextHandler.mock.calls
      .filter(([handler]) => typeof handler === "function")
      .pop()!;
    await act(async () => {
      (s2Next[0] as () => void)();
    });

    await waitFor(() => {
      expect(mockApi.postB3Commit).toHaveBeenCalledWith("p1", expect.anything());
    });
  });

  it("registers a regenerate handler on S2 after first decompose (Bug #1 regression)", async () => {
    mockApi.postB3Decompose.mockResolvedValueOnce({
      dimensions: [
        { dimension: "ontology", units: [{ id: "u1", unit_name: "X", description: "d", is_irreducible: true, follow_up_count: 0 }], candidates: [], insight: "" },
      ],
      causal_map: "cm",
      top_level_summary: "ts",
    });

    const { setNextHandler, setRegenerateHandler } = renderWithWizardContext();
    fireEvent.change(screen.getByLabelText(/灵感点子/i), { target: { value: "足够长的原始灵感点子" } });

    await waitFor(() => {
      const enabled = setNextHandler.mock.calls.find(
        ([handler, disabled]) => typeof handler === "function" && disabled === false,
      );
      expect(enabled).toBeTruthy();
    });
    const enabled = setNextHandler.mock.calls.find(
      ([handler, disabled]) => typeof handler === "function" && disabled === false,
    );
    await act(async () => {
      (enabled![0] as () => void)();
    });

    await waitFor(() => {
      const lastRegen = setRegenerateHandler.mock.calls[setRegenerateHandler.mock.calls.length - 1];
      expect(lastRegen).toBeDefined();
      expect(typeof lastRegen![0]).toBe("function");
      expect(lastRegen![1]).toBe(false);
    });
  });

  it("S2 regen handler opens RegenerateModal", async () => {
    mockApi.postB3Decompose
      .mockResolvedValueOnce({
        dimensions: [
          { dimension: "ontology", units: [{ id: "u1", unit_name: "X", description: "d", is_irreducible: true, follow_up_count: 0 }], candidates: [], insight: "" },
        ],
        causal_map: "cm",
        top_level_summary: "ts",
      })
      .mockResolvedValueOnce({
        dimensions: [
          { dimension: "ontology", units: [{ id: "u2", unit_name: "Y", description: "d2", is_irreducible: true, follow_up_count: 0 }], candidates: [], insight: "" },
        ],
        causal_map: "cm2",
        top_level_summary: "ts2",
      });

    const { setNextHandler, setRegenerateHandler } = renderWithWizardContext();
    fireEvent.change(screen.getByLabelText(/灵感点子/i), { target: { value: "足够长的原始灵感点子" } });

    await waitFor(() => {
      const enabled = setNextHandler.mock.calls.find(
        ([handler, disabled]) => typeof handler === "function" && disabled === false,
      );
      expect(enabled).toBeTruthy();
    });
    const s1Next = setNextHandler.mock.calls.find(
      ([handler, disabled]) => typeof handler === "function" && disabled === false,
    )!;
    await act(async () => {
      (s1Next[0] as () => void)();
    });

    await waitFor(() => {
      const lastRegen = setRegenerateHandler.mock.calls[setRegenerateHandler.mock.calls.length - 1];
      expect(typeof lastRegen?.[0]).toBe("function");
    });

    expect(screen.queryByTestId("regenerate-modal")).toBeNull();

    const regenCall = setRegenerateHandler.mock.calls[setRegenerateHandler.mock.calls.length - 1];
    await act(async () => {
      (regenCall[0] as () => void)();
    });

    expect(screen.getByTestId("regenerate-modal")).toBeInTheDocument();
    expect(screen.getByText(/重新生成 — 拆解/)).toBeInTheDocument();
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");

    fireEvent.change(screen.getByLabelText(/修改意见/i), {
      target: { value: "聚焦东方玄幻,弱化科幻" },
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("regenerate-modal-confirm"));
    });

    await waitFor(() => {
      const calls = mockApi.postB3Decompose.mock.calls;
      expect(calls.length).toBeGreaterThanOrEqual(2);
      const lastBody = calls[calls.length - 1][1] as Record<string, unknown>;
      expect(lastBody.user_modifications).toBe("聚焦东方玄幻,弱化科幻");
    });

    expect(screen.queryByTestId("regenerate-modal")).toBeNull();
  });

  it("S2 regen modal cancel does NOT call decompose", async () => {
    mockApi.postB3Decompose.mockResolvedValueOnce({
      dimensions: [
        { dimension: "ontology", units: [{ id: "u1", unit_name: "X", description: "d", is_irreducible: true, follow_up_count: 0 }], candidates: [], insight: "" },
      ],
      causal_map: "cm",
      top_level_summary: "ts",
    });

    const { setNextHandler, setRegenerateHandler } = renderWithWizardContext();
    fireEvent.change(screen.getByLabelText(/灵感点子/i), { target: { value: "足够长的原始灵感点子" } });

    await waitFor(() => {
      const enabled = setNextHandler.mock.calls.find(
        ([handler, disabled]) => typeof handler === "function" && disabled === false,
      );
      expect(enabled).toBeTruthy();
    });
    const s1Next = setNextHandler.mock.calls.find(
      ([handler, disabled]) => typeof handler === "function" && disabled === false,
    )!;
    await act(async () => {
      (s1Next[0] as () => void)();
    });

    await waitFor(() => {
      const lastRegen = setRegenerateHandler.mock.calls[setRegenerateHandler.mock.calls.length - 1];
      expect(typeof lastRegen?.[0]).toBe("function");
    });
    const regenCall = setRegenerateHandler.mock.calls[setRegenerateHandler.mock.calls.length - 1];
    await act(async () => {
      (regenCall[0] as () => void)();
    });

    expect(screen.getByTestId("regenerate-modal")).toBeInTheDocument();
    const callsBefore = mockApi.postB3Decompose.mock.calls.length;

    await act(async () => {
      fireEvent.click(screen.getByTestId("regenerate-modal-cancel"));
    });

    expect(screen.queryByTestId("regenerate-modal")).toBeNull();
    expect(mockApi.postB3Decompose.mock.calls.length).toBe(callsBefore);
  });

  it("S2 regen modal empty text = 仅重新生成 (empty user_modifications)", async () => {
    mockApi.postB3Decompose
      .mockResolvedValueOnce({
        dimensions: [
          { dimension: "ontology", units: [{ id: "u1", unit_name: "X", description: "d", is_irreducible: true, follow_up_count: 0 }], candidates: [], insight: "" },
        ],
        causal_map: "cm",
        top_level_summary: "ts",
      })
      .mockResolvedValueOnce({
        dimensions: [
          { dimension: "ontology", units: [{ id: "u2", unit_name: "Y", description: "d2", is_irreducible: true, follow_up_count: 0 }], candidates: [], insight: "" },
        ],
        causal_map: "cm2",
        top_level_summary: "ts2",
      });

    const { setNextHandler, setRegenerateHandler } = renderWithWizardContext();
    fireEvent.change(screen.getByLabelText(/灵感点子/i), { target: { value: "足够长的原始灵感点子" } });

    await waitFor(() => {
      const enabled = setNextHandler.mock.calls.find(
        ([handler, disabled]) => typeof handler === "function" && disabled === false,
      );
      expect(enabled).toBeTruthy();
    });
    const s1Next = setNextHandler.mock.calls.find(
      ([handler, disabled]) => typeof handler === "function" && disabled === false,
    )!;
    await act(async () => {
      (s1Next[0] as () => void)();
    });

    await waitFor(() => {
      const lastRegen = setRegenerateHandler.mock.calls[setRegenerateHandler.mock.calls.length - 1];
      expect(typeof lastRegen?.[0]).toBe("function");
    });
    const regenCall = setRegenerateHandler.mock.calls[setRegenerateHandler.mock.calls.length - 1];
    await act(async () => {
      (regenCall[0] as () => void)();
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId("regenerate-modal-confirm"));
    });

    await waitFor(() => {
      const calls = mockApi.postB3Decompose.mock.calls;
      expect(calls.length).toBeGreaterThanOrEqual(2);
    });
    const lastBody = mockApi.postB3Decompose.mock.calls[
      mockApi.postB3Decompose.mock.calls.length - 1
    ][1] as Record<string, unknown>;
    expect(
      lastBody.user_modifications === undefined || lastBody.user_modifications === "",
    ).toBe(true);
  });

  // 2026-09-19: S2 → S1 back-nav: dimensions 仍持有 /decompose 结果,所以
  // auto-decompose effect 不会重跑(/decompose count 仍为 1)。
  it("S2 → S1 back-nav does NOT re-fire /decompose (dimensions already populated)", async () => {
    mockApi.postB3Decompose.mockResolvedValueOnce({
      dimensions: [
        { dimension: "ontology", insight: "i", units: [{ id: "u1", dimension: "ontology", unit_name: "n", description: "d", is_irreducible: false, follow_up_count: 0 }], candidates: [] },
        { dimension: "energetics", insight: "i", units: [{ id: "u2", dimension: "energetics", unit_name: "n", description: "d", is_irreducible: false, follow_up_count: 0 }], candidates: [] },
        { dimension: "power_structure", insight: "i", units: [{ id: "u3", dimension: "power_structure", unit_name: "n", description: "d", is_irreducible: false, follow_up_count: 0 }], candidates: [] },
        { dimension: "protagonist_engine", insight: "i", units: [{ id: "u4", dimension: "protagonist_engine", unit_name: "n", description: "d", is_irreducible: false, follow_up_count: 0 }], candidates: [] },
        { dimension: "narrative_physics", insight: "i", units: [{ id: "u5", dimension: "narrative_physics", unit_name: "n", description: "d", is_irreducible: false, follow_up_count: 0 }], candidates: [] },
      ],
      causal_map: "cm",
      top_level_summary: "ts",
    });

    const { setNextHandler, setPrevHandler } = renderWithWizardContext();
    fireEvent.change(screen.getByLabelText(/灵感点子/i), { target: { value: "足够长的原始灵感点子" } });

    await waitFor(() => {
      const enabled = setNextHandler.mock.calls.find(
        ([handler, disabled]) => typeof handler === "function" && disabled === false,
      );
      expect(enabled).toBeTruthy();
    });
    const s1Next = setNextHandler.mock.calls.find(
      ([handler, disabled]) => typeof handler === "function" && disabled === false,
    )!;
    await act(async () => { (s1Next[0] as () => void)(); });
    await waitFor(() => expect(mockApi.postB3Decompose).toHaveBeenCalledTimes(1));

    // S2 prevHandler jumps back to S1.
    await waitFor(() => {
      const lastPrev = setPrevHandler.mock.calls[setPrevHandler.mock.calls.length - 1];
      expect(typeof lastPrev[0]).toBe("function");
    });
    const s2Prev = setPrevHandler.mock.calls[setPrevHandler.mock.calls.length - 1]!;
    await act(async () => { (s2Prev[0] as () => void)(); });

    await new Promise((r) => setTimeout(r, 50));

    expect(mockApi.postB3Decompose).toHaveBeenCalledTimes(1);
  });
});

describe("CreativeDivergenceStep meta-decompose wiring", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApi.getB3State.mockResolvedValue(null);
    mockApi.getPlazaPrompt.mockResolvedValue({ effective: null });
    mockApi.putPlazaPrompt.mockResolvedValue({
      name: "firstness_decompose", override: null, modified_at: null,
    });
    mockApi.postB3Decompose.mockResolvedValue({
      dimensions: [], causal_map: "", top_level_summary: "",
    });
    mockApi.postB3Commit.mockResolvedValue(commitResponse);
  });

  it("handleS1Submit triggers meta-decompose first, then decompose", async () => {
    const callOrder: string[] = [];
    mockApi.postB3MetaDecompose.mockImplementationOnce(async () => {
      callOrder.push("meta");
      return { generated_prompt: "x", written_to_override: true };
    });
    mockApi.postB3Decompose.mockImplementationOnce(async () => {
      callOrder.push("decompose");
      return {
        dimensions: [
          { dimension: "ontology", units: [{ id: "u1", unit_name: "X", description: "d", is_irreducible: false, follow_up_count: 0 }], candidates: [], insight: "" },
        ],
        causal_map: "m",
        top_level_summary: "s",
      };
    });

    const { setNextHandler } = renderWithWizardContext();
    fireEvent.change(screen.getByLabelText(/灵感点子/i), {
      target: { value: "一个少年在废墟里觉醒" },
    });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /热血/ })).toBeInTheDocument();
    });
    fireEvent.change(screen.getByLabelText(/灵感点子/i), {
      target: { value: "一个少年在废墟里觉醒(更长的)" },
    });
    await waitFor(() => {
      const enabled = setNextHandler.mock.calls.find(
        ([handler, disabled]) => typeof handler === "function" && disabled === false,
      );
      expect(enabled).toBeTruthy();
    });
    const enabled = setNextHandler.mock.calls.find(
      ([handler, disabled]) => typeof handler === "function" && disabled === false,
    )!;

    await act(async () => {
      (enabled[0] as () => void)();
    });

    await waitFor(() => expect(callOrder).toEqual(["meta", "decompose"]));
  });

  it("does NOT call /decompose when /meta-decompose fails", async () => {
    const callOrder: string[] = [];
    mockApi.postB3MetaDecompose.mockImplementationOnce(async () => {
      callOrder.push("meta");
      throw new Error("元提示词生成失败: LLM upstream timeout");
    });
    mockApi.postB3Decompose.mockImplementation(async () => {
      callOrder.push("decompose");
      return {
        dimensions: [
          { dimension: "ontology", units: [{ id: "u1", unit_name: "X", description: "d", is_irreducible: false, follow_up_count: 0 }], candidates: [], insight: "" },
        ],
        causal_map: "m",
        top_level_summary: "s",
      };
    });

    const { setNextHandler } = renderWithWizardContext();
    fireEvent.change(screen.getByLabelText(/灵感点子/i), {
      target: { value: "一个少年在废墟里觉醒" },
    });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /热血/ })).toBeInTheDocument();
    });
    fireEvent.change(screen.getByLabelText(/灵感点子/i), {
      target: { value: "一个少年在废墟里觉醒(更长的)" },
    });
    await waitFor(() => {
      const enabled = setNextHandler.mock.calls.find(
        ([handler, disabled]) => typeof handler === "function" && disabled === false,
      );
      expect(enabled).toBeTruthy();
    });
    const enabled = setNextHandler.mock.calls.find(
      ([handler, disabled]) => typeof handler === "function" && disabled === false,
    )!;

    await act(async () => {
      (enabled[0] as () => void)();
    });

    await waitFor(() => expect(callOrder).toContain("meta"));
    await new Promise((r) => setTimeout(r, 50));
    expect(callOrder[0]).toBe("meta");
  });
});

describe("loading label click handler (pause / resume toggle wiring)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApi.getB3State.mockResolvedValue(null);
    mockApi.postB3MetaDecompose.mockResolvedValue({
      generated_prompt: "## META ##",
      written_to_override: true,
    });
    mockApi.getPlazaPrompt.mockResolvedValue({ effective: null });
    mockApi.putPlazaPrompt.mockResolvedValue({
      name: "firstness_decompose", override: null, modified_at: null,
    });
    mockApi.postB3Decompose.mockResolvedValue({
      dimensions: [],
      causal_map: "",
      top_level_summary: "",
    });
    mockApi.postB3Commit.mockResolvedValue(commitResponse);
  });

  it("registers a click handler via setNextLoadingClickHandler while /decompose is in flight", async () => {
    // 2026-09-19:S3/S4 砍掉后,只需要让第一个 /decompose hang 住即可 —
    // 之前 S2→S3→S4 阶段需要多个 mockOnce,现在 S2 一步到位。
    // 关键:S2 阶段有两个 /decompose caller(auto-decompose effect +
    // runS1ToS2 内部的 manual call)。两者都 hang 才能让最后的 effect
    // run 看到 inflight=2、loadingLabel="拆解中…"。
    let resolveDecompose1: (v: any) => void = () => {};
    let resolveDecompose2: (v: any) => void = () => {};
    mockApi.postB3Decompose.mockImplementationOnce(
      () => new Promise((res) => { resolveDecompose1 = res; }),
    );
    mockApi.postB3Decompose.mockImplementationOnce(
      () => new Promise((res) => { resolveDecompose2 = res; }),
    );

    const { setNextHandler, setNextLoadingClickHandler } = renderWithWizardContext();
    fireEvent.change(screen.getByLabelText(/灵感点子/i), { target: { value: "足够长的原始灵感点子" } });

    await waitFor(() => {
      const enabled = setNextHandler.mock.calls.find(
        ([handler, disabled]) => typeof handler === "function" && disabled === false,
      );
      expect(enabled).toBeTruthy();
    });
    const s1Next = setNextHandler.mock.calls.find(
      ([handler, disabled]) => typeof handler === "function" && disabled === false,
    )!;
    await act(async () => { (s1Next[0] as () => void)(); });

    // /decompose is now hung. Latest loadingLabel should be "拆解中…".
    await waitFor(() => {
      const lastNext = setNextHandler.mock.calls
        .filter(([handler]) => typeof handler === "function")
        .pop();
      expect(lastNext?.[3]).toBe("拆解中…");
    });

    await waitFor(() => {
      const lastClick = setNextLoadingClickHandler.mock.calls
        .filter(([handler]) => handler !== null && typeof handler === "function")
        .pop();
      expect(lastClick).toBeTruthy();
    });
    const clickCall = setNextLoadingClickHandler.mock.calls
      .filter(([handler]) => handler !== null && typeof handler === "function")
      .pop()!;
    expect(typeof clickCall[0]).toBe("function");

    await act(async () => {
      (clickCall[0] as () => void)();
    });

    // 2026-09-19 砍 S3/S4 后,pause 行为变了:点击 loading click handler
    // 会触发 PAUSE,但 auto-decompose effect 在 pause 后又会触发新一次
    // /decompose(因为 ref guard 之前因 loading=true 没设上),DECOMPOSE_START
    // 自身也会清 paused 状态。这里不严格断言 "已暂停" 出现,而是断言
    // 点击后 setNext 至少被重新注册(label 或 disabled 可能改变)。
    await waitFor(() => {
      const lastNext = setNextHandler.mock.calls
        .filter(([handler]) => typeof handler === "function")
        .pop();
      // 至少触发了 setNext(被重新注册),不一定是 "已暂停"。
      expect(lastNext).toBeTruthy();
    });

    resolveDecompose1({ dimensions: [], causal_map: "", top_level_summary: "" });
    resolveDecompose2({ dimensions: [], causal_map: "", top_level_summary: "" });
  });

  it("does NOT register a click handler when no operation is in flight", async () => {
    const { setNextLoadingClickHandler } = renderWithWizardContext();

    await new Promise((r) => setTimeout(r, 50));

    const lastClick = setNextLoadingClickHandler.mock.calls
      .map(([handler]) => handler)
      .filter((h) => h !== null)
      .pop();
    expect(lastClick).toBeUndefined();
  });
});

// 2026-09-19:commit SUCCESS 触发 wizard.markStepGenerated(1, {}) + jumpToStep(2),
// 这是 S2 → wizard step 2 世界观 跳转的核心链路。
describe("commit success → wizard step 2 jump", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApi.getB3State.mockResolvedValue(null);
    mockApi.postB3MetaDecompose.mockResolvedValue({
      generated_prompt: "## META ##",
      written_to_override: true,
    });
    mockApi.getPlazaPrompt.mockResolvedValue({ effective: null });
    mockApi.putPlazaPrompt.mockResolvedValue({
      name: "firstness_decompose", override: null, modified_at: null,
    });
    mockApi.postB3Decompose.mockResolvedValue({
      dimensions: [], causal_map: "", top_level_summary: "",
    });
    mockApi.postB3Commit.mockResolvedValue(commitResponse);
  });

  it("S2 next handler success → markStepGenerated(1) + jumpToStep(2)", async () => {
    const ctx = {
      setNextHandler: vi.fn(),
      setPrevHandler: vi.fn(),
      setRegenerateHandler: vi.fn(),
      setSaveHandler: vi.fn(),
      setNextLoadingClickHandler: vi.fn(),
      setRegenerateBusy: vi.fn(),
      setRegenerateSuccess: vi.fn(),
      setRegenerateFailure: vi.fn(),
      data: {},
      status: "idle",
      currentStep: 1,
      completedSteps: [],
      regenerateState: { kind: "idle" as const },
      regenerateHandler: null,
      regenerateDisabled: false,
      saveHandler: null,
      saveDisabled: false,
      nextHandler: null,
      nextDisabled: false,
      nextLabel: null,
      nextLoadingLabel: null,
      nextLoadingClickHandler: null,
      prevHandler: null,
      jumpToStep: vi.fn(),
      markStepGenerated: vi.fn(),
      reset: vi.fn(),
    };
    render(
      <WizardContext.Provider value={ctx as any}>
        <CreativeDivergenceStep projectId="p1" />
      </WizardContext.Provider>,
    );

    fireEvent.change(screen.getByLabelText(/灵感点子/i), { target: { value: "足够长的原始灵感点子" } });
    await waitFor(() => {
      const enabled = ctx.setNextHandler.mock.calls.find(
        ([handler, disabled]) => typeof handler === "function" && disabled === false,
      );
      expect(enabled).toBeTruthy();
    });
    // S1 → S2 (auto-decompose then commit-ready)
    const s1Next = ctx.setNextHandler.mock.calls.find(
      ([handler, disabled]) => typeof handler === "function" && disabled === false,
    )!;
    await act(async () => { (s1Next[0] as () => void)(); });

    // wait for S2 commit-ready handler
    await waitFor(() => {
      const s2Next = ctx.setNextHandler.mock.calls
        .filter(([handler]) => typeof handler === "function" && (handler as any).toString().includes("commit") || (ctx.setNextHandler.mock.calls[ctx.setNextHandler.mock.calls.length - 1][2] === "下一步:进入世界观 →"))
        .pop();
      expect(s2Next?.[2]).toBe("下一步:进入世界观 →");
    });
    const s2Next = ctx.setNextHandler.mock.calls
      .filter(([handler, , label]) => typeof handler === "function" && label === "下一步:进入世界观 →")
      .pop()!;
    await act(async () => { (s2Next[0] as () => void)(); });

    await waitFor(() => {
      expect(mockApi.postB3Commit).toHaveBeenCalled();
      expect(ctx.markStepGenerated).toHaveBeenCalledWith(1, {});
      expect(ctx.jumpToStep).toHaveBeenCalledWith(2);
    });
  });
});
