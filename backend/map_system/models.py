"""地图数据模型 — Pydantic v2。"""
from typing import Literal, Optional
from pydantic import BaseModel, Field, model_validator


LocationType = Literal["city", "town", "village", "inn", "temple", "sect",
                       "wilds", "room", "starport", "secret_realm"]
RouteKind = Literal["road", "waterway", "tunnel", "portal", "starlane", "secret_path"]
DistanceTier = Literal["intra_city", "inter_city", "inter_region", "inter_continent"]
RiskLevel = Literal["low", "mid", "high"]
RegionLevel = Literal["continent", "state", "sea", "star_sector"]
SpaceType = Literal["world", "room"]
Attitude = Literal["friendly", "hostile", "neutral", "wary"]
AssertionKind = Literal["blocker", "warning", "info"]
ChangeActor = Literal["user", "system", "regenerate_map_section",
                      "sf_log_extraction", "mention_extraction"]
ChangeOp = Literal["create", "update", "delete", "alias_add", "state_change"]


class DisplayPos(BaseModel):
    x: float = 0.0
    y: float = 0.0


class DramaticRole(BaseModel):
    wanted_by: list[str] = []
    decisions_unlocked: list[str] = []
    departure_cost: str = ""


class FactionStance(BaseModel):
    faction_id: str
    attitude: Attitude = "neutral"


class Region(BaseModel):
    id: str = Field(pattern=r"^region_[a-z0-9_]+$")
    name: str
    aliases: list[str] = []
    level: RegionLevel = "state"
    parent_id: Optional[str] = None
    climate: str = ""
    tags: list[str] = []
    controlled_by: list[str] = []   # faction ids
    adjacent_region_ids: list[str] = []
    display_pos: Optional[DisplayPos] = None


class Location(BaseModel):
    id: str = Field(pattern=r"^loc_[a-z0-9_]+$")
    name: str
    aliases: list[str] = []
    type: LocationType
    region_id: Optional[str] = None
    pos_hint: str = ""
    tags: list[str] = []
    factions: list[FactionStance] = []
    enter_conditions: list[str] = []
    secrets: list[str] = []
    dramatic_role: DramaticRole
    space_type: SpaceType = "world"
    display_pos: Optional[DisplayPos] = None


class Route(BaseModel):
    id: str = Field(pattern=r"^route_[a-z0-9_]+$")
    from_id: str = Field(alias="from")
    to_id: str = Field(alias="to")
    bidirectional: bool = True
    kind: RouteKind = "road"
    distance_tier: DistanceTier = "inter_city"
    est_travel_minutes: int = Field(0, ge=0)
    risk: RiskLevel = "low"
    conditions: list[str] = []
    encounters: list[str] = []
    accessible: bool = True


class POI(BaseModel):
    id: str = Field(pattern=r"^poi_[a-z0-9_]+$")
    name: str
    parent_location_id: str
    kind: Literal["shrine", "cache", "crime_scene", "resource", "view", "trap"] = "shrine"
    description: str = ""
    discoverable: bool = True
    first_discovered_chapter: Optional[int] = None
    tags: list[str] = []


class LocationState(BaseModel):
    location_id: str
    chapter: int = Field(ge=1)
    faction_id: Optional[str] = None
    name: Optional[str] = None
    accessible: bool = True
    destroyed: bool = False
    note: str = ""


class SnapshotIndex(BaseModel):
    chapter: int = Field(ge=1)
    map_hash: str
    snapshot_path: str


class Footprint(BaseModel):
    chapter: int = Field(ge=1)
    character_id: str
    location_id: str
    arrived_via: Optional[str] = None
    departed_to: Optional[str] = None
    companions: list[str] = []
    time_of_day: str = ""
    weather: str = ""


class MapAssertion(BaseModel):
    id: str
    chapter: int = Field(ge=1)
    kind: AssertionKind
    rule_id: str
    message: str
    evidence: dict = {}
    resolution: Literal["未处理", "已修复", "用户豁免"] = "未处理"


class MapChange(BaseModel):
    ts: str
    actor: ChangeActor
    chapter: Optional[int] = None
    op: ChangeOp
    entity: Literal["region", "location", "route", "poi", "location_state"]
    entity_id: str
    before: Optional[dict] = None
    after: Optional[dict] = None


class MapSettings(BaseModel):
    mode: Literal["strict_geo", "allow_alias_new", "freeze_locations"] = "allow_alias_new"
    scope_enabled: bool = False
    allowed_region_ids: list[str] = []
    chapter_new_location_cap: int = 5
    reuse_rate_target: float = 0.6
    strict_geo: bool = False   # 向后兼容默认


class DisplayMeta(BaseModel):
    positions: dict[str, DisplayPos] = {}


class Map(BaseModel):
    schema_version: Literal["1.0"]
    project_id: str
    generated_at: str = ""
    generated_from: dict = {}
    regions: list[Region] = []
    locations: list[Location] = []
    routes: list[Route] = []
    pois: list[POI] = []
    location_states: list[LocationState] = []
    snapshots: list[SnapshotIndex] = []
    footprints: list[Footprint] = []
    assertions: list[MapAssertion] = []
    change_log: list[MapChange] = []
    display: DisplayMeta = Field(default_factory=DisplayMeta)
    settings: MapSettings = Field(default_factory=MapSettings)

    @model_validator(mode="after")
    def _validate_references(self):
        loc_ids = {loc.id for loc in self.locations}
        route_pairs = {(r.from_id, r.to_id) for r in self.routes}
        for f, t in route_pairs:
            if f not in loc_ids or t not in loc_ids:
                raise ValueError(
                    f"Route references unknown location: ({f} -> {t})"
                )
        region_ids = {r.id for r in self.regions}
        for loc in self.locations:
            if loc.region_id is not None and loc.region_id not in region_ids:
                raise ValueError(
                    f"Location {loc.id} references unknown region {loc.region_id}"
                )
        for poi in self.pois:
            if poi.parent_location_id not in loc_ids:
                raise ValueError(
                    f"POI {poi.id} references unknown location "
                    f"{poi.parent_location_id}"
                )
        for ls in self.location_states:
            if ls.location_id not in loc_ids:
                raise ValueError(
                    f"LocationState references unknown location {ls.location_id}"
                )
        return self
