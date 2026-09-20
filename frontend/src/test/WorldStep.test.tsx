import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ToastProvider } from "../hooks/useToast";

vi.mock("../api/client", () => ({
  default: {
    generateWorld: vi.fn(),
    updateWorld: vi.fn(),
    getConcept: vi.fn(),
    getWorld: vi.fn(),
    getCharacter: vi.fn(),
    getNovelOutline: vi.fn(),
    getOutline: vi.fn(),
    regenerateWorldSection: vi.fn(),
    regeneratePowerSystemItem: vi.fn(),
  },
}));

import api from "../api/client";
import InitWizardModal from "../components/wizard/InitWizardModal";
import { getSessionKey } from "../components/wizard/WizardContext";

const PROJECT = "proj_x";
const KEY = getSessionKey(PROJECT);

beforeEach(() => {
  (api.generateWorld as ReturnType<typeof vi.fn>).mockReset();
  (api.updateWorld as ReturnType<typeof vi.fn>).mockReset();
  (api.getConcept as ReturnType<typeof vi.fn>).mockReset();
  (api.getWorld as ReturnType<typeof vi.fn>).mockReset();
  (api.getCharacter as ReturnType<typeof vi.fn>).mockReset();
  (api.getNovelOutline as ReturnType<typeof vi.fn>).mockReset();
  (api.getOutline as ReturnType<typeof vi.fn>).mockReset();
  (api.regenerateWorldSection as ReturnType<typeof vi.fn>).mockReset();
  (api.regeneratePowerSystemItem as ReturnType<typeof vi.fn>).mockReset();
  sessionStorage.clear();
});

// Lands the modal on step 2 (WorldStep) by pre-seeding sessionStorage as if
// step 1 had just been completed.
function setup() {
  sessionStorage.setItem(
    KEY,
    JSON.stringify({
      currentStep: 2,
      completedSteps: [1],
      status: "idle",
      data: {
        concept: { title: "T", genre: "cool_novel", premise: "", tone: "", theme: "", target_audience: "", style_template: "" },
        story_dna: { core_contradiction: { statement: "", side_a: "", side_b: "" }, value_stack: [] },
        world: null, characters: null, novel_outline: null, chapter1_outline: null,
      },
      errorMessage: null,
    }),
  );
  return render(
    <ToastProvider><MemoryRouter>
      <InitWizardModal projectId={PROJECT} onDismiss={vi.fn()} />
    </MemoryRouter></ToastProvider>,
  );
}

