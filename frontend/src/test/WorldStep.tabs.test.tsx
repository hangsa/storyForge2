import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
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
});