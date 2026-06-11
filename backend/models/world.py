from typing import Optional
from pydantic import BaseModel, Field


class PowerSystem(BaseModel):
    name: str = ""
    description: str = ""
    stages: list[str] = []
    core_rules: list[str] = []
    ceilings: list[str] = []
    cost_system: Optional[str] = None


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
    power_system: PowerSystem = Field(default_factory=PowerSystem)
    factions: list[Faction] = []
    core_rules: list[str] = []
