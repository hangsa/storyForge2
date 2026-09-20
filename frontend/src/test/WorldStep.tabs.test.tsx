import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
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

describe("WorldStep tab strip", () => {
  it("renders 4 tabs with icon, label, count, regenerate icon", async () => {
    (api.generateWorld as ReturnType<typeof vi.fn>).mockResolvedValue({
      era: "古代",
      geography: "中原",
      power_systems: [{ name: "灵力", description: "", stages: [], core_rules: [], ceilings: [] }],
      factions: [],
      core_rules: [],
    });
    setup();
    await screen.findByTestId("world-form");
    expect(screen.getByTestId("world-tabs")).toBeInTheDocument();
    expect(screen.getByTestId("world-tab-era")).toBeInTheDocument();
    expect(screen.getByTestId("world-tab-power_system")).toBeInTheDocument();
    expect(screen.getByTestId("world-tab-core_rules")).toBeInTheDocument();
    expect(screen.getByTestId("world-tab-factions")).toBeInTheDocument();
    expect(screen.getByTestId("world-tab-era-regenerate")).toBeInTheDocument();
    expect(screen.getByTestId("world-tab-power_system-regenerate")).toBeInTheDocument();
    expect(screen.getByTestId("world-tab-core_rules-regenerate")).toBeInTheDocument();
    expect(screen.getByTestId("world-tab-factions-regenerate")).toBeInTheDocument();
  });

  it("marks era tab as selected and others as unselected by default", async () => {
    (api.generateWorld as ReturnType<typeof vi.fn>).mockResolvedValue({
      era: "古代",
      geography: "中原",
      power_systems: [{ name: "灵力", description: "", stages: [], core_rules: [], ceilings: [] }],
      factions: [],
      core_rules: [],
    });
    setup();
    await screen.findByTestId("world-form");
    expect(screen.getByTestId("world-tab-era").getAttribute("aria-selected")).toBe("true");
    expect(screen.getByTestId("world-tab-power_system").getAttribute("aria-selected")).toBe("false");
    expect(screen.getByTestId("world-tab-core_rules").getAttribute("aria-selected")).toBe("false");
    expect(screen.getByTestId("world-tab-factions").getAttribute("aria-selected")).toBe("false");
  });

  it("hides non-active panels with hidden attribute", async () => {
    (api.generateWorld as ReturnType<typeof vi.fn>).mockResolvedValue({
      era: "古代",
      geography: "中原",
      power_systems: [{ name: "灵力", description: "", stages: [], core_rules: [], ceilings: [] }],
      factions: [],
      core_rules: [],
    });
    setup();
    await screen.findByTestId("world-form");
    // Active panel: `hidden` attribute is absent (panel is visible).
    expect(screen.getByTestId("world-panel-era").hasAttribute("hidden")).toBe(false);
    // Inactive panels: `hidden=""` (HTML boolean attribute) is set.
    expect(screen.getByTestId("world-panel-power_system").hasAttribute("hidden")).toBe(true);
    expect(screen.getByTestId("world-panel-core_rules").hasAttribute("hidden")).toBe(true);
    expect(screen.getByTestId("world-panel-factions").hasAttribute("hidden")).toBe(true);
  });

  it("clicking the regenerate span does NOT switch tabs (stopPropagation)", async () => {
    (api.generateWorld as ReturnType<typeof vi.fn>).mockResolvedValue({
      era: "古代",
      geography: "中原",
      power_systems: [],
      factions: [],
      core_rules: [],
    });
    (api.regenerateWorldSection as ReturnType<typeof vi.fn>).mockResolvedValue({
      era: "未来",
      geography: "赛博",
      power_systems: [],
      factions: [],
      core_rules: [],
    });
    setup();
    await screen.findByTestId("world-form");

    // Sanity: era tab is the default active one.
    expect(screen.getByTestId("world-tab-era").getAttribute("aria-selected")).toBe("true");

    // Click the regenerate span (not the outer tab button).
    fireEvent.click(screen.getByTestId("world-tab-era-regenerate"));

    // The RegenerateModal opens; confirm it and verify the API was called.
    await screen.findByTestId("regenerate-modal");
    fireEvent.click(screen.getByTestId("regenerate-modal-confirm"));
    await waitFor(() =>
      expect(api.regenerateWorldSection).toHaveBeenCalledWith(PROJECT, "era", ""),
    );

    // Crucially: the era tab must STILL be the selected one — stopPropagation
    // prevented the click from bubbling to the outer <button role="tab">,
    // so onTabChange was never called. Without stopPropagation the active
    // tab would have changed (the bug this test guards).
    expect(screen.getByTestId("world-tab-era").getAttribute("aria-selected")).toBe("true");
    expect(screen.getByTestId("world-tab-power_system").getAttribute("aria-selected")).toBe("false");
  });

  it("displays count values per tab", async () => {
    (api.generateWorld as ReturnType<typeof vi.fn>).mockResolvedValue({
      era: "古代",
      geography: "中原",
      // 1 power_system, 2 core_rules, 0 factions — fixed "4" for era.
      power_systems: [{ name: "灵力", description: "", stages: [], core_rules: [], ceilings: [] }],
      core_rules: ["凡有灵根者", "逆天而行"],
      factions: [],
    });
    setup();
    await screen.findByTestId("world-form");

    // The count text lives in a `<span aria-label="${n} 个">` — query by the
    // accessible label so we don't depend on text content (other elements
    // could match the same digit string).
    expect(screen.getByLabelText("4 个")).toBeInTheDocument(); // era
    expect(screen.getByLabelText("1 个")).toBeInTheDocument(); // power_system
    expect(screen.getByLabelText("2 个")).toBeInTheDocument(); // core_rules
    expect(screen.getByLabelText("0 个")).toBeInTheDocument(); // factions
  });

  it("ArrowRight on active tab switches to next tab and moves focus", async () => {
    (api.generateWorld as ReturnType<typeof vi.fn>).mockResolvedValue({
      era: "古代", geography: "中原",
      power_systems: [{ name: "灵力", description: "", stages: [], core_rules: [], ceilings: [] }],
      factions: [], core_rules: [],
    });
    setup();
    const eraTab = await screen.findByTestId("world-tab-era");
    eraTab.focus();
    await act(async () => {
      fireEvent.keyDown(eraTab, { key: "ArrowRight" });
    });
    expect(screen.getByTestId("world-tab-power_system")).toHaveAttribute("aria-selected", "true");
    expect(document.activeElement).toBe(screen.getByTestId("world-tab-power_system"));
  });

  it("ArrowLeft on first tab wraps to last tab", async () => {
    (api.generateWorld as ReturnType<typeof vi.fn>).mockResolvedValue({
      era: "古代", geography: "中原",
      power_systems: [{ name: "灵力", description: "", stages: [], core_rules: [], ceilings: [] }],
      factions: [], core_rules: [],
    });
    setup();
    const eraTab = await screen.findByTestId("world-tab-era");
    eraTab.focus();
    await act(async () => {
      fireEvent.keyDown(eraTab, { key: "ArrowLeft" });
    });
    expect(screen.getByTestId("world-tab-factions")).toHaveAttribute("aria-selected", "true");
    expect(document.activeElement).toBe(screen.getByTestId("world-tab-factions"));
  });

  it("CoreRulesPanel renders 4 category groups", async () => {
    (api.generateWorld as ReturnType<typeof vi.fn>).mockResolvedValue({
      era: "古代", geography: "中原",
      power_systems: [],
      core_rules: [
        { category: "physical", text: "灵气存在" },
        { category: "social", text: "灵脉被垄断" },
        { category: "narrative", text: "强者受限" },
        { category: "protagonist", text: "寄体必死" },
      ],
      factions: [],
    });
    setup();
    await screen.findByTestId("world-form");
    // 切到 core_rules tab
    const coreRulesTab = screen.getByTestId("world-tab-core_rules");
    fireEvent.click(coreRulesTab);
    // 4 个 category group 都渲染
    expect(screen.getByTestId("world-core-rules-physical")).toBeInTheDocument();
    expect(screen.getByTestId("world-core-rules-social")).toBeInTheDocument();
    expect(screen.getByTestId("world-core-rules-narrative")).toBeInTheDocument();
    expect(screen.getByTestId("world-core-rules-protagonist")).toBeInTheDocument();
  });

  it("PowerSystemsPanel shows source badge on protagonist_engine cards", async () => {
    (api.generateWorld as ReturnType<typeof vi.fn>).mockResolvedValue({
      era: "古代", geography: "中原",
      power_systems: [
        { name: "灵力", source: "energetics", description: "", core_rules: [], ceilings: [], stages: [] },
        { name: "天道系统", source: "protagonist_engine", description: "", core_rules: [], ceilings: [], stages: [] },
      ],
      factions: [],
      core_rules: [],
    });
    setup();
    await screen.findByTestId("world-form");
    const psTab = screen.getByTestId("world-tab-power_system");
    fireEvent.click(psTab);
    // 2026-09-20 (Task 7): only the active sub-tab's card is rendered. Walk
    // through both sub-tabs to assert the source-badge pattern.
    expect(screen.queryByTestId("world-power-system-0-source-badge")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("world-tab-power-system-subtab-1"));
    expect(screen.getByTestId("world-power-system-1-source-badge")).toBeInTheDocument();
  });
});
