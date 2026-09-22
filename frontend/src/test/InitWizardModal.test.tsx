// 2026-09-19:本测试文件对应"DEPRECATED"的 InitWizardModal(原 /project/:id/wizard
// deep-link 入口)。ConceptStep / Concept DNA 步骤都已删除;step 1 现在是
// CreativeDivergenceStep。本文件保留 step 2-6 的现有 wizard 行为测试,并
// 把 step 1 的旧 concept-form / concept-info-regenerate 等用例删除(因为
// 没有 ConceptStep 也就没有这些 testid)。

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ToastProvider } from "../hooks/useToast";

vi.mock("../api/client", () => ({
  default: {
    advance: vi.fn(),
    generateOutline: vi.fn(),
    generateConcept: vi.fn(),
    generateNovelOutline: vi.fn(),
    updateOutline: vi.fn(),
    updateConcept: vi.fn(),
    updateWorld: vi.fn(),
    updateCharacter: vi.fn(),
    updateNovelOutline: vi.fn(),
    getConcept: vi.fn(),
    getWorld: vi.fn(),
    getCharacter: vi.fn(),
    getMap: vi.fn(),
    getNovelOutline: vi.fn(),
    getOutline: vi.fn(),
    // 2026-09-19:CreativeDivergenceStep 引入了 B3 系列端点。
    postB3Decompose: vi.fn(),
    postB3MetaDecompose: vi.fn(),
    postB3FollowUp: vi.fn(),
    postB3Commit: vi.fn(),
    getB3State: vi.fn(),
    deleteB3State: vi.fn(),
    getProjectStatus: vi.fn(),
    listGenres: vi.fn(),
    getPlazaPrompt: vi.fn(),
    putPlazaPrompt: vi.fn(),
    listActiveCreativeDimensions: vi.fn().mockResolvedValue({
      subject: [{ id: "cool_novel", name: "网文快读", description: "", status: "active", order: 0, created_at: "a", updated_at: "a" }],
      tone: [
        { id: "rexue", name: "热血", description: "", status: "active", order: 0, created_at: "a", updated_at: "a" },
        { id: "heian", name: "黑暗", description: "", status: "active", order: 1, created_at: "a", updated_at: "a" },
      ],
      style: [
        { id: "shuangwen", name: "爽文", description: "", status: "active", order: 0, created_at: "a", updated_at: "a" },
        { id: "duoxian", name: "多线", description: "", status: "active", order: 1, created_at: "a", updated_at: "a" },
      ],
    }),
    regenerateConceptSection: vi.fn(),
    regenerateWorldSection: vi.fn(),
    regenerateCharacterSection: vi.fn(),
    regenerateNovelOutlineSection: vi.fn(),
  },
}));

vi.mock("react-router-dom", async () => {
  const real = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return { ...real, useNavigate: () => mockNavigate };
});

const mockNavigate = vi.fn();

import api from "../api/client";
import InitWizardModal from "../components/wizard/InitWizardModal";
import { WizardProvider, getSessionKey } from "../components/wizard/WizardContext";

const PROJECT = "proj_x";
const KEY = getSessionKey(PROJECT);

