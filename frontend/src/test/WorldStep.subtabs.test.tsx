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

describe("WorldStep PowerSystemsPanel sub-tabs", () => {
  it("renders empty-state CTA when power_systems is empty", async () => {
    setupWithWorld({
      era: "", geography: "", era_social_structure: "", era_cultural_history: "",
      power_systems: [], factions: [], core_rules: [],
    });
    await screen.findByTestId("world-tab-power_system");
    fireEvent.click(screen.getByTestId("world-tab-power_system"));
    expect(screen.getByTestId("world-power-system-empty")).toBeInTheDocument();
    expect(screen.getByTestId("world-power-system-generate-first")).toBeInTheDocument();
    expect(screen.queryByTestId("world-tab-power-system-subtab-0")).not.toBeInTheDocument();
  });

  it("renders N sub-tabs by length, title = stripParenthetical(name)", async () => {
    setupWithWorld({
      era: "", geography: "", era_social_structure: "", era_cultural_history: "",
      power_systems: [
        { name: "阴阳眼·双视观测（非常规主角能力体系）", source: "protagonist_engine", description: "", stages: [], core_rules: [], ceilings: [] },
        { name: "灵力", source: "energetics", description: "", stages: [], core_rules: [], ceilings: [] },
      ],
      factions: [], core_rules: [],
    });
    await screen.findByTestId("world-tab-power_system");
    fireEvent.click(screen.getByTestId("world-tab-power_system"));
    expect(screen.getByTestId("world-tab-power-system-subtab-0")).toBeInTheDocument();
    expect(screen.getByTestId("world-tab-power-system-subtab-1")).toBeInTheDocument();
    // stripParenthetical 把"（非常规主角能力体系）"去掉了
    expect(screen.getByTestId("world-tab-power-system-subtab-0").textContent).toContain("阴阳眼·双视观测");
    expect(screen.getByTestId("world-tab-power-system-subtab-0").textContent).not.toContain("（");
    // 第二个 name 没有括号,保持原样
    expect(screen.getByTestId("world-tab-power-system-subtab-1").textContent).toContain("灵力");
  });

  it("sub-tab ↻ calls regeneratePowerSystemItem with system_index", async () => {
    setupWithWorld({
      era: "", geography: "", era_social_structure: "", era_cultural_history: "",
      power_systems: [
        { name: "A", source: "energetics", description: "", stages: [], core_rules: [], ceilings: [] },
        { name: "B", source: "energetics", description: "", stages: [], core_rules: [], ceilings: [] },
      ],
      factions: [], core_rules: [],
    });
    await screen.findByTestId("world-tab-power_system");
    (api.regeneratePowerSystemItem as ReturnType<typeof vi.fn>).mockResolvedValue({
      system_index: 1,
      power_system: { name: "B", source: "energetics", description: "", stages: [], core_rules: [], ceilings: [] },
      world: {
        era: "", geography: "", era_social_structure: "", era_cultural_history: "",
        power_systems: [
          { name: "A", source: "energetics", description: "", stages: [], core_rules: [], ceilings: [] },
          { name: "B", source: "energetics", description: "", stages: [], core_rules: [], ceilings: [] },
        ],
        factions: [], core_rules: [],
      },
    });
    fireEvent.click(screen.getByTestId("world-tab-power_system"));
    fireEvent.click(screen.getByTestId("world-tab-power-system-subtab-1-regenerate"));
    await vi.waitFor(() => {
      expect(api.regeneratePowerSystemItem).toHaveBeenCalledWith(
        expect.any(String),
        1,
        "",
      );
    });
  });

  it("does not auto-jump active sub-tab on remove", async () => {
    setupWithWorld({
      era: "", geography: "", era_social_structure: "", era_cultural_history: "",
      power_systems: [
        { name: "A", source: "energetics", description: "", stages: [], core_rules: [], ceilings: [] },
        { name: "B", source: "energetics", description: "", stages: [], core_rules: [], ceilings: [] },
      ],
      factions: [], core_rules: [],
    });
    await screen.findByTestId("world-tab-power_system");
    fireEvent.click(screen.getByTestId("world-tab-power_system"));
    // active 默认是 0 (subTab.power_system = "" → fallback 到 "0")
    // 删第 0 个
    fireEvent.click(screen.getByTestId("world-power-system-0-remove"));
    // active sub-tab 仍是 "0"(虽然索引 0 现在指向原 B)
    expect(screen.getByTestId("world-tab-power-system-subtab-0").getAttribute("aria-selected")).toBe("true");
  });
});