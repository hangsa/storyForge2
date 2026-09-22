import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import { MermaidMapModal } from "./MermaidMapModal";
import type { MapPayload } from "../../api/client";

vi.mock("mermaid", () => ({
  default: {
    initialize: vi.fn(),
    render: vi.fn().mockResolvedValue({ svg: "<svg>MOCK</svg>" }),
  },
}));

const SAMPLE_MAP: MapPayload = {
  schema_version: "1.0",
  project_id: "proj_test",
  regions: [
    { id: "region_south", name: "南泽", aliases: [], level: "state",
      parent_id: null, climate: "", tags: [], controlled_by: [],
      adjacent_region_ids: [], display_pos: null },
  ],
  locations: [
    {
      id: "loc_gate", name: "黑水镇北门", aliases: [], type: "city",
      region_id: "region_south", pos_hint: "", tags: [], factions: [],
      enter_conditions: [], secrets: [],
      dramatic_role: { wanted_by: [], decisions_unlocked: [], departure_cost: "" },
      space_type: "world", display_pos: null,
    },
    {
      id: "loc_inn", name: "青峰客栈", aliases: [], type: "inn",
      region_id: "region_south", pos_hint: "", tags: [], factions: [],
      enter_conditions: [], secrets: [],
      dramatic_role: { wanted_by: [], decisions_unlocked: [], departure_cost: "" },
      space_type: "world", display_pos: null,
    },
  ],
  routes: [
    { id: "route_x", from: "loc_gate", to: "loc_inn", bidirectional: true,
      kind: "road", distance_tier: "inter_city", est_travel_minutes: 40,
      risk: "low", conditions: [], encounters: [], accessible: true },
  ],
  pois: [],
  location_states: [],
  snapshots: [],
  footprints: [],
  assertions: [],
  change_log: [],
  display: { positions: {} },
  settings: {
    mode: "allow_alias_new", scope_enabled: false, allowed_region_ids: [],
    chapter_new_location_cap: 5, reuse_rate_target: 0.6, strict_geo: false,
  },
};

describe("MermaidMapModal", () => {
  it("renders mermaid diagram when open", async () => {
    render(
      <MermaidMapModal open={true} onClose={() => {}} mapData={SAMPLE_MAP} />,
    );
    // mermaid.render 是异步,等待 svg 出现
    await new Promise(r => setTimeout(r, 50));
    expect(document.querySelector("svg")).toBeInTheDocument();
  });

  it("does not render when closed", () => {
    render(
      <MermaidMapModal open={false} onClose={() => {}} mapData={SAMPLE_MAP} />,
    );
    expect(screen.queryByTestId("mermaid-modal")).not.toBeInTheDocument();
  });

  it("calls onClose when backdrop clicked", () => {
    const onClose = vi.fn();
    render(
      <MermaidMapModal open={true} onClose={onClose} mapData={SAMPLE_MAP} />,
    );
    fireEvent.click(screen.getByTestId("mermaid-backdrop"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
