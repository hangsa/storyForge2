import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("../api/client", () => ({
  default: {
    regenerateWorldSection: vi.fn(),
    regeneratePowerSystemItem: vi.fn(),
    updateWorld: vi.fn(),
  },
}));

import api from "../api/client";
import { ToastProvider, useToast } from "../hooks/useToast";
import WorldEditor from "../components/workspace/editors/WorldEditor";

const SEED = {
  era: "原时代",
  geography: "原地理",
  era_social_structure: "原社会",
  era_cultural_history: "原文化",
  power_systems: [
    { name: "灵力", description: "原灵力", stages: [], core_rules: [], ceilings: [], cost_system: "" },
  ],
  core_rules: ["原规则"],
  factions: [{ name: "原阵营", type: "", goal: "", relations: "" }],
};

// ToastRecorder pattern (same as ConceptEditor.workspace.test.tsx) so we can
// read the same context the production code uses — avoids brittle hook mocks.
function ToastRecorder({ onShow }: { onShow: (messages: string[]) => void }) {
  const { toasts } = useToast();
  onShow(toasts.map((t) => t.message));
  return <div data-testid="toast-snapshot">{toasts.length}</div>;
}

function renderWithToast(
  node: React.ReactElement,
  onShow: (messages: string[]) => void,
) {
  return render(
    <ToastProvider>
      <ToastRecorder onShow={onShow} />
      {node}
    </ToastProvider>,
  );
}

beforeEach(() => {
  (api.regenerateWorldSection as ReturnType<typeof vi.fn>).mockReset();
  (api.regeneratePowerSystemItem as ReturnType<typeof vi.fn>).mockReset();
  (api.updateWorld as ReturnType<typeof vi.fn>).mockReset();
});

describe("WorldEditor regenerate", () => {
  it("renders 4 section regenerate buttons + 1 per power-system card", () => {
    renderWithToast(<WorldEditor projectId="p1" data={SEED} onSaved={() => {}} />, () => {});
    expect(screen.getByTestId("section-regenerate-era")).toBeInTheDocument();
    expect(screen.getByTestId("section-regenerate-power_system")).toBeInTheDocument();
    expect(screen.getByTestId("section-regenerate-core_rules")).toBeInTheDocument();
    expect(screen.getByTestId("section-regenerate-factions")).toBeInTheDocument();
    expect(screen.getByTestId("section-regenerate-power-system-0")).toBeInTheDocument();
  });

  it("clicking era regenerate calls API with section=era and merges result into local state", async () => {
    (api.regenerateWorldSection as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...SEED,
      era: "新时代",
    });
    renderWithToast(<WorldEditor projectId="p1" data={SEED} onSaved={() => {}} />, () => {});

    fireEvent.click(screen.getByTestId("section-regenerate-era"));
    fireEvent.click(screen.getByTestId("regenerate-modal-confirm"));

    await waitFor(() =>
      expect(api.regenerateWorldSection).toHaveBeenCalledWith("p1", "era", ""),
    );
    await waitFor(() =>
      expect((screen.getByTestId("world-era") as HTMLTextAreaElement).value).toBe("新时代"),
    );
  });

  it("clicking power-system card regenerate calls regeneratePowerSystemItem with index 0", async () => {
    (api.regeneratePowerSystemItem as ReturnType<typeof vi.fn>).mockResolvedValue({
      system_index: 0,
      power_system: { name: "新灵力", description: "新", stages: [], core_rules: [], ceilings: [], cost_system: "" },
      world: { ...SEED, power_systems: [{ name: "新灵力", description: "新", stages: [], core_rules: [], ceilings: [], cost_system: "" }] },
    });
    renderWithToast(<WorldEditor projectId="p1" data={SEED} onSaved={() => {}} />, () => {});

    fireEvent.click(screen.getByTestId("section-regenerate-power-system-0"));
    fireEvent.click(screen.getByTestId("regenerate-modal-confirm"));

    await waitFor(() =>
      expect(api.regeneratePowerSystemItem).toHaveBeenCalledWith("p1", 0, ""),
    );
    await waitFor(() =>
      expect((screen.getByTestId("world-power-0-name") as HTMLInputElement).value).toBe("新灵力"),
    );
  });

  it("readOnly=true hides all regenerate buttons", () => {
    renderWithToast(<WorldEditor projectId="p1" data={SEED} onSaved={() => {}} readOnly />, () => {});
    expect(screen.queryByTestId("section-regenerate-era")).not.toBeInTheDocument();
    expect(screen.queryByTestId("section-regenerate-power_system")).not.toBeInTheDocument();
    expect(screen.queryByTestId("section-regenerate-core_rules")).not.toBeInTheDocument();
    expect(screen.queryByTestId("section-regenerate-factions")).not.toBeInTheDocument();
    expect(screen.queryByTestId("section-regenerate-power-system-0")).not.toBeInTheDocument();
  });
});