describe("WorldStep", () => {
  it("completed state shows both new fields with [新增] accent", async () => {
    (api.generateWorld as ReturnType<typeof vi.fn>).mockResolvedValue({
      era: "古代",
      geography: "中原",
      era_social_structure: "分封制",
      era_cultural_history: "百家争鸣",
      power_systems: [{ name: "X", description: "", stages: [], core_rules: [], ceilings: [] }],
      factions: [],
      core_rules: [],
    });
    setup();
    expect(await screen.findByTestId("world-form")).toBeInTheDocument();
    // 2026-09-20 (Task 6): era panel now has 4 sub-tabs; default = era, so
    // navigate to the social-structure sub-tab to verify that field renders.
    fireEvent.click(screen.getByTestId("world-tab-era-subtab-social-structure"));
    expect(screen.getByTestId("world-era-social-structure")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("world-tab-era-subtab-cultural-history"));
    expect(screen.getByTestId("world-era-cultural-history")).toBeInTheDocument();
  });

  it("tolerates missing new fields (renders empty textareas)", async () => {
    (api.generateWorld as ReturnType<typeof vi.fn>).mockResolvedValue({
      era: "古代",
      geography: "中原",
      power_systems: [{ name: "X", description: "", stages: [], core_rules: [], ceilings: [] }],
      factions: [],
      core_rules: [],
    });
    setup();
    expect(await screen.findByTestId("world-form")).toBeInTheDocument();
    // 2026-09-20 (Task 6): navigate to social-structure sub-tab first.
    fireEvent.click(screen.getByTestId("world-tab-era-subtab-social-structure"));
    expect((screen.getByTestId("world-era-social-structure") as HTMLTextAreaElement).value).toBe("");
    fireEvent.click(screen.getByTestId("world-tab-era-subtab-cultural-history"));
    expect((screen.getByTestId("world-era-cultural-history") as HTMLTextAreaElement).value).toBe("");
  });

  it("'确认修改并继续' in modal footer calls updateWorld and persists the new fields", async () => {
    (api.generateWorld as ReturnType<typeof vi.fn>).mockResolvedValue({
      era: "古代",
      geography: "中原",
      era_social_structure: "分封制",
      era_cultural_history: "百家争鸣",
      power_systems: [{ name: "X", description: "", stages: [], core_rules: [], ceilings: [] }],
      factions: [],
      core_rules: [],
    });
    (api.updateWorld as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    setup();
    await screen.findByTestId("world-form");
    await act(async () => {
      screen.getByTestId("wizard-next").click();
    });
    await waitFor(() => expect(api.updateWorld).toHaveBeenCalledTimes(1));
    const call = (api.updateWorld as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[1].era_social_structure).toBe("分封制");
    expect(call[1].era_cultural_history).toBe("百家争鸣");
  });

  it("renders 力量体系 stages/规则/上限 TagEditors and 世界规则 section", async () => {
    (api.generateWorld as ReturnType<typeof vi.fn>).mockResolvedValue({
      era: "古代",
      geography: "中原",
      power_systems: [
        {
          name: "灵力",
          description: "",
          stages: ["炼气", "筑基"],
          core_rules: ["天地灵气有限"],
          ceilings: ["最高元婴"],
        },
      ],
      factions: [],
      core_rules: ["弱肉强食"],
    });
    setup();
    await screen.findByTestId("world-form");
    // 2026-09-20 (Task 7): power-system cards now render one-at-a-time behind
    // sub-tabs. Switch to the power_system panel before asserting on the card.
    fireEvent.click(screen.getByTestId("world-tab-power_system"));
    expect(screen.getByTestId("world-power-system-0-stages")).toBeInTheDocument();
    expect(screen.getByTestId("world-power-system-0-rules")).toBeInTheDocument();
    expect(screen.getByTestId("world-power-system-0-ceilings")).toBeInTheDocument();
    // 2026-09-20 (Task 8): core_rules 现在以 sub-tab 形式渲染。core_rules=["弱肉强食"]
    // 被 normalizeLegacyWorld 转成 [{category:"physical",text:"弱肉强食"}],所以会渲染
    // 1 个 sub-tab(physical)+对应 CategoryGroup。切到 core_rules tab 即可看到。
    fireEvent.click(screen.getByTestId("world-tab-core_rules"));
    expect(screen.getByTestId("world-tab-core-rules-subtab-physical")).toBeInTheDocument();
    expect(screen.getByTestId("world-core-rules-physical")).toBeInTheDocument();
    // Each TagEditor renders existing items as buttons.
    expect(screen.getByTestId("world-power-system-0-stages").textContent).toContain("炼气");
    expect(screen.getByTestId("world-power-system-0-ceilings").textContent).toContain("最高元婴");
    expect(screen.getByTestId("world-core-rules-physical").textContent).toContain("弱肉强食");
  });

  it("renders every power system as its own card", async () => {
    (api.generateWorld as ReturnType<typeof vi.fn>).mockResolvedValue({
      era: "古代",
      geography: "中原",
      power_systems: [
        { name: "灵力", description: "", stages: ["炼气"], core_rules: [], ceilings: [] },
        { name: "武道", description: "", stages: ["锻体"], core_rules: [], ceilings: [] },
      ],
      factions: [],
      core_rules: [],
    });
    setup();
    await screen.findByTestId("world-form");
    // 2026-09-20 (Task 7): only the active sub-tab's card is rendered. Walk
    // through both sub-tabs to assert each card renders its own data.
    fireEvent.click(screen.getByTestId("world-tab-power_system"));
    expect(screen.getByTestId("world-power-system-0-name")).toHaveValue("灵力");
    expect(screen.getByTestId("world-power-system-0-stages").textContent).toContain("炼气");
    fireEvent.click(screen.getByTestId("world-tab-power-system-subtab-1"));
    expect(screen.getByTestId("world-power-system-1-name")).toHaveValue("武道");
    expect(screen.getByTestId("world-power-system-1-stages").textContent).toContain("锻体");
  });

  it("renders empty-state copy for power systems when none exist", async () => {
    (api.generateWorld as ReturnType<typeof vi.fn>).mockResolvedValue({
      era: "古代",
      geography: "中原",
      power_systems: [],
      factions: [],
      core_rules: [],
    });
    setup();
    await screen.findByTestId("world-form");
    // 2026-09-20 (Task 7): empty state now lives in world-power-system-empty
    // CTA, shown after switching to the power_system panel.
    fireEvent.click(screen.getByTestId("world-tab-power_system"));
    expect(screen.getByTestId("world-power-system-empty")).toBeInTheDocument();
    expect(screen.getByTestId("world-power-system-empty").textContent).toContain("还没有力量体系");
    expect(screen.getByTestId("world-power-system-generate-first")).toBeInTheDocument();
  });

  it("'添加体系' appends an empty power-system card with all 6 fields", async () => {
    (api.generateWorld as ReturnType<typeof vi.fn>).mockResolvedValue({
      era: "古代",
      geography: "中原",
      power_systems: [{ name: "灵力", description: "", stages: [], core_rules: [], ceilings: [] }],
      factions: [],
      core_rules: [],
    });
    (api.updateWorld as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    setup();
    await screen.findByTestId("world-form");
    // 2026-09-20 (Task 7): add button lives on the power_system panel.
    fireEvent.click(screen.getByTestId("world-tab-power_system"));
    await act(async () => {
      screen.getByTestId("world-power-system-add").click();
    });
    fireEvent.click(screen.getByTestId("world-tab-power-system-subtab-1"));
    expect(screen.getByTestId("world-power-system-1")).toBeInTheDocument();
    for (const field of ["name", "description", "stages", "rules", "ceilings", "cost"]) {
      expect(screen.getByTestId(`world-power-system-1-${field}`)).toBeInTheDocument();
    }
  });

  it("'添加体系' persists the new empty slot to disk so ↻ can address it (regression)", async () => {
    // 2026-08-12 bug: clicking 添加体系 only mutated local React state. The
    // user could click ↻ on the new card and the backend rejected with
    // "system_index 1 超出范围 (0..0)" because world.json on disk still had
    // the original single slot. Fix: addPowerSystem now also calls
    // api.updateWorld so the slot is real.
    (api.generateWorld as ReturnType<typeof vi.fn>).mockResolvedValue({
      era: "古代",
      geography: "中原",
      power_systems: [{ name: "灵力", description: "", stages: [], core_rules: [], ceilings: [] }],
      factions: [],
      core_rules: [],
    });
    (api.updateWorld as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    setup();
    await screen.findByTestId("world-form");
    await act(async () => {
      screen.getByTestId("world-power-system-add").click();
    });
    await waitFor(() => expect(api.updateWorld).toHaveBeenCalled());
    const call = (api.updateWorld as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[1].power_systems).toHaveLength(2);
    // The persisted slot is the empty placeholder; existing slot is intact.
    expect(call[1].power_systems[0].name).toBe("灵力");
    expect(call[1].power_systems[1].name).toBe("");
  });

  it("'添加体系' failure: keeps the empty card locally and surfaces an in-form error", async () => {
    (api.generateWorld as ReturnType<typeof vi.fn>).mockResolvedValue({
      era: "古代",
      geography: "中原",
      power_systems: [{ name: "灵力", description: "", stages: [], core_rules: [], ceilings: [] }],
      factions: [],
      core_rules: [],
    });
    (api.updateWorld as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("disk full"));
    setup();
    await screen.findByTestId("world-form");
    // 2026-09-20 (Task 7): add button lives on the power_system panel.
    fireEvent.click(screen.getByTestId("world-tab-power_system"));
    await act(async () => {
      screen.getByTestId("world-power-system-add").click();
    });
    fireEvent.click(screen.getByTestId("world-tab-power-system-subtab-1"));
    // Optimistic: card is visible immediately even though the persist failed.
    expect(screen.getByTestId("world-power-system-1")).toBeInTheDocument();
    // The in-form error banner surfaces the rejection reason.
    await waitFor(() => expect(screen.getByText(/disk full|新增力量体系失败/)).toBeInTheDocument());
  });

  it("typing into two power-system cards then '确认修改并继续' persists the array", async () => {
    (api.generateWorld as ReturnType<typeof vi.fn>).mockResolvedValue({
      era: "古代",
      geography: "中原",
      power_systems: [],
      factions: [],
      core_rules: [],
    });
    (api.updateWorld as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    // 2026-09-20 (Task 7): the empty-state CTA (生成首个体系) calls
    // regeneratePowerSystemItem under the hood, not updateWorld — the mock
    // must return a populated world so the panel transitions to N=1 layout.
    (api.regeneratePowerSystemItem as ReturnType<typeof vi.fn>).mockResolvedValue({
      system_index: 0,
      power_system: { name: "", description: "", stages: [], core_rules: [], ceilings: [], source: "energetics" },
      world: {
        era: "古代",
        geography: "中原",
        era_social_structure: "",
        era_cultural_history: "",
        power_systems: [{ name: "", description: "", stages: [], core_rules: [], ceilings: [], source: "energetics" }],
        factions: [],
        core_rules: [],
      },
    });
    setup();
    await screen.findByTestId("world-form");
    // 2026-09-20 (Task 7): add button lives on the power_system panel, and
    // only the active sub-tab's card is rendered. From the empty state, the
    // first add must go through world-power-system-generate-first (which
    // also calls onRegenerateItem(0) under the hood), then add power-system
    // button takes over for subsequent additions.
    fireEvent.click(screen.getByTestId("world-tab-power_system"));
    await act(async () => {
      screen.getByTestId("world-power-system-generate-first").click();
    });
    await waitFor(() => expect(api.regeneratePowerSystemItem).toHaveBeenCalledTimes(1));
    await act(async () => {
      screen.getByTestId("world-power-system-add").click();
    });
    await act(async () => {
      fireEvent.change(screen.getByTestId("world-power-system-0-name"), { target: { value: "灵力" } });
    });
    fireEvent.click(screen.getByTestId("world-tab-power-system-subtab-1"));
    await act(async () => {
      fireEvent.change(screen.getByTestId("world-power-system-1-name"), { target: { value: "武道" } });
      fireEvent.change(screen.getByTestId("world-power-system-1-cost"), { target: { value: "折寿" } });
    });
    await act(async () => {
      screen.getByTestId("wizard-next").click();
    });
    await waitFor(() => expect(api.updateWorld).toHaveBeenCalledTimes(2));
    // The final wizard-next call carries the typed values; earlier calls are
    // the addPowerSystem persists with empty slot(s).
    const finalCall = (api.updateWorld as ReturnType<typeof vi.fn>).mock.calls.at(-1)!;
    expect(finalCall[1].power_systems).toHaveLength(2);
    expect(finalCall[1].power_systems[0].name).toBe("灵力");
    expect(finalCall[1].power_systems[1].name).toBe("武道");
    expect(finalCall[1].power_systems[1].cost_system).toBe("折寿");
  });

  it("power-system remove button drops the card and re-indexes", async () => {
    (api.generateWorld as ReturnType<typeof vi.fn>).mockResolvedValue({
      era: "古代",
      geography: "中原",
      power_systems: [
        { name: "A", description: "", stages: [], core_rules: [], ceilings: [] },
        { name: "B", description: "", stages: [], core_rules: [], ceilings: [] },
      ],
      factions: [],
      core_rules: [],
    });
    setup();
    await screen.findByTestId("world-form");
    // 2026-09-20 (Task 7): switch to the power_system panel so the per-card
    // remove button is in the DOM.
    fireEvent.click(screen.getByTestId("world-tab-power_system"));
    expect(screen.getByTestId("world-power-system-0-name")).toHaveValue("A");
    expect(screen.queryByTestId("world-power-system-1")).not.toBeInTheDocument();
    // Remove index 0 → slot 0 should now display B; slot 1 no longer exists.
    await act(async () => {
      screen.getByTestId("world-power-system-0-remove").click();
    });
    expect(screen.queryByTestId("world-power-system-1")).not.toBeInTheDocument();
    expect(screen.getByTestId("world-power-system-0-name")).toHaveValue("B");
  });

  it("renders empty-state copy for factions when none exist", async () => {
    (api.generateWorld as ReturnType<typeof vi.fn>).mockResolvedValue({
      era: "古代",
      geography: "中原",
      power_systems: [{ name: "", description: "", stages: [], core_rules: [], ceilings: [] }],
      factions: [],
      core_rules: [],
    });
    setup();
    await screen.findByTestId("world-form");
    // 2026-09-20 (Task 9): factions now lives behind the factions top-level
    // tab and renders a CTA instead of inline cards.
    fireEvent.click(screen.getByTestId("world-tab-factions"));
    expect(screen.getByTestId("world-faction-empty")).toBeInTheDocument();
    expect(screen.getByTestId("world-faction-empty").textContent).toContain("还没有势力");
    expect(screen.getByTestId("world-faction-generate-first")).toBeInTheDocument();
  });

  it("'添加势力' appends an empty faction card with 4 editable fields", async () => {
    (api.generateWorld as ReturnType<typeof vi.fn>).mockResolvedValue({
      era: "古代",
      geography: "中原",
      power_systems: [{ name: "", description: "", stages: [], core_rules: [], ceilings: [] }],
      // 2026-09-20 (Task 9): empty factions now shows a generate-first CTA
      // (not inline cards). Pre-seed one faction so the add button is in DOM.
      factions: [{ name: "现有", type: "", goal: "", relations: "" }],
      core_rules: [],
    });
    setup();
    await screen.findByTestId("world-form");
    // 2026-09-20 (Task 9): switch to factions tab first so the sub-tab
    // strip + add button render.
    fireEvent.click(screen.getByTestId("world-tab-factions"));
    await act(async () => {
      screen.getByTestId("world-faction-add").click();
    });
    fireEvent.click(screen.getByTestId("world-tab-factions-subtab-1"));
    const card = screen.getByTestId("world-faction-1");
    expect(card).toBeInTheDocument();
    expect(screen.getByTestId("world-faction-1-name")).toBeInTheDocument();
    expect(screen.getByTestId("world-faction-1-type")).toBeInTheDocument();
    expect(screen.getByTestId("world-faction-1-goal")).toBeInTheDocument();
    expect(screen.getByTestId("world-faction-1-relations")).toBeInTheDocument();
  });

  it("typing into faction fields then '确认修改并继续' persists the faction data", async () => {
    (api.generateWorld as ReturnType<typeof vi.fn>).mockResolvedValue({
      era: "古代",
      geography: "中原",
      power_systems: [{ name: "", description: "", stages: [], core_rules: [], ceilings: [] }],
      // 2026-09-20 (Task 9): empty factions → CTA; pre-seed so add flow works.
      factions: [{ name: "现有", type: "", goal: "", relations: "" }],
      core_rules: [],
    });
    (api.updateWorld as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    setup();
    await screen.findByTestId("world-form");
    fireEvent.click(screen.getByTestId("world-tab-factions"));
    await act(async () => {
      screen.getByTestId("world-faction-add").click();
    });
    fireEvent.click(screen.getByTestId("world-tab-factions-subtab-1"));
    await act(async () => {
      fireEvent.change(screen.getByTestId("world-faction-1-name"), { target: { value: "青云宗" } });
      fireEvent.change(screen.getByTestId("world-faction-1-type"), { target: { value: "修仙门派" } });
      fireEvent.change(screen.getByTestId("world-faction-1-goal"), { target: { value: "飞升" } });
      fireEvent.change(screen.getByTestId("world-faction-1-relations"), { target: { value: "与魔道对立" } });
    });
    await act(async () => {
      screen.getByTestId("wizard-next").click();
    });
    await waitFor(() => expect(api.updateWorld).toHaveBeenCalledTimes(1));
    const call = (api.updateWorld as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[1].factions).toEqual([
      { name: "现有", type: "", goal: "", relations: "" },
      { name: "青云宗", type: "修仙门派", goal: "飞升", relations: "与魔道对立" },
    ]);
  });

  it("faction remove button drops the row", async () => {
    (api.generateWorld as ReturnType<typeof vi.fn>).mockResolvedValue({
      era: "古代",
      geography: "中原",
      power_systems: [{ name: "", description: "", stages: [], core_rules: [], ceilings: [] }],
      factions: [
        { name: "A", type: "", goal: "", relations: "" },
        { name: "B", type: "", goal: "", relations: "" },
      ],
      core_rules: [],
    });
    setup();
    await screen.findByTestId("world-form");
    // 2026-09-20 (Task 9): faction cards render one-at-a-time behind sub-tabs.
    // The default sub-tab is 0 — switch to factions tab and click remove on
    // the active card (slot 0).
    fireEvent.click(screen.getByTestId("world-tab-factions"));
    expect(screen.getByTestId("world-faction-0-name")).toHaveValue("A");
    await act(async () => {
      screen.getByTestId("world-faction-0-remove").click();
    });
    // Faction B is re-indexed to slot 0 (the DOM node at index 0 is reused,
    // its value updated to "B"). Slot 1 no longer exists.
    expect(screen.queryByTestId("world-faction-1")).not.toBeInTheDocument();
    expect(screen.getByTestId("world-faction-0-name")).toHaveValue("B");
  });

  // Regression: proj_ec67d3e2 — the LLM ignored the prompt's string schema
  // for `era_social_structure` and `power_system.stages` and produced nested
  // objects instead. The wizard's textareas expect strings and the
  // TagEditor expects a string array, so the form failed to render. Both
  // the backend (World model field_validator) and the frontend
  // (normalizeLegacyWorld) coerce object shapes so the form renders.
  it("renders the form even when world.json has object-shaped fields (legacy data shape)", async () => {
    // Legacy shape: era_social_structure is an object, power_system.stages
    // is an object grouped by tier. The wizard must normalize these to
    // strings / string arrays so the form mounts.
    const legacyWorld = {
      era: "清末民初",
      geography: "华南",
      era_social_structure: {
        人类阶层: "军阀",
        异类阶层: "僵尸",
      },
      era_cultural_history: "太平天国",
      power_system: {
        name: "道炁",
        description: "...",
        stages: {
          人道阶: ["养气期", "凝神期"],
          地道阶: ["贯通期"],
        },
        core_rules: ["境界匹配"],
        ceilings: ["合道期"],
      },
      factions: [],
      core_rules: [],
    };
    sessionStorage.setItem(
      KEY,
      JSON.stringify({
        currentStep: 2,
        completedSteps: [1, 2],
        status: "completed",
        data: {
          concept: null, story_dna: null,
          world: legacyWorld,
          characters: null, novel_outline: null, chapter1_outline: null,
        },
        errorMessage: null,
      }),
    );
    // generateWorld must NOT be called — the auto-trigger only fires when
    // `wizard.data.world` is null. The legacy shape is still treated as a
    // populated world.
    (api.generateWorld as ReturnType<typeof vi.fn>).mockResolvedValue(legacyWorld);
    render(
      <ToastProvider><MemoryRouter>
        <InitWizardModal projectId={PROJECT} onDismiss={vi.fn()} />
      </MemoryRouter></ToastProvider>,
    );
    // The form renders despite the legacy shape.
    const form = await screen.findByTestId("world-form");
    expect(form).toBeInTheDocument();
    // 2026-09-20 (Task 6): era panel now has 4 sub-tabs; default = era, so
    // navigate to the social-structure sub-tab before asserting on it.
    fireEvent.click(screen.getByTestId("world-tab-era-subtab-social-structure"));
    // era_social_structure is coerced to a JSON string (contains the keys).
    const social = screen.getByTestId("world-era-social-structure") as HTMLTextAreaElement;
    expect(social.value).toContain("人类阶层");
    expect(social.value).toContain("军阀");
    // 2026-09-20 (Task 7): power-system cards now render one-at-a-time;
    // switch to the power_system panel before asserting on its card.
    fireEvent.click(screen.getByTestId("world-tab-power_system"));
    // power_system is folded into power_systems[0] and its object-shaped
    // stages flattened — all string values appear in the TagEditor.
    const stages = screen.getByTestId("world-power-system-0-stages");
    expect(stages.textContent).toContain("养气期");
    expect(stages.textContent).toContain("贯通期");
    expect(screen.getByTestId("world-power-system-0-name")).toHaveValue("道炁");
  });

  it("each power-system card renders a regenerate button next to its remove button", async () => {
    (api.generateWorld as ReturnType<typeof vi.fn>).mockResolvedValue({
      era: "古代",
      geography: "中原",
      power_systems: [{ name: "灵力", description: "", stages: [], core_rules: [], ceilings: [] }],
      factions: [],
      core_rules: [],
    });
    setup();
    await screen.findByTestId("world-form");
    // 2026-09-20 (Task 7): the per-card regenerate/remove affordances live
    // on the active sub-tab's card; switch to the power_system panel first.
    fireEvent.click(screen.getByTestId("world-tab-power_system"));
    expect(screen.getByTestId("world-power-system-0-regenerate")).toBeInTheDocument();
    expect(screen.getByTestId("world-power-system-0-remove")).toBeInTheDocument();
    // The section-level regenerate button now lives in the tab strip.
    expect(screen.getByTestId("world-tab-power_system-regenerate")).toBeInTheDocument();
  });

  it("per-card regenerate calls regeneratePowerSystemItem with the right index and mods", async () => {
    (api.generateWorld as ReturnType<typeof vi.fn>).mockResolvedValue({
      era: "古代",
      geography: "中原",
      power_systems: [
        { name: "灵力", description: "", stages: ["炼气"], core_rules: [], ceilings: [] },
        { name: "武道", description: "", stages: ["锻体"], core_rules: [], ceilings: [] },
      ],
      factions: [],
      core_rules: [],
    });
    (api.regeneratePowerSystemItem as ReturnType<typeof vi.fn>).mockResolvedValue({
      system_index: 1,
      power_system: { name: "武道（新）", description: "新", stages: ["锻体"], core_rules: [], ceilings: [] },
      world: {
        era: "古代",
        geography: "中原",
        era_social_structure: "",
        era_cultural_history: "",
        power_systems: [
          { name: "灵力", description: "", stages: ["炼气"], core_rules: [], ceilings: [] },
          { name: "武道（新）", description: "新", stages: ["锻体"], core_rules: [], ceilings: [] },
        ],
        factions: [],
        core_rules: [],
      },
    });
    setup();
    await screen.findByTestId("world-form");
    // 2026-09-20 (Task 7): the active sub-tab's card holds the per-card
    // regenerate button — switch panel and sub-tab before clicking it.
    fireEvent.click(screen.getByTestId("world-tab-power_system"));
    fireEvent.click(screen.getByTestId("world-tab-power-system-subtab-1"));
    await act(async () => {
      screen.getByTestId("world-power-system-1-regenerate").click();
    });
    // Modal opened by SectionRegenerateButton — type mods and confirm.
    const textarea = await screen.findByTestId("regenerate-modal") && screen.getByLabelText("修改意见");
    await act(async () => {
      fireEvent.change(textarea, { target: { value: "强调肉身极限" } });
      screen.getByTestId("regenerate-modal-confirm").click();
    });
    await waitFor(() =>
      expect(api.regeneratePowerSystemItem).toHaveBeenCalledWith(
        PROJECT,
        1,
        "强调肉身极限",
      ),
    );
  });

  it("per-card regenerate updates only the target card and preserves the rest", async () => {
    (api.generateWorld as ReturnType<typeof vi.fn>).mockResolvedValue({
      era: "古代",
      geography: "中原",
      power_systems: [
        { name: "灵力", description: "", stages: ["炼气"], core_rules: [], ceilings: [] },
        { name: "武道", description: "", stages: ["锻体"], core_rules: [], ceilings: [] },
      ],
      factions: [],
      core_rules: [],
    });
    (api.regeneratePowerSystemItem as ReturnType<typeof vi.fn>).mockResolvedValue({
      system_index: 0,
      power_system: { name: "灵力（新）", description: "新", stages: ["炼气"], core_rules: [], ceilings: [] },
      world: {
        era: "古代",
        geography: "中原",
        era_social_structure: "",
        era_cultural_history: "",
        power_systems: [
          { name: "灵力（新）", description: "新", stages: ["炼气"], core_rules: [], ceilings: [] },
          { name: "武道", description: "", stages: ["锻体"], core_rules: [], ceilings: [] },
        ],
        factions: [],
        core_rules: [],
      },
    });
    setup();
    await screen.findByTestId("world-form");
    // 2026-09-20 (Task 7): navigate to power_system panel before clicking
    // the per-card regenerate button (only the active sub-tab's card renders).
    fireEvent.click(screen.getByTestId("world-tab-power_system"));
    await act(async () => {
      screen.getByTestId("world-power-system-0-regenerate").click();
    });
    await act(async () => {
      screen.getByTestId("regenerate-modal-confirm").click();
    });
    await waitFor(() => expect(api.regeneratePowerSystemItem).toHaveBeenCalledTimes(1));
    expect((screen.getByTestId("world-power-system-0-name") as HTMLInputElement).value).toBe("灵力（新）");
    fireEvent.click(screen.getByTestId("world-tab-power-system-subtab-1"));
    expect((screen.getByTestId("world-power-system-1-name") as HTMLInputElement).value).toBe("武道");
  });
});
