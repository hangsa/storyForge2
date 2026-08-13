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
    expect(screen.getByTestId("world-era-social-structure")).toBeInTheDocument();
    expect(screen.getByTestId("world-era-cultural-history")).toBeInTheDocument();
    expect(screen.getAllByText(/新增/).length).toBeGreaterThanOrEqual(2);
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
    expect((screen.getByTestId("world-era-social-structure") as HTMLTextAreaElement).value).toBe("");
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
    expect(screen.getByTestId("world-power-system-0-stages")).toBeInTheDocument();
    expect(screen.getByTestId("world-power-system-0-rules")).toBeInTheDocument();
    expect(screen.getByTestId("world-power-system-0-ceilings")).toBeInTheDocument();
    expect(screen.getByTestId("world-core-rules")).toBeInTheDocument();
    // Each TagEditor renders existing items as buttons.
    expect(screen.getByTestId("world-power-system-0-stages").textContent).toContain("炼气");
    expect(screen.getByTestId("world-power-system-0-ceilings").textContent).toContain("最高元婴");
    expect(screen.getByTestId("world-core-rules").textContent).toContain("弱肉强食");
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
    expect(screen.getByTestId("world-power-system-0-name")).toHaveValue("灵力");
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
    expect(screen.getByTestId("world-power-systems").textContent).toContain("暂无力量体系");
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
    await act(async () => {
      screen.getByTestId("world-power-system-add").click();
    });
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
    await act(async () => {
      screen.getByTestId("world-power-system-add").click();
    });
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
    setup();
    await screen.findByTestId("world-form");
    // Two 添加体系 clicks — each one now also calls api.updateWorld (regression
    // 2026-08-12), so updateWorld is invoked 3 times total by the end of this
    // test: twice for addPowerSystem, once for the final wizard-next save.
    await act(async () => {
      screen.getByTestId("world-power-system-add").click();
    });
    await act(async () => {
      screen.getByTestId("world-power-system-add").click();
    });
    await act(async () => {
      fireEvent.change(screen.getByTestId("world-power-system-0-name"), { target: { value: "灵力" } });
      fireEvent.change(screen.getByTestId("world-power-system-1-name"), { target: { value: "武道" } });
      fireEvent.change(screen.getByTestId("world-power-system-1-cost"), { target: { value: "折寿" } });
    });
    await act(async () => {
      screen.getByTestId("wizard-next").click();
    });
    await waitFor(() => expect(api.updateWorld).toHaveBeenCalledTimes(3));
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
    expect(screen.getByTestId("world-power-system-1")).toBeInTheDocument();
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
    expect(screen.getByTestId("world-factions")).toBeInTheDocument();
    expect(screen.getByTestId("world-factions").textContent).toContain("暂无势力");
  });

  it("'添加势力' appends an empty faction card with 4 editable fields", async () => {
    (api.generateWorld as ReturnType<typeof vi.fn>).mockResolvedValue({
      era: "古代",
      geography: "中原",
      power_systems: [{ name: "", description: "", stages: [], core_rules: [], ceilings: [] }],
      factions: [],
      core_rules: [],
    });
    setup();
    await screen.findByTestId("world-form");
    await act(async () => {
      screen.getByTestId("world-faction-add").click();
    });
    const card = screen.getByTestId("world-faction-0");
    expect(card).toBeInTheDocument();
    expect(screen.getByTestId("world-faction-0-name")).toBeInTheDocument();
    expect(screen.getByTestId("world-faction-0-type")).toBeInTheDocument();
    expect(screen.getByTestId("world-faction-0-goal")).toBeInTheDocument();
    expect(screen.getByTestId("world-faction-0-relations")).toBeInTheDocument();
  });

  it("typing into faction fields then '确认修改并继续' persists the faction data", async () => {
    (api.generateWorld as ReturnType<typeof vi.fn>).mockResolvedValue({
      era: "古代",
      geography: "中原",
      power_systems: [{ name: "", description: "", stages: [], core_rules: [], ceilings: [] }],
      factions: [],
      core_rules: [],
    });
    (api.updateWorld as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    setup();
    await screen.findByTestId("world-form");
    await act(async () => {
      screen.getByTestId("world-faction-add").click();
    });
    await act(async () => {
      fireEvent.change(screen.getByTestId("world-faction-0-name"), { target: { value: "青云宗" } });
      fireEvent.change(screen.getByTestId("world-faction-0-type"), { target: { value: "修仙门派" } });
      fireEvent.change(screen.getByTestId("world-faction-0-goal"), { target: { value: "飞升" } });
      fireEvent.change(screen.getByTestId("world-faction-0-relations"), { target: { value: "与魔道对立" } });
    });
    await act(async () => {
      screen.getByTestId("wizard-next").click();
    });
    await waitFor(() => expect(api.updateWorld).toHaveBeenCalledTimes(1));
    const call = (api.updateWorld as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[1].factions).toEqual([
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
    expect(screen.getByTestId("world-faction-1")).toBeInTheDocument();
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
    // era_social_structure is coerced to a JSON string (contains the keys).
    const social = screen.getByTestId("world-era-social-structure") as HTMLTextAreaElement;
    expect(social.value).toContain("人类阶层");
    expect(social.value).toContain("军阀");
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
    expect(screen.getByTestId("world-power-system-0-regenerate")).toBeInTheDocument();
    expect(screen.getByTestId("world-power-system-0-remove")).toBeInTheDocument();
    // The section-level regenerate button still exists for full-array regen.
    expect(screen.getByTestId("world-power-system-regenerate")).toBeInTheDocument();
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
    await act(async () => {
      screen.getByTestId("world-power-system-0-regenerate").click();
    });
    await act(async () => {
      screen.getByTestId("regenerate-modal-confirm").click();
    });
    await waitFor(() => expect(api.regeneratePowerSystemItem).toHaveBeenCalledTimes(1));
    expect((screen.getByTestId("world-power-system-0-name") as HTMLInputElement).value).toBe("灵力（新）");
    expect((screen.getByTestId("world-power-system-1-name") as HTMLInputElement).value).toBe("武道");
  });
});
