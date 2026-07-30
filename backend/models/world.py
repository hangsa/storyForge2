import json
from typing import Optional
from pydantic import BaseModel, Field, field_validator


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
        return cls(
            name=world.power_system.name,
            ceilings=world.power_system.ceilings,
            core_rules=world.power_system.core_rules,
        )


class World(BaseModel):
    era: str = ""
    geography: str = ""
    era_social_structure: Optional[str] = None  # v1.8 [新增] 社会结构
    era_cultural_history: Optional[str] = None  # v1.8 [新增] 历史文化
    power_system: PowerSystem = Field(default_factory=PowerSystem)
    factions: list[Faction] = []
    core_rules: list[str] = []

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
