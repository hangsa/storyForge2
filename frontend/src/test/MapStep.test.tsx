import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { WizardProvider } from "../components/wizard/WizardContext";
import MapStep from "../components/wizard/MapStep";
import api from "../api/client";

vi.mock("../api/client", () => ({
  default: {
    getMap: vi.fn().mockResolvedValue({}),
    generateMap: vi.fn().mockResolvedValue({}),
    updateMap: vi.fn().mockResolvedValue(undefined),
  },
}));

beforeEach(() => {
  sessionStorage.clear();
  vi.clearAllMocks();
});

describe("MapStep empty state (no map generated yet)", () => {
  it("renders empty-state with material icon and generate button when no map", () => {
    render(
      <WizardProvider projectId="proj_x">
        <MapStep projectId="proj_x" />
      </WizardProvider>,
    );
    expect(screen.getByTestId("map-step-empty")).toBeInTheDocument();
    expect(screen.getByTestId("map-generate")).toBeInTheDocument();
    // Old placeholder copy is gone — replaced by the new design.
    expect(screen.queryByText(/即将推出/)).not.toBeInTheDocument();
    expect(screen.queryByTestId("map-skip")).not.toBeInTheDocument();
  });

  it("calls api.generateMap when the generate button is pressed", async () => {
    (api.generateMap as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      detail: {
        schema_version: "1.0",
        project_id: "proj_x",
        regions: [],
        locations: [],
        routes: [],
        pois: [],
        location_states: [],
        snapshots: [],
        footprints: [],
        assertions: [],
        settings: {
          mode: "allow_alias_new",
          scope_enabled: false,
          allowed_region_ids: [],
          chapter_new_location_cap: 3,
          reuse_rate_target: 0.6,
          strict_geo: false,
        },
      },
    });
    render(
      <WizardProvider projectId="proj_x">
        <MapStep projectId="proj_x" />
      </WizardProvider>,
    );
    screen.getByTestId("map-generate").click();
    await Promise.resolve();
    expect(api.generateMap).toHaveBeenCalledWith("proj_x", "");
  });
});