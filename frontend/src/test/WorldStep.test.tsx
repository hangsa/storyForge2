import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("../api/client", () => ({
  default: {
    generateWorld: vi.fn(),
    updateWorld: vi.fn(),
    getConcept: vi.fn(),
    getWorld: vi.fn(),
    getCharacter: vi.fn(),
    getNovelOutline: vi.fn(),
    getOutline: vi.fn(),
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
    <MemoryRouter>
      <InitWizardModal projectId={PROJECT} onDismiss={vi.fn()} />
    </MemoryRouter>,
  );
}

describe("WorldStep", () => {
  it("completed state shows both new fields with [新增] accent", async () => {
    (api.generateWorld as ReturnType<typeof vi.fn>).mockResolvedValue({
      era: "古代",
      geography: "中原",
      era_social_structure: "分封制",
      era_cultural_history: "百家争鸣",
      power_system: { name: "X", description: "", stages: [], core_rules: [], ceilings: [] },
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
      power_system: { name: "X", description: "", stages: [], core_rules: [], ceilings: [] },
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
      power_system: { name: "X", description: "", stages: [], core_rules: [], ceilings: [] },
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
      power_system: {
        name: "灵力",
        description: "",
        stages: ["炼气", "筑基"],
        core_rules: ["天地灵气有限"],
        ceilings: ["最高元婴"],
      },
      factions: [],
      core_rules: ["弱肉强食"],
    });
    setup();
    await screen.findByTestId("world-form");
    expect(screen.getByTestId("world-power-stages")).toBeInTheDocument();
    expect(screen.getByTestId("world-power-rules")).toBeInTheDocument();
    expect(screen.getByTestId("world-power-ceilings")).toBeInTheDocument();
    expect(screen.getByTestId("world-core-rules")).toBeInTheDocument();
    // Each TagEditor renders existing items as buttons.
    expect(screen.getByTestId("world-power-stages").textContent).toContain("炼气");
    expect(screen.getByTestId("world-power-ceilings").textContent).toContain("最高元婴");
    expect(screen.getByTestId("world-core-rules").textContent).toContain("弱肉强食");
  });

  it("renders empty-state copy for factions when none exist", async () => {
    (api.generateWorld as ReturnType<typeof vi.fn>).mockResolvedValue({
      era: "古代",
      geography: "中原",
      power_system: { name: "", description: "", stages: [], core_rules: [], ceilings: [] },
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
      power_system: { name: "", description: "", stages: [], core_rules: [], ceilings: [] },
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
      power_system: { name: "", description: "", stages: [], core_rules: [], ceilings: [] },
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
      power_system: { name: "", description: "", stages: [], core_rules: [], ceilings: [] },
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
});
