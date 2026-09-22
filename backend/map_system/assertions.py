"""地图一致性校验规则 — 9 条纯 deterministic 断言函数(PRD §9.1/9.2/9.3)。

所有规则不调用 LLM,给定 (map_data, scene_context) 输入,返回 RuleResult 列表。
调用方(ReviewerAgent.check_7_geo_*)负责把 RuleResult 包装为 CheckResult(kind=...)。

Blocker 规则(fail → circuit breaker retry):
  - geo.no_implicit_teleport: 角色移动后 from→to 无 route 可达
  - geo.forbidden_access: 角色进入 accessible=false 的 location 且缺 enter_conditions 解除记录
  - geo.time_budget_exceeded: 单章累计移动耗时 > outline 该章 time_budget

Warning 规则(fail → 仅写日志+仪表盘):
  - geo.distance_unrealistic: est_travel_minutes 与 distance_tier 数量级不匹配
  - geo.climate_mismatch: writer 描述的天气与 region.climate 矛盾
  - geo.density_high: 单章新增 location 数 > settings.chapter_new_location_cap

Info 规则(fail → 仅仪表盘,不打扰作者):
  - geo.alias_added: 新 alias 映射到 canonical location
  - geo.faction_attitude_shift: location.factions 态度与 world.factions 描述不一致
  - geo.poi_discovered: POI 自由文本提及但 first_discovered_chapter=null
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal


RuleKind = Literal["blocker", "warning", "info"]


@dataclass
class RuleResult:
    """单条断言规则的执行结果。ReviewerAgent.check_7_geo_* 把它包装为 CheckResult。

    Fields:
        kind: blocker | warning | info — 决定是否阻熔断器
        code: 规则 ID,如 "geo.no_implicit_teleport"
        message: 人类可读的失败原因(passed=True 时为空字符串)
        evidence: 现场数据 dict — 不同规则 key 不同,由调用方自行填充
    """
    kind: RuleKind
    code: str
    message: str
    evidence: dict = field(default_factory=dict)