import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
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
    regenerateFaction: vi.fn(),
  },
}));

import api from "../api/client";
import InitWizardModal from "../components/wizard/InitWizardModal";
import { getSessionKey } from "../components/wizard/WizardContext";

const PROJECT = "proj_x";
const KEY = getSessionKey(PROJECT);

beforeEach(() => {
  Object.values(api).forEach((fn) => (fn as ReturnType<typeof vi.fn>).mockReset?.());
  sessionStorage.clear();
});

function setupWithWorld(world: object) {
  sessionStorage.setItem(
    KEY,
    JSON.stringify({
      currentStep: 2,
      completedSteps: [1],
      status: "idle",
      data: {
        concept: { title: "T", genre: "cool_novel", premise: "", tone: "", theme: "", target_audience: "", style_template: "" },
        story_dna: { core_contradiction: { statement: "", side_a: "", side_b: "" }, value_stack: [] },
        world, characters: null, novel_outline: null, chapter1_outline: null,
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

describe("WorldStep sub-tab state memory", () => {
  it("remembers active sub-tab across top-level tab switch", async () => {
    setupWithWorld({
      era: "古代",
      geography: "中原",
      era_social_structure: "分封制",
      era_cultural_history: "百家争鸣",
      power_systems: [
        { name: "灵力", source: "energetics", description: "", stages: [], core_rules: [], ceilings: [] },
        { name: "武道", source: "energetics", description: "", stages: [], core_rules: [], ceilings: [] },
      ],
      factions: [
        { name: "天机阁", type: "", goal: "", relations: "" },
      ],
      core_rules: [{ category: "physical", text: "灵气存在" }],
    });

    // 默认 active 顶级 tab = era, active sub-tab 应是 era 字段 (Task 6 决定具体顺序)
    expect((await screen.findByTestId("world-tab-era-subtab-era")).getAttribute("aria-selected")).toBe("true");

    // 切到 era 第 2 个 sub-tab (geography)
    fireEvent.click(screen.getByTestId("world-tab-era-subtab-geography"));
    expect(screen.getByTestId("world-tab-era-subtab-geography").getAttribute("aria-selected")).toBe("true");

    // 切到顶级 tab power_system
    fireEvent.click(screen.getByTestId("world-tab-power_system"));
    expect(screen.getByTestId("world-tab-power_system").getAttribute("aria-selected")).toBe("true");

    // 切回顶级 tab era
    fireEvent.click(screen.getByTestId("world-tab-era"));
    // active sub-tab 应仍是 geography (记忆)
    expect(screen.getByTestId("world-tab-era-subtab-geography").getAttribute("aria-selected")).toBe("true");
  });
});

describe("WorldStep EraPanel sub-tabs", () => {
  it("renders 4 fixed sub-tabs with correct labels and testids", async () => {
    setupWithWorld({
      era: "",
      geography: "",
      era_social_structure: "",
      era_cultural_history: "",
      power_systems: [],
      factions: [],
      core_rules: [],
    });
    await screen.findByTestId("world-tab-era-subtab-era");
    expect(screen.getByTestId("world-tab-era-subtab-era")).toBeInTheDocument();
    expect(screen.getByTestId("world-tab-era-subtab-geography")).toBeInTheDocument();
    expect(screen.getByTestId("world-tab-era-subtab-social-structure")).toBeInTheDocument();
    expect(screen.getByTestId("world-tab-era-subtab-cultural-history")).toBeInTheDocument();
  });

  it("era sub-tab ↻ calls /regenerate-world-section with field", async () => {
    setupWithWorld({
      era: "古代",
      geography: "中原",
      era_social_structure: "",
      era_cultural_history: "",
      power_systems: [],
      factions: [],
      core_rules: [],
    });
    await screen.findByTestId("world-tab-era-subtab-era");

    (api.regenerateWorldSection as ReturnType<typeof vi.fn>).mockResolvedValue({
      era: "新古代",
      geography: "新中原",
      era_social_structure: "",
      era_cultural_history: "",
      power_systems: [],
      factions: [],
      core_rules: [],
    });

    fireEvent.click(screen.getByTestId("world-tab-era-subtab-era-regenerate"));
    await vi.waitFor(() => {
      expect(api.regenerateWorldSection).toHaveBeenCalledWith(
        expect.any(String),
        "era",
        "",
        { field: "era" },
      );
    });
  });
});