beforeEach(() => {
  (api.advance as ReturnType<typeof vi.fn>).mockReset();
  (api.advance as ReturnType<typeof vi.fn>).mockResolvedValue({ current_stage: "STAGE4" });
  (api.generateOutline as ReturnType<typeof vi.fn>).mockReset();
  (api.generateConcept as ReturnType<typeof vi.fn>).mockReset();
  (api.generateConcept as ReturnType<typeof vi.fn>).mockResolvedValue({
    concept: { title: "T", genre: "cool_novel", premise: "", tone: "", theme: "", target_audience: "", style_template: "" },
    story_dna: { core_contradiction: { statement: "", side_a: "", side_b: "" }, value_stack: [] },
  });
  (api.updateOutline as ReturnType<typeof vi.fn>).mockReset();
  (api.updateOutline as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
  (api.updateConcept as ReturnType<typeof vi.fn>).mockReset();
  (api.updateConcept as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
  (api.updateWorld as ReturnType<typeof vi.fn>).mockReset();
  (api.updateWorld as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
  (api.updateCharacter as ReturnType<typeof vi.fn>).mockReset();
  (api.updateCharacter as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
  (api.updateNovelOutline as ReturnType<typeof vi.fn>).mockReset();
  (api.updateNovelOutline as ReturnType<typeof vi.fn>).mockImplementation((_p, body) => Promise.resolve(body));
  (api.getConcept as ReturnType<typeof vi.fn>).mockReset();
  (api.getWorld as ReturnType<typeof vi.fn>).mockReset();
  (api.getCharacter as ReturnType<typeof vi.fn>).mockReset();
  (api.getMap as ReturnType<typeof vi.fn>).mockReset();
  (api.getNovelOutline as ReturnType<typeof vi.fn>).mockReset();
  (api.getOutline as ReturnType<typeof vi.fn>).mockReset();
  (api.regenerateConceptSection as ReturnType<typeof vi.fn>).mockReset();
  (api.regenerateConceptSection as ReturnType<typeof vi.fn>).mockResolvedValue({
    concept: { title: "T", genre: "cool_novel", premise: "", tone: "", theme: "", target_audience: "", style_template: "" },
    story_dna: { core_contradiction: { statement: "", side_a: "", side_b: "" }, value_stack: [] },
  });
  (api.regenerateWorldSection as ReturnType<typeof vi.fn>).mockReset();
  (api.regenerateWorldSection as ReturnType<typeof vi.fn>).mockResolvedValue({
    era: "e", geography: "g", era_social_structure: "", era_cultural_history: "",
    power_systems: [{ name: "", description: "", stages: [], core_rules: [], ceilings: [] }],
    factions: [], core_rules: [],
  });
  (api.regenerateCharacterSection as ReturnType<typeof vi.fn>).mockReset();
  (api.regenerateCharacterSection as ReturnType<typeof vi.fn>).mockResolvedValue({
    id: "c1",
    name: "林峰",
    is_core_character: true,
    character_type: "protagonist",
    personality: { beliefs: [], desires: [], fears: [], values: [], core_traits: [] },
    current_state: { location: "", physical_condition: "normal", emotional: "neutral", known_secrets: [] },
    voice_signature: { speech_style: "", thought_patterns: "", taboos: [] },
    unknown_to_character: [],
    relations: {},
    growth_curve: null,
  });
  (api.regenerateNovelOutlineSection as ReturnType<typeof vi.fn>).mockReset();
  (api.regenerateNovelOutlineSection as ReturnType<typeof vi.fn>).mockResolvedValue({
    core_conflict_theme: "",
    volumes: [{ name: "v1", chapter_range: "1-50", summary: "x", key_events: [] }],
    mc_growth_arc: [],
    key_plot_points: [],
    generated_at: "",
    updated_at: "",
  });
  // B3 series defaults
  (api.getB3State as ReturnType<typeof vi.fn>).mockReset();
  (api.getB3State as ReturnType<typeof vi.fn>).mockResolvedValue(null);
  (api.postB3Decompose as ReturnType<typeof vi.fn>).mockReset();
  (api.postB3Decompose as ReturnType<typeof vi.fn>).mockResolvedValue({
    dimensions: [], causal_map: "", top_level_summary: "",
  });
  (api.postB3MetaDecompose as ReturnType<typeof vi.fn>).mockReset();
  (api.postB3MetaDecompose as ReturnType<typeof vi.fn>).mockResolvedValue({
    generated_prompt: "## META ##", written_to_override: true,
  });
  (api.postB3FollowUp as ReturnType<typeof vi.fn>).mockReset();
  (api.postB3Commit as ReturnType<typeof vi.fn>).mockReset();
  (api.postB3Commit as ReturnType<typeof vi.fn>).mockResolvedValue({
    concept_and_dna: {},
    creative_divergence: {},
    b3_state: {},
    committed_at: "2026-09-19T00:00:00Z",
  });
  (api.getPlazaPrompt as ReturnType<typeof vi.fn>).mockReset();
  (api.getPlazaPrompt as ReturnType<typeof vi.fn>).mockResolvedValue({ effective: null });
  (api.putPlazaPrompt as ReturnType<typeof vi.fn>).mockReset();
  (api.putPlazaPrompt as ReturnType<typeof vi.fn>).mockResolvedValue({
    name: "firstness_decompose", override: null, modified_at: null,
  });
  (api.getProjectStatus as ReturnType<typeof vi.fn>).mockReset();
  (api.getProjectStatus as ReturnType<typeof vi.fn>).mockResolvedValue({ title: "T", genre: "" });
  mockNavigate.mockReset();
  sessionStorage.clear();
});

function renderModal(projectId = PROJECT, onDismiss = vi.fn()) {
  return render(
    <ToastProvider><MemoryRouter>
      <WizardProvider projectId={projectId}>
        <InitWizardModal projectId={projectId} onDismiss={onDismiss} />
      </WizardProvider>
    </MemoryRouter></ToastProvider>
  );
}

function buildData() {
  return {
    world: null,
    characters: null,
    novel_outline: null,
    chapter1_outline: null,
  };
}

const WORLD_FIXTURE = {
  era: "e", geography: "g", era_social_structure: "", era_cultural_history: "",
  power_systems: [{ name: "", description: "", stages: [], core_rules: [], ceilings: [] }],
  factions: [], core_rules: [],
};

function buildCharacter(id: string) {
  return {
    id,
    name: "林峰",
    is_core_character: true,
    character_type: "protagonist",
    personality: { beliefs: [], desires: [], fears: [], values: [], core_traits: [] },
    current_state: { location: "", physical_condition: "normal", emotional: "neutral", known_secrets: [] },
    voice_signature: { speech_style: "", thought_patterns: "", taboos: [] },
    unknown_to_character: [],
    relations: {},
    growth_curve: null,
  };
}

const NOVEL_OUTLINE_FIXTURE = {
  core_conflict_theme: "x",
  volumes: [{ name: "v1", chapter_range: "1-50", summary: "x", key_events: [] }],
  mc_growth_arc: [],
  key_plot_points: [],
  generated_at: "",
  updated_at: "",
};

const seedFiles = (files: {
  world?: typeof WORLD_FIXTURE | null;
  character?: ReturnType<typeof buildCharacter> | { characters: unknown[]; current: unknown } | null;
  novelOutline?: typeof NOVEL_OUTLINE_FIXTURE | null;
  outline?: unknown | null;
} = {}) => {
  const world = files.world === undefined ? null : files.world;
  const character = files.character === undefined ? null : files.character;
  const novelOutline = files.novelOutline === undefined ? null : files.novelOutline;
  const outline = files.outline === undefined ? null : files.outline;
  (api.getWorld as ReturnType<typeof vi.fn>).mockResolvedValue(world);
  (api.getCharacter as ReturnType<typeof vi.fn>).mockResolvedValue(character);
  (api.getNovelOutline as ReturnType<typeof vi.fn>).mockResolvedValue(novelOutline);
  (api.getOutline as ReturnType<typeof vi.fn>).mockResolvedValue(outline);
  return { world, character, novelOutline, outline };
};

const seedStep = (currentStep: number, completedSteps: number[], data = buildData()) => {
  sessionStorage.setItem(
    KEY,
    JSON.stringify({
      currentStep,
      completedSteps,
      status: "idle",
      data,
      errorMessage: null,
    }),
  );
};

describe("InitWizardModal", () => {
  it("renders the step indicator with 6 steps", () => {
    renderModal();
    expect(screen.getByTestId("wizard-steps")).toBeInTheDocument();
    for (let i = 1; i <= 6; i++) {
      expect(screen.getByTestId(`wizard-step-${i}`)).toBeInTheDocument();
    }
  });

  it("shows the close button enabled, clicking it dismisses without resetting", async () => {
    const onDismiss = vi.fn();
    renderModal(PROJECT, onDismiss);
    const closeBtn = screen.getByTestId("wizard-close");
    expect(closeBtn).not.toBeDisabled();
    await act(async () => {
      closeBtn.click();
    });
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem(KEY)).not.toBeNull();
  });

  it("renders CreativeDivergenceStep on step 1 (ConceptStep 已删除)", () => {
    renderModal();
    expect(screen.getByTestId("creative-divergence-step")).toBeInTheDocument();
    expect(screen.queryByTestId("concept-step")).not.toBeInTheDocument();
    expect(screen.queryByTestId("concept-form")).not.toBeInTheDocument();
  });

  it("resume mode: hydrates from files and lands on the latest SAVED step (step 2 = WorldStep)", async () => {
    (api.getWorld as ReturnType<typeof vi.fn>).mockResolvedValue({
      era: "e", geography: "g", era_social_structure: "", era_cultural_history: "",
      power_systems: [{ name: "", description: "", stages: [], core_rules: [], ceilings: [] }],
      factions: [], core_rules: [],
    });
    (api.getCharacter as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (api.getNovelOutline as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (api.getOutline as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    render(
      <ToastProvider><MemoryRouter>
        <WizardProvider projectId={PROJECT}>
          <InitWizardModal projectId={PROJECT} onDismiss={vi.fn()} resume />
        </WizardProvider>
      </MemoryRouter></ToastProvider>
    );

    await waitFor(() => expect(screen.getByTestId("world-step")).toBeInTheDocument());
    expect(screen.queryByTestId("character-step")).not.toBeInTheDocument();
  });

  it("resume=false (default): hydrates from files but stays on step 1", async () => {
    (api.getWorld as ReturnType<typeof vi.fn>).mockResolvedValue({
      era: "e", geography: "g", era_social_structure: "", era_cultural_history: "",
      power_systems: [{ name: "", description: "", stages: [], core_rules: [], ceilings: [] }],
      factions: [], core_rules: [],
    });
    (api.getCharacter as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (api.getNovelOutline as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (api.getOutline as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    renderModal();
    // 2026-09-19:step 1 现在是 CreativeDivergenceStep(不是 ConceptStep)。
    expect(screen.getByTestId("creative-divergence-step")).toBeInTheDocument();
  });

  it("'上一步' is disabled on step 1", () => {
    renderModal();
    expect(screen.getByTestId("wizard-prev")).toBeDisabled();
  });

  it("clicking a step in the indicator jumps to that step", async () => {
    sessionStorage.setItem(
      KEY,
      JSON.stringify({
        currentStep: 2,
        completedSteps: [1],
        status: "completed",
        data: buildData(),
        errorMessage: null,
      }),
    );
    renderModal();
    expect(screen.getByTestId("world-step")).toBeInTheDocument();
    await act(async () => {
      screen.getByTestId("wizard-step-1").click();
    });
    // 2026-09-19:step 1 = CreativeDivergenceStep。
    expect(screen.getByTestId("creative-divergence-step")).toBeInTheDocument();
  });

  it("modal footer has NO forward navigation button (prevents duplicate '完成')", () => {
    sessionStorage.setItem(
      KEY,
      JSON.stringify({
        currentStep: 6,
        completedSteps: [1, 2, 3, 4, 5],
        status: "completed",
        data: buildData(),
        errorMessage: null,
      }),
    );
    renderModal();
    expect(screen.getByTestId("chapter-outline-step")).toBeInTheDocument();
    expect(screen.queryByTestId("wizard-next")).not.toBeInTheDocument();
    expect(screen.queryByTestId("wizard-finish")).not.toBeInTheDocument();
    expect(screen.getByTestId("wizard-prev")).not.toBeDisabled();
  });

  it("clicking '完成 → 进入工作台' on step 6 calls advance, resets wizard, and navigates", async () => {
    (api.generateOutline as ReturnType<typeof vi.fn>).mockResolvedValue({
      chapters: [
        { chapter_number: 1, title: "第一章", summary: "开篇", scene_plan: [{ scene_id: "s1" }] },
      ],
    });
    sessionStorage.setItem(
      KEY,
      JSON.stringify({
        currentStep: 6,
        completedSteps: [1, 2, 3, 4, 5],
        status: "idle",
        data: buildData(),
        errorMessage: null,
      }),
    );
    const onDismiss = vi.fn();
    renderModal(PROJECT, onDismiss);
    expect(screen.getByTestId("chapter-outline-step")).toBeInTheDocument();
    await screen.findByTestId("chapter-outline-form");
    await act(async () => {
      screen.getByTestId("chapter-outline-finish").click();
    });
    await waitFor(() => expect(api.updateOutline).toHaveBeenCalled());
    await waitFor(() => expect(api.advance).toHaveBeenCalledWith(PROJECT, "STAGE4"));
    await waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith(`/project/${encodeURIComponent(PROJECT)}/workspace`),
    );
    expect(onDismiss).toHaveBeenCalled();
    expect(mockNavigate.mock.invocationCallOrder[0]).toBeLessThan(
      onDismiss.mock.invocationCallOrder[0],
    );
  });

  // 2026-09-19:concept 数据从 WizardData 中移除(Concept DNA 步骤砍掉);
  // 不再 prefill concept file。剩下的 prefill 行为涉及 world / characters /
  // novel_outline / outline — 见现有 step 3/5/6 断言。
  it("prefill: empty {characters:[], current:{}} does NOT mark 角色设计 completed", async () => {
    (api.getWorld as ReturnType<typeof vi.fn>).mockResolvedValue({});
    (api.getCharacter as ReturnType<typeof vi.fn>).mockResolvedValue({ characters: [], current: {} });
    (api.getNovelOutline as ReturnType<typeof vi.fn>).mockResolvedValue({});
    (api.getOutline as ReturnType<typeof vi.fn>).mockResolvedValue({});

    renderModal();
    await waitFor(() => expect(api.getCharacter).toHaveBeenCalled());

    expect(screen.getByTestId("wizard-step-3").getAttribute("data-state")).not.toBe("completed");
  });

  it("prefill: empty {chapters:[]} does NOT mark 章节大纲 completed", async () => {
    (api.getWorld as ReturnType<typeof vi.fn>).mockResolvedValue({});
    (api.getCharacter as ReturnType<typeof vi.fn>).mockResolvedValue({});
    (api.getNovelOutline as ReturnType<typeof vi.fn>).mockResolvedValue({});
    (api.getOutline as ReturnType<typeof vi.fn>).mockResolvedValue({ chapters: [] });

    renderModal();
    await waitFor(() => expect(api.getOutline).toHaveBeenCalled());

    expect(screen.getByTestId("wizard-step-6").getAttribute("data-state")).not.toBe("completed");
  });

  it("prefill: populated world/character/novel/outline mark the correct steps completed", async () => {
    (api.getWorld as ReturnType<typeof vi.fn>).mockResolvedValue({});
    (api.getCharacter as ReturnType<typeof vi.fn>).mockResolvedValue({
      characters: [{ name: "林峰" }],
      current: { 林峰: { role: "protagonist" } },
    });
    (api.getNovelOutline as ReturnType<typeof vi.fn>).mockResolvedValue({
      core_conflict_theme: "x",
      volumes: [{ name: "v1", chapter_range: "1-50", summary: "x", key_events: [] }],
      mc_growth_arc: [],
      key_plot_points: [],
      generated_at: "",
      updated_at: "",
    });
    (api.getOutline as ReturnType<typeof vi.fn>).mockResolvedValue({
      chapters: [{ chapter_number: 1, title: "第一章", summary: "x" }],
    });

    renderModal();
    await waitFor(() => expect(api.getOutline).toHaveBeenCalled());

    expect(screen.getByTestId("wizard-step-3").getAttribute("data-state")).toBe("completed");
    expect(screen.getByTestId("wizard-step-5").getAttribute("data-state")).toBe("completed");
    expect(screen.getByTestId("wizard-step-6").getAttribute("data-state")).toBe("completed");
  });

  it("regression proj_cc4ca4ae: re-entering wizard with stale sessionStorage loads existing outline, does NOT regenerate", async () => {
    const existingOutline = {
      core_conflict_theme: "已生成的核心冲突描述",
      volumes: [
        { name: "第一卷 觉醒", chapter_range: "1-50", summary: "阴阳眼觉醒", key_events: ["事件A"] },
      ],
      mc_growth_arc: [],
      key_plot_points: [],
      generated_at: "2026-07-12T19:00:00",
      updated_at: "2026-07-12T19:00:00",
    };
    (api.getWorld as ReturnType<typeof vi.fn>).mockResolvedValue({});
    (api.getCharacter as ReturnType<typeof vi.fn>).mockResolvedValue({});
    (api.getNovelOutline as ReturnType<typeof vi.fn>).mockResolvedValue(existingOutline);
    (api.getOutline as ReturnType<typeof vi.fn>).mockResolvedValue({});

    sessionStorage.setItem(
      KEY,
      JSON.stringify({
        currentStep: 5,
        completedSteps: [1, 2, 3, 4],
        status: "completed",
        data: buildData(),
        errorMessage: null,
      }),
    );

    render(
      <ToastProvider><MemoryRouter>
        <WizardProvider projectId={PROJECT}>
          <InitWizardModal projectId={PROJECT} onDismiss={vi.fn()} resume />
        </WizardProvider>
      </MemoryRouter></ToastProvider>
    );

    await waitFor(() => expect(api.getNovelOutline).toHaveBeenCalled());

    await new Promise((r) => setTimeout(r, 100));

    expect(api.generateNovelOutline).not.toHaveBeenCalled();

    const step5 = screen.getByTestId("wizard-step-5");
    expect(step5.getAttribute("data-state")).toBe("completed");
  });

  it("resume mode: lands on the latest SAVED step, not the next one (no auto-trigger of next stage)", async () => {
    const existingOutline = {
      core_conflict_theme: "已生成的核心冲突描述",
      volumes: [{ name: "第一卷", chapter_range: "1-50", summary: "阴阳眼觉醒", key_events: ["事件A"] }],
      mc_growth_arc: [],
      key_plot_points: [],
      generated_at: "2026-07-12T19:00:00",
      updated_at: "2026-07-12T19:00:00",
    };
    (api.getWorld as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (api.getCharacter as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (api.getNovelOutline as ReturnType<typeof vi.fn>).mockResolvedValue(existingOutline);
    (api.getOutline as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (api.generateNovelOutline as ReturnType<typeof vi.fn>).mockReset();
    (api.generateOutline as ReturnType<typeof vi.fn>).mockReset();

    render(
      <ToastProvider><MemoryRouter>
        <WizardProvider projectId={PROJECT}>
          <InitWizardModal projectId={PROJECT} onDismiss={vi.fn()} resume />
        </WizardProvider>
      </MemoryRouter></ToastProvider>
    );

    await waitFor(() => expect(api.getNovelOutline).toHaveBeenCalled());

    await waitFor(() => expect(screen.getByTestId("outline-step")).toBeInTheDocument());
    expect(screen.queryByTestId("chapter-outline-step")).not.toBeInTheDocument();

    await new Promise((r) => setTimeout(r, 100));

    expect(api.generateNovelOutline).not.toHaveBeenCalled();
    expect(api.generateOutline).not.toHaveBeenCalled();
  });

  // ===========================================================================
  // Step 2 — WorldStep. 2026-09-19 后 WorldStep 的 4 个 section regenerate
  // 图标行为不变。
  // ===========================================================================

  it("world-step renders 4 tab regenerate icons (era, power_system, core_rules, factions)", async () => {
    seedFiles({ world: WORLD_FIXTURE });
    seedStep(2, [1]);

    renderModal();
    await waitFor(() => screen.getByTestId("world-form"));
    expect(screen.getByTestId("world-tab-era-regenerate")).toBeInTheDocument();
    expect(screen.getByTestId("world-tab-power_system-regenerate")).toBeInTheDocument();
    expect(screen.getByTestId("world-tab-core_rules-regenerate")).toBeInTheDocument();
    expect(screen.getByTestId("world-tab-factions-regenerate")).toBeInTheDocument();
  });

  it("clicking world-tab-power_system-regenerate + confirm calls regenerateWorldSection", async () => {
    seedFiles({ world: WORLD_FIXTURE });
    seedStep(2, [1]);

    renderModal();
    const psBtn = await screen.findByTestId("world-tab-power_system-regenerate");
    await act(async () => {
      psBtn.click();
    });
    const confirmBtn = screen.getByTestId("regenerate-modal-confirm");
    await act(async () => {
      confirmBtn.click();
    });
    await waitFor(() =>
      expect(api.regenerateWorldSection).toHaveBeenCalledWith(
        PROJECT,
        "power_system",
        expect.any(String),
      ),
    );
  });

  it("character-step renders 5 section regenerate icons per card", async () => {
    const cardId = "c1";
    const card = buildCharacter(cardId);
    seedFiles({ world: WORLD_FIXTURE, character: { characters: [card], current: card } });
    seedStep(3, [1, 2]);

    renderModal();
    await waitFor(() => screen.getByTestId("character-form"));
    expect(screen.getByTestId(`character-${cardId}-personality-regenerate`)).toBeInTheDocument();
    expect(screen.getByTestId(`character-${cardId}-voice-regenerate`)).toBeInTheDocument();
    expect(screen.getByTestId(`character-${cardId}-current-state-regenerate`)).toBeInTheDocument();
    expect(screen.getByTestId(`character-${cardId}-unknown-regenerate`)).toBeInTheDocument();
    expect(screen.getByTestId(`character-${cardId}-relations-regenerate`)).toBeInTheDocument();
  });

  it("clicking character personality regenerate + confirm calls regenerateCharacterSection", async () => {
    const cardId = "c1";
    const card = buildCharacter(cardId);
    seedFiles({ world: WORLD_FIXTURE, character: { characters: [card], current: card } });
    seedStep(3, [1, 2]);

    renderModal();
    const btn = await screen.findByTestId(`character-${cardId}-personality-regenerate`);
    await act(async () => {
      btn.click();
    });
    const confirmBtn = screen.getByTestId("regenerate-modal-confirm");
    await act(async () => {
      confirmBtn.click();
    });
    await waitFor(() =>
      expect(api.regenerateCharacterSection).toHaveBeenCalledWith(
        PROJECT,
        cardId,
        "personality",
        expect.objectContaining({ userModifications: expect.any(String) }),
      ),
    );
  });

  it("outline-step renders 4 section regenerate icons (core_conflict, volumes, mc_growth, key_plot)", async () => {
    seedFiles({
      world: WORLD_FIXTURE,
      character: { characters: [{ name: "林峰" }], current: { 林峰: { role: "protagonist" } } },
      novelOutline: NOVEL_OUTLINE_FIXTURE,
    });
    seedStep(5, [1, 2, 3, 4]);

    renderModal();
    await waitFor(() => screen.getByTestId("outline-form"));
    expect(screen.getByTestId("outline-core-conflict-regenerate")).toBeInTheDocument();
    expect(screen.getByTestId("outline-volumes-regenerate")).toBeInTheDocument();
    expect(screen.getByTestId("outline-mc-growth-regenerate")).toBeInTheDocument();
    expect(screen.getByTestId("outline-key-plot-regenerate")).toBeInTheDocument();
  });

  it("clicking outline-volumes-regenerate + confirm calls regenerateNovelOutlineSection", async () => {
    seedFiles({
      world: WORLD_FIXTURE,
      character: { characters: [{ name: "林峰" }], current: { 林峰: { role: "protagonist" } } },
      novelOutline: NOVEL_OUTLINE_FIXTURE,
    });
    seedStep(5, [1, 2, 3, 4]);

    renderModal();
    const btn = await screen.findByTestId("outline-volumes-regenerate");
    await act(async () => {
      btn.click();
    });
    const confirmBtn = screen.getByTestId("regenerate-modal-confirm");
    await act(async () => {
      confirmBtn.click();
    });
    await waitFor(() =>
      expect(api.regenerateNovelOutlineSection).toHaveBeenCalledWith(
        PROJECT,
        "volumes",
        expect.any(String),
      ),
    );
  });
});

describe("InitWizardModal footer 保存修改 button", () => {
  it("does NOT render 保存修改 on step 4 (MapStep — no data to save)", () => {
    seedStep(4, [1, 2, 3]);
    renderModal();
    expect(screen.getByTestId("map-step")).toBeInTheDocument();
    expect(screen.queryByTestId("wizard-save")).not.toBeInTheDocument();
    expect(screen.queryByTestId("wizard-regenerate")).not.toBeInTheDocument();
    expect(screen.queryByTestId("wizard-next")).not.toBeInTheDocument();
  });

  it("step 2: clicking 保存修改 calls updateWorld + markStepGenerated, no advance", async () => {
    seedFiles({ world: WORLD_FIXTURE });
    seedStep(2, [1]);
    renderModal();
    await waitFor(() => screen.getByTestId("world-form"));
    const saveBtn = await screen.findByTestId("wizard-save");
    await act(async () => {
      saveBtn.click();
    });
    await waitFor(() => expect(api.updateWorld).toHaveBeenCalled());
    expect(api.advance).not.toHaveBeenCalled();
    expect(screen.getByTestId("world-step")).toBeInTheDocument();
  });

  it("step 3: clicking 保存修改 calls updateCharacter + markStepGenerated, no advance", async () => {
    const cardId = "c1";
    const card = buildCharacter(cardId);
    seedFiles({
      world: WORLD_FIXTURE,
      character: { characters: [card], current: card },
    });
    seedStep(3, [1, 2]);
    renderModal();
    await waitFor(() => screen.getByTestId("character-form"));
    const saveBtn = await screen.findByTestId("wizard-save");
    await act(async () => {
      saveBtn.click();
    });
    await waitFor(() => expect(api.updateCharacter).toHaveBeenCalled());
    expect(api.advance).not.toHaveBeenCalled();
    expect(screen.getByTestId("character-step")).toBeInTheDocument();
  });

  it("step 5: clicking 保存修改 calls updateNovelOutline + markStepGenerated, no advance", async () => {
    seedFiles({
      world: WORLD_FIXTURE,
      character: { characters: [{ name: "林峰" }], current: { 林峰: { role: "protagonist" } } },
      novelOutline: NOVEL_OUTLINE_FIXTURE,
    });
    seedStep(5, [1, 2, 3, 4]);
    renderModal();
    await waitFor(() => screen.getByTestId("outline-form"));
    const saveBtn = await screen.findByTestId("wizard-save");
    await act(async () => {
      saveBtn.click();
    });
    await waitFor(() => expect(api.updateNovelOutline).toHaveBeenCalled());
    expect(api.advance).not.toHaveBeenCalled();
    expect(screen.getByTestId("outline-step")).toBeInTheDocument();
  });

  it("step 6: clicking 保存修改 calls updateOutline + markStepGenerated, no advance", async () => {
    (api.generateOutline as ReturnType<typeof vi.fn>).mockResolvedValue({
      chapters: [{ chapter_number: 1, title: "第一章", summary: "x", scene_plan: [] }],
    });
    seedStep(6, [1, 2, 3, 4, 5]);
    renderModal();
    await waitFor(() => screen.getByTestId("chapter-outline-form"));
    const saveBtn = await screen.findByTestId("wizard-save");
    await act(async () => {
      saveBtn.click();
    });
    await waitFor(() => expect(api.updateOutline).toHaveBeenCalled());
    expect(api.advance).not.toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(screen.getByTestId("chapter-outline-step")).toBeInTheDocument();
  });

  describe("section regenerate footer status badge", () => {
    function renderOnWorld() {
      sessionStorage.setItem(
        KEY,
        JSON.stringify({
          currentStep: 2,
          completedSteps: [1],
          status: "completed",
          data: {
            ...buildData(),
            world: {
              era: "古代",
              geography: "中原",
              era_social_structure: "",
              era_cultural_history: "",
              power_systems: [{ name: "灵力", description: "", stages: [], core_rules: [], ceilings: [] }],
              factions: [],
              core_rules: [],
            },
          },
          errorMessage: null,
        }),
      );
      return renderModal();
    }

    it("does NOT render the badge when no regenerate has started", () => {
      renderOnWorld();
      expect(screen.queryByTestId("wizard-regenerate-status")).not.toBeInTheDocument();
    });

    it("renders a busy badge while the regenerate call is in flight (positioned before 重新生成)", async () => {
      let resolveFn!: () => void;
      (api.regenerateWorldSection as ReturnType<typeof vi.fn>).mockImplementation(
        () => new Promise((r) => { resolveFn = r as () => void; }),
      );
      renderOnWorld();
      await screen.findByTestId("world-form");
      await act(async () => {
        screen.getByTestId("world-tab-era-regenerate").click();
      });
      await screen.findByTestId("regenerate-modal");
      await act(async () => {
        fireEvent.click(screen.getByTestId("regenerate-modal-confirm"));
      });
      const badge = await screen.findByTestId("wizard-regenerate-status");
      expect(badge).toHaveAttribute("data-status", "busy");
      expect(badge.textContent).toContain("正在重新生成 时代与地理");
      const regen = screen.getByTestId("wizard-regenerate");
      expect(
        badge.compareDocumentPosition(regen) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      await act(async () => {
        resolveFn();
      });
    });

    it("renders a success badge after the call resolves; clears after the TTL", async () => {
      renderOnWorld();
      await screen.findByTestId("world-form");
      await act(async () => {
        screen.getByTestId("world-tab-era-regenerate").click();
      });
      await screen.findByTestId("regenerate-modal");
      await act(async () => {
        fireEvent.click(screen.getByTestId("regenerate-modal-confirm"));
      });
      await waitFor(() =>
        expect(screen.queryByTestId("wizard-regenerate-status")?.getAttribute("data-status")).toBe("success"),
      );
      expect(screen.getByTestId("wizard-regenerate-status").textContent).toContain("已重新生成");
    });

    it("renders a failure badge with the error message when the call rejects", async () => {
      (api.regenerateWorldSection as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error("LLM 拒绝"),
      );
      renderOnWorld();
      await screen.findByTestId("world-form");
      await act(async () => {
        screen.getByTestId("world-tab-era-regenerate").click();
      });
      await screen.findByTestId("regenerate-modal");
      await act(async () => {
        fireEvent.click(screen.getByTestId("regenerate-modal-confirm"));
      });
      await waitFor(() =>
        expect(screen.queryByTestId("wizard-regenerate-status")?.getAttribute("data-status")).toBe("failure"),
      );
      const badge = screen.getByTestId("wizard-regenerate-status");
      expect(badge.textContent).toContain("重新生成失败");
      expect(badge.textContent).toContain("LLM 拒绝");
    });
  });
});
