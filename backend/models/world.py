import json
from typing import Optional
from pydantic import BaseModel, Field, field_validator, model_validator


class PowerSystem(BaseModel):
    name: str = ""
    description: str = ""
    stages: list[str] = []
    core_rules: list[str] = []
    ceilings: list[str] = []
    cost_system: Optional[str] = None

    @field_validator("stages", mode="before")
    @classmethod
    def _coerce_stages(cls, v):
        # proj_ec67d3e2: the LLM ignored the schema's `stages: [string]`
        # and produced a nested object like {"人道阶": [...], "地道阶": [...]}.
        # The wizard's TagEditor expects a flat string array, so we flatten
        # to keep the form renderable. JSON-stringify anything else.
        if v is None:
            return []
        if isinstance(v, list):
            return [str(x) for x in v if x is not None]
        if isinstance(v, dict):
            flat: list[str] = []
            for value in v.values():
                if isinstance(value, list):
                    flat.extend(str(x) for x in value if x is not None)
                else:
                    flat.append(str(value))
            return flat
        if isinstance(v, str):
            return [v]
        return []


class Faction(BaseModel):
    name: str = ""
    type: str = ""
    goal: str = ""
    relations: str = ""


class WorldRulesSummary(BaseModel):
    name: str = ""
    ceilings: list[str] = []
    core_rules: list[str] = []

    @classmethod
    def from_world(cls, world: "World") -> "WorldRulesSummary":
        # A world can define several power systems; the summary flattens them
        # into one set of rules because its consumers treat the world's limits
        # as a single constraint space.
        return cls(
            name=" / ".join(ps.name for ps in world.power_systems if ps.name),
            ceilings=_dedupe(c for ps in world.power_systems for c in ps.ceilings),
            core_rules=_dedupe(r for ps in world.power_systems for r in ps.core_rules),
        )


def _dedupe(items) -> list[str]:
    """Order-preserving de-duplication. Two power systems often share a rule
    (e.g. "灵气有限"); repeating it in a prompt wastes tokens and reads oddly."""
    seen: set[str] = set()
    out: list[str] = []
    for item in items:
        text = str(item)
        if text not in seen:
            seen.add(text)
            out.append(text)
    return out


def iter_power_systems(world: Optional[dict]) -> list[dict]:
    """Read power systems out of a raw world.json dict.

    Tolerates both the current `power_systems` array and the legacy single
    `power_system` object. Stage 3/4 load world.json as a bare dict without
    going through `World.model_validate`, so files that predate the migration
    are still live on those paths.
    """
    if not isinstance(world, dict):
        return []
    systems = world.get("power_systems")
    if isinstance(systems, list):
        return [ps for ps in systems if isinstance(ps, dict) and any(ps.values())]
    legacy = world.get("power_system")
    if isinstance(legacy, dict):
        return [legacy] if any(legacy.values()) else []
    if isinstance(legacy, str) and legacy:
        # Some very old projects stored the system as a bare name.
        return [{"name": legacy}]
    return []


class World(BaseModel):
    era: str = ""
    geography: str = ""
    era_social_structure: Optional[str] = None  # v1.8 [新增] 社会结构
    era_cultural_history: Optional[str] = None  # v1.8 [新增] 历史文化
    power_systems: list[PowerSystem] = Field(default_factory=list)
    factions: list[Faction] = []
    core_rules: list[str] = []

    @model_validator(mode="before")
    @classmethod
    def _migrate_singular_power_system(cls, data):
        # `power_system` (a single object) became `power_systems` (a list).
        # Existing world.json files on disk still carry the old key, so fold
        # it forward here — every read/write that goes through this model
        # (GET/PUT /world, generate-world) migrates the file in place. An
        # explicit `power_systems` always wins; a blank legacy object is
        # dropped rather than rendered as an empty card in the wizard.
        if not isinstance(data, dict):
            return data
        if data.get("power_systems") is not None:
            data = {k: v for k, v in data.items() if k != "power_system"}
            return data
        legacy = data.get("power_system")
        data = {k: v for k, v in data.items() if k != "power_system"}
        if isinstance(legacy, dict) and any(legacy.values()):
            data["power_systems"] = [legacy]
        elif isinstance(legacy, str) and legacy:
            data["power_systems"] = [{"name": legacy}]
        return data

    @field_validator("era_social_structure", "era_cultural_history", mode="before")
    @classmethod
    def _coerce_optional_str(cls, v):
        # proj_ec67d3e2: LLM ignored the string schema and produced nested
        # objects (e.g. {"人类阶层": "...", "异类阶层": "..."}). Coerce to a
        # JSON string so the wizard's <textarea value={...}> renders without
        # React throwing. The user can then edit / regenerate.
        if v is None:
            return None
        if isinstance(v, str):
            return v
        if isinstance(v, (dict, list)):
            return json.dumps(v, ensure_ascii=False, indent=2)
        return str(v)
