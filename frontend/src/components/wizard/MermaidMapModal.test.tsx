import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import { MermaidMapModal, buildMermaidSyntax } from "./MermaidMapModal";
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

// ============================================================================
// buildMermaidSyntax pure-function unit tests
// ============================================================================

// Richer fixture covering all the edge cases: middle-dot, quotes, orphan, safe.
const RICH_MAP: MapPayload = {
  schema_version: "1.0",
  project_id: "proj_test",
  regions: [
    { id: "region_south", name: "南泽", aliases: [], level: "state",
      parent_id: null, climate: "", tags: [], controlled_by: [],
      adjacent_region_ids: [], display_pos: null },
    { id: "region_old_town_west", name: "旧城西区·青石巷片", aliases: [],
      level: "state", parent_id: null, climate: "", tags: [],
      controlled_by: [], adjacent_region_ids: [], display_pos: null },
    { id: "region_quoted", name: 'Some "Quoted" Region', aliases: [],
      level: "state", parent_id: null, climate: "", tags: [],
      controlled_by: [], adjacent_region_ids: [], display_pos: null },
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
      id: "loc_old_west", name: "西门巷口", aliases: [], type: "town",
      region_id: "region_old_town_west", pos_hint: "", tags: [],
      factions: [], enter_conditions: [], secrets: [],
      dramatic_role: { wanted_by: [], decisions_unlocked: [], departure_cost: "" },
      space_type: "world", display_pos: null,
    },
    {
      id: "loc_orphan", name: "流浪据点", aliases: [], type: "wilds",
      region_id: null, pos_hint: "", tags: [], factions: [],
      enter_conditions: [], secrets: [],
      dramatic_role: { wanted_by: [], decisions_unlocked: [], departure_cost: "" },
      space_type: "world", display_pos: null,
    },
    {
      id: "loc_quoted_region", name: "Quoted Place", aliases: [], type: "city",
      region_id: "region_quoted", pos_hint: "", tags: [], factions: [],
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

describe("buildMermaidSyntax", () => {
  it("test_build_syntax_uses_region_id_as_subgraph_id", () => {
    const syntax = buildMermaidSyntax(RICH_MAP);
    // Safe-ID region: must use region.id, pass name as display label.
    expect(syntax).toContain('subgraph region_south["南泽"]');
    // Must NOT emit the bare Chinese name as the subgraph id.
    expect(syntax).not.toMatch(/subgraph\s+南泽/);
  });

  it("test_build_syntax_handles_region_name_with_middle_dot", () => {
    // proj_47738f64 broken case: '·' U+00B7 broke lexer before fix.
    const syntax = buildMermaidSyntax(RICH_MAP);
    expect(syntax).toContain('subgraph region_old_town_west["旧城西区·青石巷片"]');
    // Bare-name emission (the original bug) must not occur.
    expect(syntax).not.toMatch(/subgraph\s+旧城西区·青石巷片/);
  });

  it("test_build_syntax_escapes_quotes_in_region_name", () => {
    const syntax = buildMermaidSyntax(RICH_MAP);
    // Quotes must be escaped so they don't break out of the bracket string.
    expect(syntax).toContain('subgraph region_quoted["Some \\"Quoted\\" Region"]');
    // Sanity: the raw unescaped form must not appear.
    expect(syntax).not.toContain('subgraph region_quoted["Some "Quoted" Region"]');
  });

  it("test_build_syntax_uses_orphan_for_locations_without_region", () => {
    const syntax = buildMermaidSyntax(RICH_MAP);
    // Locations with region_id=null land in the "_orphan" bucket.
    expect(syntax).toContain('subgraph _orphan["无区域"]');
    expect(syntax).toContain('loc_orphan["流浪据点"]');
  });

  it("test_build_syntax_preserves_location_node_shape", () => {
    // Regression guard — the existing loc.id["loc.name"] form must still work.
    const syntax = buildMermaidSyntax(RICH_MAP);
    expect(syntax).toContain('loc_gate["黑水镇北门"]');
    expect(syntax).toContain('loc_old_west["西门巷口"]');
  });

  it("test_build_syntax_escapes_close_bracket_in_location_name", () => {
    // Symmetric to the region-name escape: a `]` in loc.name would close
    // the bracket prematurely and break Mermaid lexing.
    const mapWithBracket: MapPayload = {
      ...RICH_MAP,
      locations: [
        {
          id: "loc_bracket", name: "机房[北翼]", aliases: [], type: "room",
          region_id: "region_south", pos_hint: "", tags: [], factions: [],
          enter_conditions: [], secrets: [],
          dramatic_role: { wanted_by: [], decisions_unlocked: [], departure_cost: "" },
          space_type: "world", display_pos: null,
        },
      ],
    };
    const syntax = buildMermaidSyntax(mapWithBracket);
    expect(syntax).toContain('loc_bracket["机房[北翼\\]"]');
    // raw unescaped bracket must NOT appear
    expect(syntax).not.toContain('loc_bracket["机房[北翼]"]');
  });
});
