import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { WizardProvider } from "../components/wizard/WizardContext";
import MapStep from "../components/wizard/MapStep";
import api from "../api/client";

const SAMPLE_MAP = {
  schema_version: "1.0" as const,
  project_id: "proj_test",
  regions: [],
  locations: [
    {
      id: "loc_a",
      name: "黑水镇北门",
      aliases: [],
      type: "city" as const,
      region_id: null,
      pos_hint: "黑水镇北侧城墙豁口",
      tags: [],
      factions: [],
      enter_conditions: [],
      secrets: [],
      dramatic_role: {
        wanted_by: ["faction_漕帮"],
        decisions_unlocked: ["加入漕帮"],
        departure_cost: "暴露行踪",
      },
      space_type: "world" as const,
      display_pos: null,
    },
  ],
  routes: [],
  pois: [],
  location_states: [],
  snapshots: [],
  footprints: [],
  assertions: [],
  change_log: [],
  display: { positions: {} },
  settings: {
    mode: "allow_alias_new" as const,
    scope_enabled: false,
    allowed_region_ids: [],
    chapter_new_location_cap: 5,
    reuse_rate_target: 0.6,
    strict_geo: false,
  },
};

vi.mock("../api/client", () => ({
  default: {
    getMap: vi.fn().mockResolvedValue({}),
    generateMap: vi.fn().mockResolvedValue({}),
    updateMap: vi.fn().mockResolvedValue(undefined),
    patchMapLocation: vi.fn().mockImplementation(async (_p, _id, patch) => ({
      ...SAMPLE_MAP.locations[0],
      ...patch,
    })),
    deleteMapLocation: vi.fn().mockResolvedValue({ deleted_id: "loc_a" }),
    getMapSnapshots: vi.fn().mockResolvedValue([]),
    rollbackMap: vi.fn().mockResolvedValue({
      chapter: 3,
      restored_locations: 12,
      restored_routes: 5,
    }),
  },
}));

