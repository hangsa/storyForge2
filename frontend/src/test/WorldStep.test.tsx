import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";

vi.mock("../api/client", () => ({
  default: {
    generateWorld: vi.fn(),
    updateWorld: vi.fn(),
  },
}));

import api from "../api/client";
import { WizardProvider } from "../components/wizard/WizardContext";
import WorldStep from "../components/wizard/WorldStep";

beforeEach(() => {
  (api.generateWorld as ReturnType<typeof vi.fn>).mockReset();
  (api.updateWorld as ReturnType<typeof vi.fn>).mockReset();
  sessionStorage.clear();
});

function setup() {
  return render(
    <WizardProvider projectId="proj_x">
      <WorldStep projectId="proj_x" />
    </WizardProvider>
  );
}

describe("WorldStep", () => {
  it("renders idle state with '开始生成' button", () => {
    setup();
    expect(screen.getByTestId("world-step")).toBeInTheDocument();
    expect(screen.getByTestId("world-start")).toBeInTheDocument();
  });

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
    await act(async () => {
      screen.getByTestId("world-start").click();
    });
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
    await act(async () => {
      screen.getByTestId("world-start").click();
    });
    expect(await screen.findByTestId("world-form")).toBeInTheDocument();
    expect((screen.getByTestId("world-era-social-structure") as HTMLTextAreaElement).value).toBe("");
    expect((screen.getByTestId("world-era-cultural-history") as HTMLTextAreaElement).value).toBe("");
  });

  it("'下一步' calls updateWorld and persists the new fields", async () => {
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
    await act(async () => {
      screen.getByTestId("world-start").click();
    });
    await screen.findByTestId("world-form");
    await act(async () => {
      screen.getByTestId("world-next").click();
    });
    expect(api.updateWorld).toHaveBeenCalledTimes(1);
    const call = (api.updateWorld as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[1].era_social_structure).toBe("分封制");
    expect(call[1].era_cultural_history).toBe("百家争鸣");
  });
});
