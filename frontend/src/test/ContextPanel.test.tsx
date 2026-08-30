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
    <ToastProvider>
      <MemoryRouter initialEntries={[initialPath]}>
        <Routes>
          <Route path="*" element={<ContextPanel projectId="p1" />} />
        </Routes>
      </MemoryRouter>
    </ToastProvider>,
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
  // ContextPanel now only surfaces 诊断 + 导出 tabs. The five editor tabs
  // (concept/world/character/outline/chapter-outline) moved to the wizard's
  // 项目设定 tab (Plan Task 13, 2026-08-30-workspace-wizard.md).

  it.each([
    "diagnosis", "export",
  ] as const)("renders %s tab active when ?panel=%s", async (panel) => {
    setupActivePanel(`/workspace?mode=manual&panel=${panel}`);
    expect(await screen.findByTestId(`context-tab-${panel}-active`)).toBeInTheDocument();
  });

  it("only renders 诊断 and 导出 tabs (editor tabs moved to wizard)", async () => {
    setupActivePanel("/workspace?mode=manual&panel=diagnosis");
    expect(screen.getByTestId("context-tab-diagnosis-active")).toBeInTheDocument();
    expect(screen.getByTestId("context-tab-export")).toBeInTheDocument();
    for (const removed of ["concept", "world", "character", "outline", "chapter-outline"]) {
      expect(screen.queryByTestId(`context-tab-${removed}`)).not.toBeInTheDocument();
    }
  });

  it("with ?panel= missing, no tab is highlighted (legacy 'concept' default has no rendered tab)", async () => {
    // useWorkspacePanel still defaults to "concept" when ?panel= is absent.
    // Since "concept" is no longer a TAB_LABEL key, no tab button carries the
    // -active testid — the body falls through to DiagnosisSummary instead.
    setupActivePanel("/workspace?mode=manual");
    expect(await screen.findByTestId("diagnosis-summary")).toBeInTheDocument();
    expect(screen.queryByTestId("context-tab-diagnosis-active")).not.toBeInTheDocument();
    expect(screen.queryByTestId("context-tab-export-active")).not.toBeInTheDocument();
  });

  it("falls back to diagnosis body when ?panel= references a removed tab", async () => {
    // Legacy bookmark / deep link with a panel value that no longer renders
    // any tab — body should resolve to DiagnosisSummary instead of crashing.
    setupActivePanel("/workspace?mode=manual&panel=concept");
    expect(await screen.findByTestId("diagnosis-summary")).toBeInTheDocument();
    // No concept tab button is rendered.
    expect(screen.queryByTestId("context-tab-concept")).not.toBeInTheDocument();
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

  it("export tab renders when no chapters exist (no crash)", async () => {
    setupActivePanel("/workspace?mode=manual&panel=export");
    expect(await screen.findByTestId("export-summary")).toBeInTheDocument();
    expect(screen.getByTestId("export-link").getAttribute("href")).toBe("/project/p1/stage6");
  });

  describe("readOnly mode", () => {
    it("shows a read-only banner with the supplied reason", async () => {
      render(
        <ToastProvider>
          <MemoryRouter initialEntries={["/?panel=diagnosis"]}>
            <ContextPanel projectId="p" readOnly readOnlyReason="托管运行中" />
          </MemoryRouter>
        </ToastProvider>,
      );
      await waitFor(() => screen.getByTestId("context-readonly-banner"));
      expect(screen.getByTestId("context-readonly-banner")).toHaveTextContent("托管运行中");
    });

    it("does not render the banner when readOnlyReason is missing", async () => {
      render(
        <ToastProvider>
          <MemoryRouter initialEntries={["/?panel=diagnosis"]}>
            <ContextPanel projectId="p" readOnly />
          </MemoryRouter>
        </ToastProvider>,
      );
      await screen.findByTestId("diagnosis-summary");
      expect(screen.queryByTestId("context-readonly-banner")).not.toBeInTheDocument();
    });
  });
});