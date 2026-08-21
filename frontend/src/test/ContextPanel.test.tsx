import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import ContextPanel from "../components/workspace/ContextPanel";
import { ToastProvider } from "../hooks/useToast";

const {
  mockedGetConcept,
  mockedGetWorld,
  mockedGetCharacter,
  mockedGetOutline,
  mockedGetNovelOutline,
  mockedUpdateConcept,
  mockedUpdateWorld,
  mockedUpdateCharacter,
  mockedUpdateOutline,
  mockedUpdateNovelOutline,
  mockedGetDiagnosis,
  mockedRunDiagnosis,
} = vi.hoisted(() => ({
  mockedGetConcept: vi.fn(),
  mockedGetWorld: vi.fn(),
  mockedGetCharacter: vi.fn(),
  mockedGetOutline: vi.fn(),
  mockedGetNovelOutline: vi.fn(),
  mockedUpdateConcept: vi.fn(),
  mockedUpdateWorld: vi.fn(),
  mockedUpdateCharacter: vi.fn(),
  mockedUpdateOutline: vi.fn(),
  mockedUpdateNovelOutline: vi.fn(),
  mockedGetDiagnosis: vi.fn(),
  mockedRunDiagnosis: vi.fn(),
}));

vi.mock("../api/client", () => ({
  default: {
    getConcept: mockedGetConcept,
    getWorld: mockedGetWorld,
    getCharacter: mockedGetCharacter,
    getOutline: mockedGetOutline,
    getNovelOutline: mockedGetNovelOutline,
    updateConcept: mockedUpdateConcept,
    updateWorld: mockedUpdateWorld,
    updateCharacter: mockedUpdateCharacter,
    updateOutline: mockedUpdateOutline,
    updateNovelOutline: mockedUpdateNovelOutline,
    getDiagnosis: mockedGetDiagnosis,
    runDiagnosis: mockedRunDiagnosis,
  },
}));

function setupActivePanel(initialPath: string) {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route path="*" element={<ContextPanel projectId="p1" />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  mockedGetConcept.mockReset();
  mockedGetWorld.mockReset();
  mockedGetCharacter.mockReset();
  mockedGetOutline.mockReset();
  mockedGetNovelOutline.mockReset();
  mockedUpdateConcept.mockReset().mockResolvedValue(undefined);
  mockedUpdateWorld.mockReset().mockResolvedValue(undefined);
  mockedUpdateCharacter.mockReset().mockResolvedValue(undefined);
  mockedUpdateOutline.mockReset().mockResolvedValue(undefined);
  mockedUpdateNovelOutline.mockReset().mockResolvedValue(undefined);
  mockedGetDiagnosis.mockReset();
  mockedRunDiagnosis.mockReset();
  // sensible defaults — tests can override per-call
  mockedGetConcept.mockResolvedValue({ concept: null, story_dna: null });
  mockedGetWorld.mockResolvedValue({});
  mockedGetCharacter.mockResolvedValue({ characters: [] });
  mockedGetOutline.mockResolvedValue({ chapters: [] });
  mockedGetNovelOutline.mockResolvedValue({});
  // getDiagnosis returns 404-shaped fallback (null) by default — DiagnosisSummary
  // treats null as "no report yet" and shows the "运行诊断" button.
  mockedGetDiagnosis.mockRejectedValue(new Error("no diagnosis yet"));
  mockedRunDiagnosis.mockResolvedValue({
    project_id: "p1",
    total_chapters: 0,
    issues: [],
    summary: { p0_count: 0, p1_count: 0, p2_count: 0 },
  });
});

