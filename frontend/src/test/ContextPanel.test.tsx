import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import ContextPanel from "../components/workspace/ContextPanel";

const {
  mockedGetConcept,
  mockedGetWorld,
  mockedGetCharacter,
  mockedGetOutline,
  mockedUpdateConcept,
  mockedUpdateWorld,
  mockedUpdateCharacter,
  mockedUpdateOutline,
  mockedGetDiagnosis,
  mockedRunDiagnosis,
} = vi.hoisted(() => ({
  mockedGetConcept: vi.fn(),
  mockedGetWorld: vi.fn(),
  mockedGetCharacter: vi.fn(),
  mockedGetOutline: vi.fn(),
  mockedUpdateConcept: vi.fn(),
  mockedUpdateWorld: vi.fn(),
  mockedUpdateCharacter: vi.fn(),
  mockedUpdateOutline: vi.fn(),
  mockedGetDiagnosis: vi.fn(),
  mockedRunDiagnosis: vi.fn(),
}));

vi.mock("../api/client", () => ({
  default: {
    getConcept: mockedGetConcept,
    getWorld: mockedGetWorld,
    getCharacter: mockedGetCharacter,
    getOutline: mockedGetOutline,
    updateConcept: mockedUpdateConcept,
    updateWorld: mockedUpdateWorld,
    updateCharacter: mockedUpdateCharacter,
    updateOutline: mockedUpdateOutline,
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
  mockedUpdateConcept.mockReset().mockResolvedValue(undefined);
  mockedUpdateWorld.mockReset().mockResolvedValue(undefined);
  mockedUpdateCharacter.mockReset().mockResolvedValue(undefined);
  mockedUpdateOutline.mockReset().mockResolvedValue(undefined);
  mockedGetDiagnosis.mockReset();
  mockedRunDiagnosis.mockReset();
  // sensible defaults — tests can override per-call
  mockedGetConcept.mockResolvedValue({ concept: null, story_dna: null });
  mockedGetWorld.mockResolvedValue({});
  mockedGetCharacter.mockResolvedValue({ characters: [] });
  mockedGetOutline.mockResolvedValue({ chapters: [] });
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
    "concept", "world", "character", "outline", "diagnosis", "export",
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
      power_system: { name: "灵气", description: "炼气化神", stages: ["炼气", "筑基", "金丹"], core_rules: ["灵根"], ceilings: ["化神"], cost_system: "寿元" },
      factions: [{ name: "青云宗", type: "正派", goal: "守护苍生", relations: "中立" }],
      core_rules: ["不可逆转光阴"],
    });
    setupActivePanel("/workspace?mode=manual&panel=world");
    expect(await screen.findByTestId("world-editor")).toBeInTheDocument();
    expect((screen.getByTestId("world-era") as HTMLInputElement).value).toBe("修真纪元");
    expect((screen.getByTestId("world-power-name") as HTMLInputElement).value).toBe("灵气");
    expect(screen.getByTestId("world-power-stages")).toHaveDisplayValue("炼气、筑基、金丹");
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

  it("outline editor renders editable chapter titles", async () => {
    mockedGetOutline.mockResolvedValueOnce({
      chapters: [
        { chapter_number: 1, title: "开篇", scene_plan: [{ scene_number: 1 }] },
        { chapter_number: 2, title: "冲突", scene_plan: [{ scene_number: 1 }] },
      ],
    });
    setupActivePanel("/workspace?mode=manual&panel=outline");
    expect(await screen.findByTestId("outline-editor")).toBeInTheDocument();
    const title1 = screen.getByTestId("outline-editor-chapter-1-title") as HTMLInputElement;
    expect(title1.value).toBe("开篇");
    fireEvent.change(title1, { target: { value: "新的开篇" } });
    fireEvent.click(screen.getByTestId("outline-editor-save"));
    await waitFor(() => expect(mockedUpdateOutline).toHaveBeenCalledTimes(1));
    const [, outlineArg] = mockedUpdateOutline.mock.calls[0];
    expect(outlineArg.chapters[0].title).toBe("新的开篇");
  });

  it("diagnosis tab shows a '运行诊断' button + Stage5 link when no report exists", async () => {
    setupActivePanel("/workspace?mode=manual&panel=diagnosis");
    expect(await screen.findByTestId("diagnosis-summary")).toBeInTheDocument();
    expect(screen.getByTestId("diagnosis-run")).toBeInTheDocument();
    expect(screen.getByTestId("diagnosis-link").getAttribute("href"))
      .toBe("/project/p1/stage5");
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

  it("diagnosis '重新诊断' button calls api.runDiagnosis and refreshes the panel", async () => {
    setupActivePanel("/workspace?mode=manual&panel=diagnosis");
    await screen.findByTestId("diagnosis-run");
    fireEvent.click(screen.getByTestId("diagnosis-run"));
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
});