beforeEach(() => {
  sessionStorage.clear();
  vi.clearAllMocks();
  // Default factory mocks (cleared by clearAllMocks above) — empty-state tests
  // rely on the factory default `{}`. locations-tab tests override per-test below.
  (api.getMap as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({});
  (api.generateMap as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({});
  (api.updateMap as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
  (api.getMapSnapshots as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([]);
  (api.rollbackMap as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
    chapter: 3,
    restored_locations: 12,
    restored_routes: 5,
  });
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

describe("MapStep locations tab", () => {
  function renderMapStep() {
    (api.getMap as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(SAMPLE_MAP);
    return render(
      <WizardProvider projectId="proj_test">
        <MapStep projectId="proj_test" />
      </WizardProvider>,
    );
  }

  it("renders location cards with dramatic role", async () => {
    renderMapStep();
    await waitFor(() =>
      expect(screen.getByTestId("map-step")).toBeInTheDocument(),
    );
    expect(screen.getByTestId("location-row-黑水镇北门")).toBeInTheDocument();
    expect(screen.getByText("加入漕帮")).toBeInTheDocument();
  });

  it("supports deleting a location via trash icon", async () => {
    renderMapStep();
    await waitFor(() =>
      expect(screen.getByTestId("map-step")).toBeInTheDocument(),
    );
    const delBtn = screen.getByTestId("location-delete-loc_a");
    fireEvent.click(delBtn);
    await waitFor(() => {
      expect(screen.queryByTestId("location-row-黑水镇北门")).not.toBeInTheDocument();
    });
  });
});

describe("MapStep main flow (reloaded mock)", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("shows generate button when no map exists", async () => {
    vi.doMock("../api/client", () => ({
      default: {
        getMap: vi.fn().mockResolvedValue({}),
        generateMap: vi.fn().mockResolvedValue({ detail: SAMPLE_MAP }),
        updateMap: vi.fn(),
      },
    }));
    const { default: MapStepFresh } = await import("../components/wizard/MapStep");
    const { WizardProvider: WizardProviderFresh } = await import(
      "../components/wizard/WizardContext"
    );
    render(
      <WizardProviderFresh projectId="proj_empty">
        <MapStepFresh projectId="proj_empty" />
      </WizardProviderFresh>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("map-generate")).toBeInTheDocument(),
    );
  });

  it("switches tabs after generation", async () => {
    vi.doMock("../api/client", () => ({
      default: {
        getMap: vi.fn().mockResolvedValue(SAMPLE_MAP),
        updateMap: vi.fn(),
      },
    }));
    const { default: MapStepFresh } = await import("../components/wizard/MapStep");
    const { WizardProvider: WizardProviderFresh } = await import(
      "../components/wizard/WizardContext"
    );
    render(
      <WizardProviderFresh projectId="proj_x">
        <MapStepFresh projectId="proj_x" />
      </WizardProviderFresh>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("map-step")).toBeInTheDocument(),
    );
    expect(screen.getByTestId("map-panel-locations")).toBeInTheDocument();
  });
});

describe("MapStep multi-tab coverage", () => {
  function renderMapStep() {
    (api.getMap as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(SAMPLE_MAP);
    return render(
      <WizardProvider projectId="proj_test">
        <MapStep projectId="proj_test" />
      </WizardProvider>,
    );
  }

  it("renders regions tab when activated", async () => {
    renderMapStep();
    await waitFor(() =>
      expect(screen.getByTestId("map-step")).toBeInTheDocument(),
    );
    const regionsTab = screen.getByText("区域");
    fireEvent.click(regionsTab);
    expect(screen.getByTestId("regions-list")).toBeInTheDocument();
  });

  it("renders routes tab when activated", async () => {
    renderMapStep();
    await waitFor(() =>
      expect(screen.getByTestId("map-step")).toBeInTheDocument(),
    );
    const routesTab = screen.getByText("路线");
    fireEvent.click(routesTab);
    expect(screen.getByTestId("routes-list")).toBeInTheDocument();
  });

  it("renders POIs tab when activated", async () => {
    renderMapStep();
    await waitFor(() =>
      expect(screen.getByTestId("map-step")).toBeInTheDocument(),
    );
    const poisTab = screen.getByText("POI");
    fireEvent.click(poisTab);
    expect(screen.getByTestId("pois-list")).toBeInTheDocument();
  });

  it("renders snapshots tab when activated", async () => {
    renderMapStep();
    await waitFor(() =>
      expect(screen.getByTestId("map-step")).toBeInTheDocument(),
    );
    const snapshotsTab = screen.getByText("快照");
    fireEvent.click(snapshotsTab);
    await waitFor(() =>
      expect(api.getMapSnapshots).toHaveBeenCalled(),
    );
    // Empty list shows the "暂无快照" copy instead of <ul>:
    expect(screen.queryByTestId("snapshots-list")).not.toBeInTheDocument();
    expect(screen.getByText("暂无快照")).toBeInTheDocument();
  });
});

describe("MapStep snapshots tab", () => {
  function renderMapStep() {
    (api.getMap as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(SAMPLE_MAP);
    return render(
      <WizardProvider projectId="proj_test">
        <MapStep projectId="proj_test" />
      </WizardProvider>,
    );
  }

  it("lists snapshots with rollback buttons per row", async () => {
    (api.getMapSnapshots as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      {
        chapter: 3,
        created_at: "2026-09-20T10:00:00Z",
        snapshot_hash: "abc1234567ab",
        locations_count: 12,
        routes_count: 5,
      },
      {
        chapter: 7,
        created_at: "2026-09-21T15:00:00Z",
        snapshot_hash: "def4567890cd",
        locations_count: 14,
        routes_count: 6,
      },
    ]);

    renderMapStep();
    await waitFor(() =>
      expect(screen.getByTestId("map-step")).toBeInTheDocument(),
    );
    const snapshotsTab = screen.getByText("快照");
    fireEvent.click(snapshotsTab);

    await waitFor(() =>
      expect(screen.getByTestId("snapshots-list")).toBeInTheDocument(),
    );
    expect(screen.getByTestId("snapshot-row-3")).toBeInTheDocument();
    expect(screen.getByTestId("snapshot-row-7")).toBeInTheDocument();
    expect(screen.getByText("12 地 / 5 路")).toBeInTheDocument();
    expect(screen.getByText("14 地 / 6 路")).toBeInTheDocument();
    expect(screen.getAllByTestId(/^rollback-\d+$/)).toHaveLength(2);
  });

  it("opens rollback confirm modal and calls api.rollbackMap on confirm", async () => {
    (api.getMapSnapshots as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      {
        chapter: 3,
        created_at: "2026-09-20T10:00:00Z",
        snapshot_hash: "abc1234567ab",
        locations_count: 12,
        routes_count: 5,
      },
    ]);

    renderMapStep();
    await waitFor(() =>
      expect(screen.getByTestId("map-step")).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByText("快照"));

    await waitFor(() =>
      expect(screen.getByTestId("snapshot-row-3")).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByTestId("rollback-3"));

    await waitFor(() =>
      expect(screen.getByTestId("rollback-confirm-modal")).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByTestId("rollback-confirm"));

    await waitFor(() =>
      expect(api.rollbackMap).toHaveBeenCalledWith("proj_test", 3),
    );
  });
});