describe("ContextPanel", () => {
  it.each([
    "concept", "world", "character", "outline", "chapter-outline", "diagnosis", "export",
  ] as const)("renders %s tab active when ?panel=%s", async (panel) => {
    setupActivePanel(`/workspace?mode=manual&panel=${panel}`);
    expect(await screen.findByTestId(`context-tab-${panel}-active`)).toBeInTheDocument();
  });

  it("defaults to concept when ?panel= is missing", async () => {
    setupActivePanel(`/workspace?mode=manual`);
    expect(await screen.findByTestId("context-tab-concept-active")).toBeInTheDocument();
  });

  // Bug 3 fix — concept tab now shows the full editable form, with the
  // prefill's `title` populating the title input. The legacy preview-only
  // behavior is gone (no `context-preview-concept` testid anymore).
  it("concept tab renders editable form pre-filled from getConcept", async () => {
    mockedGetConcept.mockResolvedValueOnce({
      concept: {
        title: "末世之塔", genre: "xianxia", premise: "修真与灭世",
        tone: "悲壮", theme: "宿命", target_audience: "男频", style_template: "网文",
      },
      story_dna: {
        core_contradiction: { statement: "凡人 vs 天道", side_a: "凡人", side_b: "天道" },
        value_stack: [],
      },
    });
    setupActivePanel("/workspace?mode=manual&panel=concept");
    expect(await screen.findByTestId("concept-editor")).toBeInTheDocument();
    const titleInput = screen.getByTestId("concept-title") as HTMLInputElement;
    expect(titleInput.value).toBe("末世之塔");
    expect(screen.getByTestId("concept-premise")).toHaveTextContent("修真与灭世");
    // Data-bearing tabs no longer expose context-preview-* / context-link-*
    // (replaced by per-editor testids); only diagnosis/export keep the link.
    expect(screen.queryByTestId("context-preview-concept")).not.toBeInTheDocument();
    expect(screen.queryByTestId("context-link-concept")).not.toBeInTheDocument();
  });

  it("concept editor save calls api.updateConcept with the edited values", async () => {
    mockedGetConcept.mockResolvedValueOnce({
      concept: { title: "原标题", genre: "x", premise: "", tone: "", theme: "", target_audience: "", style_template: "" },
      story_dna: { core_contradiction: { statement: "", side_a: "", side_b: "" }, value_stack: [] },
    });
    setupActivePanel("/workspace?mode=manual&panel=concept");
    const titleInput = (await screen.findByTestId("concept-title")) as HTMLInputElement;
    fireEvent.change(titleInput, { target: { value: "新标题" } });
    fireEvent.click(screen.getByTestId("concept-editor-save"));
    await waitFor(() => expect(mockedUpdateConcept).toHaveBeenCalledTimes(1));
    const [, conceptArg] = mockedUpdateConcept.mock.calls[0];
    expect(conceptArg.title).toBe("新标题");
  });

  it("world editor renders power-system + factions pre-filled", async () => {
    mockedGetWorld.mockResolvedValueOnce({
      era: "修真纪元",
      geography: "九州",
      era_social_structure: "宗门林立",
      era_cultural_history: "万年大战",
      power_systems: [{ name: "灵气", description: "炼气化神", stages: ["炼气", "筑基", "金丹"], core_rules: ["灵根"], ceilings: ["化神"], cost_system: "寿元" }],
      factions: [{ name: "青云宗", type: "正派", goal: "守护苍生", relations: "中立" }],
      core_rules: ["不可逆转光阴"],
    });
    setupActivePanel("/workspace?mode=manual&panel=world");
    expect(await screen.findByTestId("world-editor")).toBeInTheDocument();
    expect((screen.getByTestId("world-era") as HTMLTextAreaElement).value).toBe("修真纪元");
    expect((screen.getByTestId("world-power-0-name") as HTMLInputElement).value).toBe("灵气");
    expect(screen.getByTestId("world-power-0-stages")).toHaveDisplayValue("炼气、筑基、金丹");
  });

  it("world editor — long-text fields are auto-grow textareas (no fixed rows, overflow-hidden)", async () => {
    // Bug: era / era_social_structure / era_cultural_history / power_systems[i].stages /
    // core_rules / ceilings / cost_system / world.core_rules / factions[i].goal /
    // factions[i].relations used to render as <input> (single-line), which clipped
    // multi-line content. They are now textareas with useAutoHeight.
    mockedGetWorld.mockResolvedValueOnce({
      era: "修真纪元",
      geography: "九州",
      era_social_structure: "宗门林立，凡人王朝依附于大宗门",
      era_cultural_history: "万年前灵气潮汐退潮后，修行界经历数次大战",
      power_systems: [{
        name: "灵气",
        description: "炼气化神",
        stages: ["炼气", "筑基", "金丹", "元婴"],
        core_rules: ["灵根唯一", "不可逆转光阴"],
        ceilings: ["化神"],
        cost_system: "寿元消耗",
      }],
      factions: [
        { name: "青云宗", type: "正派", goal: "守护苍生，抵御魔道", relations: "与正派交好，与魔道对立" },
      ],
      core_rules: ["不可逆转光阴", "天劫不可避"],
    });
    setupActivePanel("/workspace?mode=manual&panel=world");
    await screen.findByTestId("world-editor");

    const autoGrowIds = [
      "world-era",
      "world-social",
      "world-cultural",
      "world-power-0-stages",
      "world-power-0-rules",
      "world-power-0-ceilings",
      "world-power-0-cost",
      "world-core-rules",
      "world-faction-0-goal",
      "world-faction-0-relations",
    ];
    for (const id of autoGrowIds) {
      const ta = screen.queryByTestId(id) as HTMLTextAreaElement | null;
      expect(ta, `${id} should be a textarea, not an input`).not.toBeNull();
      expect(ta.tagName, `${id} tag should be TEXTAREA`).toBe("TEXTAREA");
      expect(ta.getAttribute("rows"), `${id} should not have a fixed rows attribute`).toBeNull();
      expect(ta.className, `${id} should have overflow-hidden`).toContain("overflow-hidden");
    }
    // Sanity — geography was already a textarea; still here.
    expect((screen.getByTestId("world-geography") as HTMLTextAreaElement).value).toBe("九州");
    // Sanity — short identifier fields stay as inputs.
    expect((screen.getByTestId("world-power-0-name") as HTMLInputElement).tagName).toBe("INPUT");
    expect(screen.queryByTestId("world-faction-0-name").tagName).toBe("INPUT");
  });

  it("world editor — chip-style textareas render array values joined by 、", async () => {
    // The string[] fields (stages / core_rules / ceilings / world.core_rules) are
    // joined with "、" on render and re-split on save. Switching them to
    // <textarea> must preserve that round-trip display.
    mockedGetWorld.mockResolvedValueOnce({
      era: "x", geography: "x",
      era_social_structure: null, era_cultural_history: null,
      power_systems: [{
        name: "灵气", description: "x",
        stages: ["炼气", "筑基"], core_rules: ["规则一"], ceilings: ["化神"],
        cost_system: "x",
      }],
      factions: [],
      core_rules: ["规则A", "规则B"],
    });
    setupActivePanel("/workspace?mode=manual&panel=world");
    const stages = (await screen.findByTestId("world-power-0-stages")) as HTMLTextAreaElement;
    expect(stages.value).toBe("炼气、筑基");
    const coreRules = (await screen.findByTestId("world-core-rules")) as HTMLTextAreaElement;
    expect(coreRules.value).toBe("规则A、规则B");
  });

  it("character editor lists each character as a collapsible card", async () => {
    mockedGetCharacter.mockResolvedValueOnce({
      characters: [
        {
          id: "c1", name: "林峰", is_core_character: true, character_type: "protagonist",
          personality: { beliefs: ["义"], desires: ["回家"], fears: ["孤独"], values: ["侠"], core_traits: ["机敏"] },
          current_state: { location: "", physical_condition: "", emotional: "", known_secrets: [] },
          voice_signature: { speech_style: "沉默", thought_patterns: "", taboos: [] },
          unknown_to_character: [], relations: {},
          growth_curve: null,
        },
      ],
      current: { id: "c1", name: "林峰" },
    });
    setupActivePanel("/workspace?mode=manual&panel=character");
    expect(await screen.findByTestId("character-editor")).toBeInTheDocument();
    expect((screen.getByTestId("character-0-name") as HTMLInputElement).value).toBe("林峰");
    expect((screen.getByTestId("character-0-role") as HTMLSelectElement).value).toBe("protagonist");
  });

  it("outline tab renders novel-level outline (theme + volumes + growth arc + plot points)", async () => {
    // v1.9 follow-up: the right-panel "大纲" tab shows novel_outline.json
    // (the high-level structure), not the per-chapter outline.
    mockedGetNovelOutline.mockResolvedValueOnce({
      core_conflict_theme: "凡人 vs 天道",
      volumes: [
        { name: "第一卷", chapter_range: "1-30", summary: "主角初入江湖", key_events: ["拜师", "初试"] },
        { name: "第二卷", chapter_range: "31-60", summary: "卷入纷争", key_events: ["对决"] },
      ],
      mc_growth_arc: [
        { label: "觉醒", target_chapter_range: "1-10", description: "意识到自己身世" },
      ],
      key_plot_points: [
        { title: "师父之死", must_appear_in_volume: "第一卷", trigger_chapter_hint: "约 25 章", description: "推动主角出山" },
      ],
      generated_at: "",
      updated_at: "",
    });
    setupActivePanel("/workspace?mode=manual&panel=outline");
    expect(await screen.findByTestId("novel-outline-editor")).toBeInTheDocument();
    expect(screen.getByTestId("novel-outline-theme")).toHaveTextContent("凡人 vs 天道");
    expect(screen.getByTestId("novel-outline-volume-0-name")).toHaveDisplayValue("第一卷");
    expect(screen.getByTestId("novel-outline-volume-1-range")).toHaveDisplayValue("31-60");
    expect(screen.getByTestId("novel-outline-mc-0-label")).toHaveDisplayValue("觉醒");
    expect(screen.getByTestId("novel-outline-plot-0-title")).toHaveDisplayValue("师父之死");
  });

  it("outline tab save calls api.updateNovelOutline (not updateOutline)", async () => {
    mockedGetNovelOutline.mockResolvedValueOnce({
      core_conflict_theme: "原主题",
      volumes: [],
      mc_growth_arc: [],
      key_plot_points: [],
      generated_at: "",
      updated_at: "",
    });
    setupActivePanel("/workspace?mode=manual&panel=outline");
    const theme = (await screen.findByTestId("novel-outline-theme")) as HTMLTextAreaElement;
    fireEvent.change(theme, { target: { value: "新主题" } });
    fireEvent.click(screen.getByTestId("novel-outline-editor-save"));
    await waitFor(() => expect(mockedUpdateNovelOutline).toHaveBeenCalledTimes(1));
    const [, novelArg] = mockedUpdateNovelOutline.mock.calls[0];
    expect(novelArg.core_conflict_theme).toBe("新主题");
  });

  it("chapter-outline tab mounts ChapterOutlineEditor and pre-fills from getOutline", async () => {
    mockedGetOutline.mockResolvedValueOnce({
      chapters: [
        { chapter_number: 1, title: "第一章", theme: "觉醒",
          scene_plan: [{ scene_number: 1, goal: "g", conflict: "c", emotional_arc: "a", narrative_role: "setup", beat_type: "inciting", registry_changes: { created: [], updated: [] }, required_logs: [] }] },
        { chapter_number: 2, title: "第二章", theme: "磨炼",
          scene_plan: [{ scene_number: 1, goal: "g", conflict: "c", emotional_arc: "a", narrative_role: "mini_payoff", beat_type: "rising", registry_changes: { created: [], updated: [] }, required_logs: [] }] },
      ],
    });
    setupActivePanel("/workspace?mode=manual&panel=chapter-outline");
    expect(await screen.findByTestId("chapter-outline-editor")).toBeInTheDocument();
    expect(screen.getByTestId("chapter-row-1")).toBeInTheDocument();
    expect(screen.getByTestId("chapter-row-2")).toBeInTheDocument();
    expect((screen.getByTestId("chapter-1-title") as HTMLInputElement).value).toBe("第一章");
  });

  it("chapter-outline tab save calls api.updateOutline with the edited outline", async () => {
    mockedGetOutline.mockResolvedValueOnce({
      chapters: [
        { chapter_number: 1, title: "原标题", theme: "原主题",
          scene_plan: [{ scene_number: 1, goal: "", conflict: "", emotional_arc: "", narrative_role: "setup", beat_type: "", registry_changes: { created: [], updated: [] }, required_logs: [] }] },
      ],
    });
    setupActivePanel("/workspace?mode=manual&panel=chapter-outline");
    const titleInput = (await screen.findByTestId("chapter-1-title")) as HTMLInputElement;
    fireEvent.change(titleInput, { target: { value: "新标题" } });
    fireEvent.click(screen.getByTestId("chapter-outline-editor-save"));
    await waitFor(() => expect(mockedUpdateOutline).toHaveBeenCalledTimes(1));
    const [projectIdArg, outlineArg] = mockedUpdateOutline.mock.calls[0];
    expect(projectIdArg).toBe("p1");
    expect(outlineArg.chapters[0].title).toBe("新标题");
  });

  it("diagnosis tab shows project context + '运行诊断' button + Stage5 link when no report exists", async () => {
    // Outline has 2 chapters → context shows "已规划 2 章", button is enabled.
    mockedGetOutline.mockResolvedValueOnce({
      chapters: [
        { chapter_number: 1, title: "a", scene_plan: [{ scene_number: 1 }] },
        { chapter_number: 2, title: "b", scene_plan: [{ scene_number: 1 }] },
      ],
    });
    setupActivePanel("/workspace?mode=manual&panel=diagnosis");
    expect(await screen.findByTestId("diagnosis-summary")).toBeInTheDocument();
    expect(screen.getByTestId("diagnosis-context")).toHaveTextContent("已规划 2 章");
    const run = screen.getByTestId("diagnosis-run");
    expect(run).toBeInTheDocument();
    expect(run).not.toBeDisabled();
    expect(screen.getByTestId("diagnosis-link").getAttribute("href"))
      .toBe("/project/p1/stage5");
  });

  it("diagnosis '运行诊断' button is disabled when no chapters exist", async () => {
    // Default mock has empty outline + no novel_outline → chapterCount=0,
    // plannedTotal=0 → button disabled.
    setupActivePanel("/workspace?mode=manual&panel=diagnosis");
    const run = await screen.findByTestId("diagnosis-run");
    expect(run).toBeDisabled();
    expect(screen.getByTestId("diagnosis-context")).toHaveTextContent("尚未生成章节大纲");
  });

  it("diagnosis tab shows stats + open issues when a report is returned", async () => {
    mockedGetDiagnosis.mockResolvedValueOnce({
      project_id: "p1",
      total_chapters: 30,
      summary: { p0_count: 1, p1_count: 2, p2_count: 3 },
      issues: [
        { id: "iss-1", priority: "P0", category: "时间线", chapter: 5, description: "时间穿越未声明", suggestion: "添加 SF_LOG knowledge_gain", asset_id: "char-x", status: "open" },
        { id: "iss-2", priority: "P1", category: "角色状态", chapter: 8, description: "师父已死亡却仍出现", suggestion: "改写该场景", asset_id: "char-master", status: "open" },
      ],
    });
    setupActivePanel("/workspace?mode=manual&panel=diagnosis");
    expect(await screen.findByTestId("diagnosis-stats")).toBeInTheDocument();
    expect(screen.getByTestId("diagnosis-stats").textContent).toContain("1"); // P0
    expect(screen.getByTestId("diagnosis-stats").textContent).toContain("2"); // P1
    expect(screen.getByTestId("diagnosis-stats").textContent).toContain("3"); // P2
    expect(screen.getByTestId("diagnosis-issue-iss-1")).toHaveTextContent("时间穿越未声明");
    // re-run button + Stage5 link still present
    expect(screen.getByTestId("diagnosis-rerun")).toBeInTheDocument();
    expect(screen.getByTestId("diagnosis-link").getAttribute("href")).toBe("/project/p1/stage5");
  });

  it("diagnosis '运行诊断' button calls api.runDiagnosis (requires chapters)", async () => {
    // Need ≥1 chapter for the run button to be enabled.
    mockedGetOutline.mockResolvedValueOnce({
      chapters: [{ chapter_number: 1, title: "a", scene_plan: [{ scene_number: 1 }] }],
    });
    setupActivePanel("/workspace?mode=manual&panel=diagnosis");
    const run = await screen.findByTestId("diagnosis-run");
    expect(run).not.toBeDisabled();
    fireEvent.click(run);
    await waitFor(() => expect(mockedRunDiagnosis).toHaveBeenCalledWith("p1"));
  });

  it("export tab shows chapter + scene counts + Stage6 link", async () => {
    mockedGetOutline.mockResolvedValueOnce({
      chapters: [
        { chapter_number: 1, title: "第一章", scene_plan: [{ scene_number: 1 }, { scene_number: 2 }, { scene_number: 3 }] },
        { chapter_number: 2, title: "第二章", scene_plan: [{ scene_number: 1 }, { scene_number: 2 }] },
      ],
    });
    setupActivePanel("/workspace?mode=manual&panel=export");
    expect(await screen.findByTestId("export-summary")).toBeInTheDocument();
    const stats = screen.getByTestId("export-stats");
    expect(stats.textContent).toContain("2"); // 2 chapters
    expect(stats.textContent).toContain("5"); // 3 + 2 scenes
    expect(screen.getByTestId("export-link").getAttribute("href")).toBe("/project/p1/stage6");
  });

  describe("readOnly mode", () => {
    it("shows a read-only banner with the supplied reason", async () => {
      // Switch to a tab that uses an editor (concept).
      mockedGetConcept.mockResolvedValue({ title: "测试", logline: "" });
      render(
        <ToastProvider>
          <MemoryRouter initialEntries={["/?panel=concept"]}>
            <ContextPanel projectId="p" readOnly readOnlyReason="托管运行中" />
          </MemoryRouter>
        </ToastProvider>,
      );
      await waitFor(() => screen.getByTestId("context-readonly-banner"));
      expect(screen.getByTestId("context-readonly-banner")).toHaveTextContent("托管运行中");
    });

    it("disables save button in editors when readOnly", async () => {
      mockedGetConcept.mockResolvedValue({ title: "x", logline: "y" });
      render(
        <ToastProvider>
          <MemoryRouter initialEntries={["/?panel=concept"]}>
            <ContextPanel projectId="p" readOnly readOnlyReason="测试" />
          </MemoryRouter>
        </ToastProvider>,
      );
      // Wait for the editor to mount, then check the save button is disabled.
      const save = await screen.findByTestId("concept-editor-save");
      expect(save).toBeDisabled();
    });
  });

  // Regression: the right-panel concept/world/character/outline editors used
  // to render textareas with `rows={N}` + `resize-y`, which fixed the box
  // height regardless of content length. Now they auto-grow to scrollHeight,
  // so the box height follows the typed-in text. The visible signal:
  //   - no `rows` attribute on the rendered <textarea>
  //   - inline style.height is set by useAutoHeight (a non-empty Npx value)
  //   - the overflow-hidden class is applied (we don't want a nested
  //     scrollbar inside the auto-grown box).
  describe("auto-grow textareas (right-panel height follows content)", () => {
    function stubLayout(textarea: HTMLElement, scrollHeight: number) {
      Object.defineProperty(textarea, "scrollHeight", {
        configurable: true,
        get: () => scrollHeight,
      });
    }

    it("concept premise textarea grows to scrollHeight (no fixed rows)", async () => {
      mockedGetConcept.mockResolvedValueOnce({
        concept: { title: "x", genre: "x", premise: "短", tone: "x", theme: "x", target_audience: "x", style_template: "x" },
        story_dna: { core_contradiction: { statement: "x", side_a: "x", side_b: "x" }, value_stack: [] },
      });
      setupActivePanel("/workspace?mode=manual&panel=concept");
      const premise = (await screen.findByTestId("concept-premise")) as HTMLTextAreaElement;
      expect(premise.getAttribute("rows")).toBeNull();
      stubLayout(premise, 96);
      // Type more content → hook re-measures with stubbed scrollHeight.
      fireEvent.change(premise, { target: { value: premise.value + "追加内容" } });
      expect(premise.style.height).toBe("96px");
      expect(premise.className).toContain("overflow-hidden");
    });

    it("world geography textarea has no fixed rows and is overflow-hidden", async () => {
      mockedGetWorld.mockResolvedValueOnce({
        era: "x", geography: "九州",
        era_social_structure: null, era_cultural_history: null,
        power_systems: [{ name: "灵气", description: "x", stages: [], core_rules: [], ceilings: [], cost_system: "" }],
        factions: [], core_rules: [],
      });
      setupActivePanel("/workspace?mode=manual&panel=world");
      const geo = (await screen.findByTestId("world-geography")) as HTMLTextAreaElement;
      expect(geo.getAttribute("rows")).toBeNull();
      expect(geo.className).toContain("overflow-hidden");
    });

    it("novel-outline theme textarea grows to scrollHeight", async () => {
      mockedGetNovelOutline.mockResolvedValueOnce({
        core_conflict_theme: "凡人 vs 天道",
        volumes: [], mc_growth_arc: [], key_plot_points: [],
        generated_at: "", updated_at: "",
      });
      setupActivePanel("/workspace?mode=manual&panel=outline");
      const theme = (await screen.findByTestId("novel-outline-theme")) as HTMLTextAreaElement;
      expect(theme.getAttribute("rows")).toBeNull();
      stubLayout(theme, 144);
      fireEvent.change(theme, { target: { value: theme.value + " 再展开" } });
      expect(theme.style.height).toBe("144px");
      expect(theme.className).toContain("overflow-hidden");
    });

    it("character voice_signature textareas (per-character) auto-grow", async () => {
      mockedGetCharacter.mockResolvedValueOnce({
        characters: [
          {
            id: "c1", name: "林峰", is_core_character: true, character_type: "protagonist",
            personality: { beliefs: [], desires: [], fears: [], values: [], core_traits: [] },
            current_state: { location: "", physical_condition: "", emotional: "", known_secrets: [] },
            voice_signature: { speech_style: "简短", thought_patterns: "", taboos: [] },
            unknown_to_character: [], relations: {},
            growth_curve: null,
          },
        ],
        current: { id: "c1", name: "林峰" },
      });
      setupActivePanel("/workspace?mode=manual&panel=character");
      await screen.findByTestId("character-editor");
      // Find both textareas (speech_style + thought_patterns) — neither has rows.
      const textareas = document.querySelectorAll("textarea") as NodeListOf<HTMLTextAreaElement>;
      const voiceAreas = Array.from(textareas).filter(
        (t) => t.getAttribute("rows") === null && t.className.includes("overflow-hidden"),
      );
      expect(voiceAreas.length).toBeGreaterThanOrEqual(2);
      for (const ta of voiceAreas) {
        expect(ta.getAttribute("rows")).toBeNull();
        expect(ta.className).toContain("overflow-hidden");
      }
    });

    it("volume summary textarea auto-grows", async () => {
      mockedGetNovelOutline.mockResolvedValueOnce({
        core_conflict_theme: "x",
        volumes: [{ name: "v1", chapter_range: "1-30", summary: "s", key_events: ["e1"] }],
        mc_growth_arc: [], key_plot_points: [],
        generated_at: "", updated_at: "",
      });
      setupActivePanel("/workspace?mode=manual&panel=outline");
      const summary = (await screen.findByTestId("novel-outline-volume-0-summary")) as HTMLTextAreaElement;
      expect(summary.getAttribute("rows")).toBeNull();
      stubLayout(summary, 72);
      fireEvent.change(summary, { target: { value: summary.value + " 补全概要" } });
      expect(summary.style.height).toBe("72px");
      expect(summary.className).toContain("overflow-hidden");
    });

    it("volume key_events chip-textarea auto-grows and renders array joined by 、", async () => {
      // Bug: novel-outline-volume-{i}-events used to render as <input>
      // (single-line), which clipped multi-line chip content. It is now
      // an auto-grow textarea that still joins the string[] with "、".
      mockedGetNovelOutline.mockResolvedValueOnce({
        core_conflict_theme: "x",
        volumes: [{ name: "v1", chapter_range: "1-30", summary: "s", key_events: ["入门", "初试", "对决"] }],
        mc_growth_arc: [], key_plot_points: [],
        generated_at: "", updated_at: "",
      });
      setupActivePanel("/workspace?mode=manual&panel=outline");
      const events = (await screen.findByTestId("novel-outline-volume-0-events")) as HTMLTextAreaElement;
      expect(events.tagName).toBe("TEXTAREA");
      expect(events.getAttribute("rows")).toBeNull();
      expect(events.className).toContain("overflow-hidden");
      expect(events.value).toBe("入门、初试、对决");
      stubLayout(events, 60);
      fireEvent.change(events, { target: { value: events.value + "、反转" } });
      expect(events.style.height).toBe("60px");
    });
  });
});
