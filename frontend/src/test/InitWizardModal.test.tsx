import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("../api/client", () => ({
  default: {
    advance: vi.fn(),
    generateOutline: vi.fn(),
    generateConcept: vi.fn(),
    generateNovelOutline: vi.fn(),
    updateOutline: vi.fn(),
    getConcept: vi.fn(),
    getWorld: vi.fn(),
    getCharacter: vi.fn(),
    getNovelOutline: vi.fn(),
    getOutline: vi.fn(),
    // Per-section regenerate API wrappers (Task 6 of v2.1 wizard plan)
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
  (api.getConcept as ReturnType<typeof vi.fn>).mockReset();
  (api.getWorld as ReturnType<typeof vi.fn>).mockReset();
  (api.getCharacter as ReturnType<typeof vi.fn>).mockReset();
  (api.getNovelOutline as ReturnType<typeof vi.fn>).mockReset();
  (api.getOutline as ReturnType<typeof vi.fn>).mockReset();
  // Per-section regenerate API wrappers: default to a successful resolution
  // that returns a payload matching the step component's expected shape.
  // Individual tests override these mocks as needed.
  (api.regenerateConceptSection as ReturnType<typeof vi.fn>).mockReset();
  (api.regenerateConceptSection as ReturnType<typeof vi.fn>).mockResolvedValue({
    concept: { title: "T", genre: "cool_novel", premise: "", tone: "", theme: "", target_audience: "", style_template: "" },
    story_dna: { core_contradiction: { statement: "", side_a: "", side_b: "" }, value_stack: [] },
  });
  (api.regenerateWorldSection as ReturnType<typeof vi.fn>).mockReset();
  (api.regenerateWorldSection as ReturnType<typeof vi.fn>).mockResolvedValue({
    era: "e", geography: "g", era_social_structure: "", era_cultural_history: "",
    power_system: { name: "", description: "", stages: [], core_rules: [], ceilings: [] },
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
  mockNavigate.mockReset();
  sessionStorage.clear();
});

function renderModal(projectId = PROJECT, onDismiss = vi.fn()) {
  return render(
    <MemoryRouter>
      <WizardProvider projectId={projectId}>
        <InitWizardModal projectId={projectId} onDismiss={onDismiss} />
      </WizardProvider>
    </MemoryRouter>
  );
}

function buildData() {
  return {
    concept: { title: "T", genre: "cool_novel", premise: "", tone: "", theme: "", target_audience: "", style_template: "" },
    story_dna: { core_contradiction: { statement: "", side_a: "", side_b: "" }, value_stack: [] },
    world: null,
    characters: null,
    novel_outline: null,
    chapter1_outline: null,
  };
}

const CONCEPT_FIXTURE = {
  concept: { title: "T", genre: "cool_novel", premise: "", tone: "", theme: "", target_audience: "", style_template: "" },
  story_dna: { core_contradiction: { statement: "x", side_a: "", side_b: "" }, value_stack: [] },
};

const WORLD_FIXTURE = {
  era: "e", geography: "g", era_social_structure: "", era_cultural_history: "",
  power_system: { name: "", description: "", stages: [], core_rules: [], ceilings: [] },
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

// Wire `api.get*` mocks for the 5 wizard data files. Each field defaults to
// `null`. Returns the merged object so callers can reference seeded shapes.
const seedFiles = (files: {
  concept?: typeof CONCEPT_FIXTURE | null;
  world?: typeof WORLD_FIXTURE | null;
  character?: ReturnType<typeof buildCharacter> | { characters: unknown[]; current: unknown } | null;
  novelOutline?: typeof NOVEL_OUTLINE_FIXTURE | null;
  outline?: unknown | null;
} = {}) => {
  const concept = files.concept === undefined ? null : files.concept;
  const world = files.world === undefined ? null : files.world;
  const character = files.character === undefined ? null : files.character;
  const novelOutline = files.novelOutline === undefined ? null : files.novelOutline;
  const outline = files.outline === undefined ? null : files.outline;
  (api.getConcept as ReturnType<typeof vi.fn>).mockResolvedValue(concept);
  (api.getWorld as ReturnType<typeof vi.fn>).mockResolvedValue(world);
  (api.getCharacter as ReturnType<typeof vi.fn>).mockResolvedValue(character);
  (api.getNovelOutline as ReturnType<typeof vi.fn>).mockResolvedValue(novelOutline);
  (api.getOutline as ReturnType<typeof vi.fn>).mockResolvedValue(outline);
  return { concept, world, character, novelOutline, outline };
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
    // sessionStorage must be preserved so the user can resume later
    expect(sessionStorage.getItem(KEY)).not.toBeNull();
  });

  it("renders ConceptStep on mount (step 1)", () => {
    renderModal();
    expect(screen.getByTestId("concept-step")).toBeInTheDocument();
  });

  it("resume mode: hydrates from files and lands on the latest SAVED step (step 2 = WorldStep)", async () => {
    (api.getConcept as ReturnType<typeof vi.fn>).mockResolvedValue({
      concept: { title: "T", genre: "cool_novel", premise: "", tone: "", theme: "", target_audience: "", style_template: "" },
      story_dna: { core_contradiction: { statement: "x", side_a: "", side_b: "" }, value_stack: [] },
    });
    (api.getWorld as ReturnType<typeof vi.fn>).mockResolvedValue({
      era: "e", geography: "g", era_social_structure: "", era_cultural_history: "",
      power_system: { name: "", description: "", stages: [], core_rules: [], ceilings: [] },
      factions: [], core_rules: [],
    });
    // No character/novel/outline files → steps 1, 2 completed; latest saved = 2.
    (api.getCharacter as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (api.getNovelOutline as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (api.getOutline as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    render(
      <MemoryRouter>
        <WizardProvider projectId={PROJECT}>
          <InitWizardModal projectId={PROJECT} onDismiss={vi.fn()} resume />
        </WizardProvider>
      </MemoryRouter>
    );

    // Should land on WorldStep (latest saved = 2), NOT CharacterStep.
    // The old buggy behavior jumped to step 3 (= max + 1).
    await waitFor(() => expect(screen.getByTestId("world-step")).toBeInTheDocument());
    expect(screen.queryByTestId("character-step")).not.toBeInTheDocument();
  });

  it("resume=false (default): hydrates from files but stays on step 1", async () => {
    (api.getConcept as ReturnType<typeof vi.fn>).mockResolvedValue({
      concept: { title: "T", genre: "cool_novel", premise: "", tone: "", theme: "", target_audience: "", style_template: "" },
      story_dna: { core_contradiction: { statement: "x", side_a: "", side_b: "" }, value_stack: [] },
    });
    (api.getWorld as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (api.getCharacter as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (api.getNovelOutline as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (api.getOutline as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    renderModal(); // default resume=false
    // ConceptStep stays mounted (step 1) even though the concept file exists.
    expect(screen.getByTestId("concept-step")).toBeInTheDocument();
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
    expect(screen.getByTestId("concept-step")).toBeInTheDocument();
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
    // Auto-trigger fires on mount; wait for the form to appear.
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
    // Regression v1.9: navigate MUST be called before onDismiss, so any
    // future onDismiss implementation that does more than setState (e.g.
    // window.location.assign) can't beat the workspace navigation.
    expect(mockNavigate.mock.invocationCallOrder[0]).toBeLessThan(
      onDismiss.mock.invocationCallOrder[0],
    );
    // wizard.reset() clears sessionStorage, but currentStep=1 immediately
    // re-renders ConceptStep, whose auto-trigger (added in v1.8 Task 2) writes
    // sessionStorage again. Asserting null here would test the wrong thing:
    // the auto-trigger is intentional v1.8 behavior. In production, onDismiss
    // unmounts the modal before ConceptStep can render; only the test, where
    // onDismiss is a vi.fn(), lets it mount and repopulate.
  });

  // v1.9 fix: prefill must treat empty arrays/objects as "no content".
  // The backend returns {"characters": [], "current": {}} for a fresh
  // project's character set and {"chapters": []} for a fresh chapter outline.
  // A naive truthy check (`[] !== ""`) marked 角色设计 (step 3) and
  // 全书大纲 (step 5) as ✓ on first open — visibly wrong since the user
  // hadn't filled either in.
  it("prefill: empty {characters:[], current:{}} does NOT mark 角色设计 completed", async () => {
    (api.getConcept as ReturnType<typeof vi.fn>).mockResolvedValue({});
    (api.getWorld as ReturnType<typeof vi.fn>).mockResolvedValue({});
    (api.getCharacter as ReturnType<typeof vi.fn>).mockResolvedValue({ characters: [], current: {} });
    (api.getNovelOutline as ReturnType<typeof vi.fn>).mockResolvedValue({});
    (api.getOutline as ReturnType<typeof vi.fn>).mockResolvedValue({});

    renderModal();
    // Let the prefill useEffect run.
    await waitFor(() => expect(api.getCharacter).toHaveBeenCalled());

    expect(screen.getByTestId("wizard-step-3").getAttribute("data-state")).not.toBe("completed");
  });

  it("prefill: empty {chapters:[]} does NOT mark 章节大纲 completed", async () => {
    (api.getConcept as ReturnType<typeof vi.fn>).mockResolvedValue({});
    (api.getWorld as ReturnType<typeof vi.fn>).mockResolvedValue({});
    (api.getCharacter as ReturnType<typeof vi.fn>).mockResolvedValue({});
    (api.getNovelOutline as ReturnType<typeof vi.fn>).mockResolvedValue({});
    (api.getOutline as ReturnType<typeof vi.fn>).mockResolvedValue({ chapters: [] });

    renderModal();
    await waitFor(() => expect(api.getOutline).toHaveBeenCalled());

    expect(screen.getByTestId("wizard-step-6").getAttribute("data-state")).not.toBe("completed");
  });

  it("prefill: populated character/novel/outline mark the correct steps completed", async () => {
    // getNovelOutline → step 5 (全书大纲); getOutline → step 6 (章节大纲).
    // The earlier version of this test asserted step 5 was completed when
    // getOutline returned chapters, which only "passed" because the prefill
    // was pushing outline → step 5 instead of step 6 (off-by-one bug).
    (api.getConcept as ReturnType<typeof vi.fn>).mockResolvedValue({});
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

  // v1.8.2 regression for proj_cc4ca4ae: user closes the wizard on step 5
  // BEFORE clicking "确认修改并继续". sessionStorage persists currentStep=5
  // and completedSteps=[1..4], but data.novel_outline is null (only the
  // local component state held the generated outline). On re-entry via the
  // /project/:id/wizard deep-link, the modal mounts with stale wizard state.
  // OutlineStep's auto-trigger fires synchronously and POSTs
  // /generate-novel-outline, regenerating content the user already paid for.
  // The fix: prefill must ALWAYS run on mount (not skip when completedSteps
  // has any items), and auto-trigger must wait for prefill to complete.
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
    (api.getConcept as ReturnType<typeof vi.fn>).mockResolvedValue({
      concept: { title: "诡眼少年", genre: "cool_novel", premise: "", tone: "", theme: "", target_audience: "", style_template: "" },
      story_dna: { core_contradiction: { statement: "", side_a: "", side_b: "" }, value_stack: [] },
    });
    (api.getWorld as ReturnType<typeof vi.fn>).mockResolvedValue({});
    (api.getCharacter as ReturnType<typeof vi.fn>).mockResolvedValue({});
    (api.getNovelOutline as ReturnType<typeof vi.fn>).mockResolvedValue(existingOutline);
    (api.getOutline as ReturnType<typeof vi.fn>).mockResolvedValue({});

    // Simulate: user previously closed on step 5 without saving. The
    // sessionStorage holds the wizard's completedSteps but NOT the
    // generated outline (it lived only in OutlineStep's local state).
    sessionStorage.setItem(
      KEY,
      JSON.stringify({
        currentStep: 5,
        completedSteps: [1, 2, 3, 4],
        status: "completed",
        data: {
          concept: { title: "诡眼少年", genre: "cool_novel", premise: "", tone: "", theme: "", target_audience: "", style_template: "" },
          story_dna: { core_contradiction: { statement: "", side_a: "", side_b: "" }, value_stack: [] },
          world: null,
          characters: null,
          novel_outline: null,
          chapter1_outline: null,
        },
        errorMessage: null,
      }),
    );

    // Mount via the deep-link path with resume=true so the modal jumps to
    // the current step (5) once prefill lands.
    render(
      <MemoryRouter>
        <WizardProvider projectId={PROJECT}>
          <InitWizardModal projectId={PROJECT} onDismiss={vi.fn()} resume />
        </WizardProvider>
      </MemoryRouter>
    );

    // Wait for prefill to land.
    await waitFor(() => expect(api.getNovelOutline).toHaveBeenCalled());

    // Allow any async auto-trigger to fire (it shouldn't).
    await new Promise((r) => setTimeout(r, 100));

    // CRITICAL: regenerate must NOT have been called.
    expect(api.generateNovelOutline).not.toHaveBeenCalled();

    // The wizard should be on step 5 with the existing outline loaded.
    const step5 = screen.getByTestId("wizard-step-5");
    expect(step5.getAttribute("data-state")).toBe("completed");
  });

  // Bug report (2026-08-09): entering the wizard from the bookshelf
  // deep-link (resume=true) used to advance to max(completed) + 1 instead
  // of the latest saved step. For a project that saved step 5
  // (novel_outline.json), the modal landed on step 6 (ChapterOutlineStep)
  // and auto-triggered chapter-outline generation, burning tokens the user
  // had not asked for. The fix: land on Math.max(...completed) (the latest
  // SAVED step), not + 1.
  it("resume mode: lands on the latest SAVED step, not the next one (no auto-trigger of next stage)", async () => {
    // Set up: only novel_outline.json exists. Concept / world / characters /
    // outline.json are missing → prefill will produce completed = [5].
    const existingOutline = {
      core_conflict_theme: "已生成的核心冲突描述",
      volumes: [{ name: "第一卷", chapter_range: "1-50", summary: "阴阳眼觉醒", key_events: ["事件A"] }],
      mc_growth_arc: [],
      key_plot_points: [],
      generated_at: "2026-07-12T19:00:00",
      updated_at: "2026-07-12T19:00:00",
    };
    (api.getConcept as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (api.getWorld as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (api.getCharacter as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (api.getNovelOutline as ReturnType<typeof vi.fn>).mockResolvedValue(existingOutline);
    (api.getOutline as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (api.generateNovelOutline as ReturnType<typeof vi.fn>).mockReset();
    (api.generateOutline as ReturnType<typeof vi.fn>).mockReset();

    render(
      <MemoryRouter>
        <WizardProvider projectId={PROJECT}>
          <InitWizardModal projectId={PROJECT} onDismiss={vi.fn()} resume />
        </WizardProvider>
      </MemoryRouter>
    );

    // Wait for prefill to land.
    await waitFor(() => expect(api.getNovelOutline).toHaveBeenCalled());

    // The wizard should land on step 5 (OutlineStep) with the existing
    // outline loaded — NOT advance to step 6 (ChapterOutlineStep), which
    // would auto-trigger chapter-outline generation.
    await waitFor(() => expect(screen.getByTestId("outline-step")).toBeInTheDocument());
    expect(screen.queryByTestId("chapter-outline-step")).not.toBeInTheDocument();

    // Allow any async auto-trigger to fire (it shouldn't).
    await new Promise((r) => setTimeout(r, 100));

    // Neither novel-outline regeneration nor chapter-outline generation
    // should fire. The novel_outline.json already on disk is the truth;
    // we must not throw it away by triggering a fresh LLM call.
    expect(api.generateNovelOutline).not.toHaveBeenCalled();
    expect(api.generateOutline).not.toHaveBeenCalled();
  });

  // ===========================================================================
  // Task 11: per-section regenerate icons + click handlers (v2.1 wizard plan).
  // Each step has 2 tests: (A) icons render, (B) clicking an icon + confirming
  // the modal calls the right `regenerate*Section` API wrapper. Mock fixtures
  // seed the relevant file(s) so the form is mounted deterministically, and
  // sessionStorage sets `currentStep` for steps 2/3/5 since the wizard
  // defaults to step 1 on mount.
  // ===========================================================================

  // Step 1 — ConceptStep. Default mount lands on step 1. Seed getConcept so
  // the auto-trigger (ConceptStep line 113) sees wizard.data.concept and
  // skips; the form renders immediately from the hydrated state.
  it("concept-step renders section regenerate icons for 概念信息 and 核心矛盾", async () => {
    seedFiles({ concept: CONCEPT_FIXTURE });

    renderModal();
    await waitFor(() => screen.getByTestId("concept-form"));
    expect(screen.getByTestId("concept-info-regenerate")).toBeInTheDocument();
    expect(screen.getByTestId("concept-dna-regenerate")).toBeInTheDocument();
  });

  it("clicking concept-info-regenerate + confirm calls regenerateConceptSection with the typed text", async () => {
    seedFiles({ concept: CONCEPT_FIXTURE });

    renderModal();
    const infoBtn = await screen.findByTestId("concept-info-regenerate");
    await act(async () => {
      infoBtn.click();
    });
    fireEvent.change(screen.getByLabelText("修改意见"), {
      target: { value: "更强调赛博朋克" },
    });
    const confirmBtn = screen.getByTestId("regenerate-modal-confirm");
    await act(async () => {
      confirmBtn.click();
    });
    await waitFor(() =>
      expect(api.regenerateConceptSection).toHaveBeenCalledWith(
        PROJECT,
        "concept",
        "更强调赛博朋克",
      ),
    );
  });

  // Step 2 — WorldStep. Land on step 2 via sessionStorage. Seed getWorld so
  // the form has data to render (otherwise the section buttons wouldn't show).
  it("world-step renders 4 section regenerate icons (era, power_system, core_rules, factions)", async () => {
    seedFiles({ concept: CONCEPT_FIXTURE, world: WORLD_FIXTURE });
    seedStep(2, [1]);

    renderModal();
    await waitFor(() => screen.getByTestId("world-form"));
    expect(screen.getByTestId("world-era-regenerate")).toBeInTheDocument();
    expect(screen.getByTestId("world-power-system-regenerate")).toBeInTheDocument();
    expect(screen.getByTestId("world-core-rules-regenerate")).toBeInTheDocument();
    expect(screen.getByTestId("world-factions-regenerate")).toBeInTheDocument();
  });

  it("clicking world-power-system-regenerate + confirm calls regenerateWorldSection", async () => {
    seedFiles({ concept: CONCEPT_FIXTURE, world: WORLD_FIXTURE });
    seedStep(2, [1]);

    renderModal();
    const psBtn = await screen.findByTestId("world-power-system-regenerate");
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

  // Step 3 — CharacterStep. Land on step 3 via sessionStorage. Seed
  // getCharacter with 1 card so the form renders and the per-card icons show.
  // Per CharacterStep, the 5 per-card icons are: personality, voice,
  // current_state, unknown, relations. Their testIds are constructed in
  // CharacterStep.tsx as `character-${c.id}-<section>-regenerate`.
  it("character-step renders 5 section regenerate icons per card", async () => {
    const cardId = "c1";
    const card = buildCharacter(cardId);
    seedFiles({ concept: CONCEPT_FIXTURE, world: WORLD_FIXTURE, character: { characters: [card], current: card } });
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
    seedFiles({ concept: CONCEPT_FIXTURE, world: WORLD_FIXTURE, character: { characters: [card], current: card } });
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

  // Step 5 — OutlineStep. The wizard indicator shows step 5 for novel_outline.
  // The volumes section button only renders when `outline.volumes.length > 0`
  // (OutlineStep line 162), so the fixture must include at least one volume.
  it("outline-step renders 4 section regenerate icons (core_conflict, volumes, mc_growth, key_plot)", async () => {
    seedFiles({
      concept: CONCEPT_FIXTURE,
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
      concept: CONCEPT_FIXTURE,
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