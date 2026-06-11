import re
from dataclasses import dataclass, field
from typing import Optional

from backend.utils.regex_patterns import (
    SF_LOG_PATTERN,
    PARAM_PATTERN,
    LOCATION_CHANGE_PATTERN,
    POWER_USAGE_PATTERN,
    COST_DECLARATION_PATTERN,
    ASSET_REF_PATTERN,
    VALID_LOG_TYPES,
)


@dataclass
class CheckResult:
    check_id: int
    name: str
    passed: bool
    detail: str = ""


@dataclass
class FactGuardResult:
    all_passed: bool
    checks: list[CheckResult] = field(default_factory=list)
    coherence_score: int = 0
    retry_hints: str = ""


class ReviewerAgent:
    """Fact Guard reviewer. All 5 checks are deterministic — zero LLM calls."""

    def __init__(self, project_id: str):
        self.project_id = project_id

    def run_fact_guard(
        self,
        draft_text: str,
        characters: list[dict],
        world_rules: dict,
        scene_plan: dict,
        storyos_state: Optional[dict] = None,
    ) -> FactGuardResult:
        if storyos_state is None:
            storyos_state = {}

        # Run per-character checks (1 & 2) for each character and aggregate
        timeline_results = []
        char_state_results = []
        for character in characters:
            if not character:
                continue
            timeline_results.append(self.check_1_timeline(draft_text, character))
            char_state_results.append(
                self.check_2_character_state(draft_text, character)
            )

        # Aggregate per-character results: passed only if ALL pass
        merged_timeline = CheckResult(
            check_id=1,
            name="时间线连续性",
            passed=all(r.passed for r in timeline_results),
            detail="\n".join(
                f"  [{character.get('name', '?')}] {r.detail}"
                for r, character in zip(timeline_results, characters)
                if character
            ) if timeline_results else "无角色数据",
        )

        merged_char_state = CheckResult(
            check_id=2,
            name="角色状态一致性",
            passed=all(r.passed for r in char_state_results),
            detail="\n".join(
                f"  [{character.get('name', '?')}] {r.detail}"
                for r, character in zip(char_state_results, characters)
                if character
            ) if char_state_results else "无角色数据",
        )

        checks = [
            merged_timeline,
            merged_char_state,
            self.check_3_world_rules(draft_text, world_rules),
            self.check_4_asset_compliance(draft_text, storyos_state),
            self.check_5_log_completeness(draft_text, scene_plan),
        ]

        all_passed = all(c.passed for c in checks)
        score = self.compute_coherence_score(checks)
        hints = self._generate_retry_hints(checks)

        return FactGuardResult(
            all_passed=all_passed,
            checks=checks,
            coherence_score=score,
            retry_hints=hints,
        )

    # --- Check 1: Timeline continuity ---

    def check_1_timeline(self, draft_text: str, character: dict) -> CheckResult:
        current_location = (
            character.get("current_state", {}).get("location", "")
        )
        changes = LOCATION_CHANGE_PATTERN.findall(draft_text)

        locations_mentioned = [current_location] if current_location else []
        for match in changes:
            char, from_loc, to_loc = match
            locations_mentioned.append(to_loc)

        visited = set()
        sequence_issues = []
        for loc in locations_mentioned:
            if loc in visited:
                sequence_issues.append(f"角色重复出现在'{loc}'")
            visited.add(loc)

        if not changes and not current_location:
            detail = "未能提取到位置信息"
            return CheckResult(
                check_id=1, name="时间线连续性", passed=False, detail=detail
            )

        if sequence_issues:
            return CheckResult(
                check_id=1,
                name="时间线连续性",
                passed=False,
                detail="; ".join(sequence_issues),
            )

        return CheckResult(
            check_id=1,
            name="时间线连续性",
            passed=True,
            detail=f"位置序列正常，共 {len(changes)} 次位置变化",
        )

    # --- Check 2: Character state consistency ---

    def check_2_character_state(
        self, draft_text: str, character: dict
    ) -> CheckResult:
        unknowns = character.get("unknown_to_character", [])
        taboos = character.get("voice_signature", {}).get("taboos", [])
        char_name = character.get("name", "主角")

        violations = []

        for secret in unknowns:
            if not secret.strip():
                continue
            if secret in draft_text:
                violations.append(
                    f"角色'{char_name}'不应知道: '{secret}'，但文本中包含此信息"
                )

        for taboo in taboos:
            if not taboo.strip():
                continue
            if taboo in draft_text:
                violations.append(
                    f"角色'{char_name}'不应执行禁忌行为: '{taboo}'"
                )

        if violations:
            return CheckResult(
                check_id=2,
                name="角色状态一致性",
                passed=False,
                detail="; ".join(violations),
            )

        return CheckResult(
            check_id=2,
            name="角色状态一致性",
            passed=True,
            detail="未发现角色状态违规",
        )

    # --- Check 3: World rules ---

    def check_3_world_rules(
        self, draft_text: str, world_rules: dict
    ) -> CheckResult:
        power_system = world_rules.get("power_system", {})
        if isinstance(power_system, dict):
            ceilings = power_system.get("ceilings", [])
            has_cost = bool(power_system.get("cost_system"))
        else:
            ceilings = world_rules.get("ceilings", [])
            has_cost = world_rules.get("cost_system") is not None

        if not ceilings:
            return CheckResult(
                check_id=3,
                name="世界规则一致性",
                passed=True,
                detail="未设定能力上限，跳过检查",
            )

        if not isinstance(ceilings, list):
            ceilings = [str(ceilings)]

        power_usages = POWER_USAGE_PATTERN.findall(draft_text)
        violations = []

        for usage in power_usages:
            usage_clean = usage.strip()
            for ceiling in ceilings:
                ceiling_clean = str(ceiling).strip()
                if ceiling_clean and ceiling_clean in usage_clean:
                    violations.append(
                        f"能力使用'{usage_clean}'可能触及上限'{ceiling_clean}'"
                    )

        if has_cost:
            cost_declarations = COST_DECLARATION_PATTERN.findall(draft_text)
            if power_usages and not cost_declarations:
                violations.append("使用了能力但未通过SF_LOG声明代价")

        if violations:
            return CheckResult(
                check_id=3,
                name="世界规则一致性",
                passed=False,
                detail="; ".join(violations),
            )

        return CheckResult(
            check_id=3,
            name="世界规则一致性",
            passed=True,
            detail=f"能力使用检查通过（检测到 {len(power_usages)} 次能力使用）",
        )

    # --- Check 4: Asset compliance ---

    def check_4_asset_compliance(
        self, draft_text: str, storyos_state: dict
    ) -> CheckResult:
        refs = ASSET_REF_PATTERN.findall(draft_text)
        if not refs:
            return CheckResult(
                check_id=4,
                name="叙事资产合规",
                passed=True,
                detail="未引用注册表资产",
            )

        conflicts = storyos_state.get("conflicts", {})
        mysteries = storyos_state.get("mysteries", {})
        twists = storyos_state.get("twists", {})
        goals = storyos_state.get("goals", {})

        all_assets = {}
        for collection in [conflicts, mysteries, twists, goals]:
            if isinstance(collection, dict):
                all_assets.update(collection)
            elif isinstance(collection, list):
                for item in collection:
                    if isinstance(item, dict) and "id" in item:
                        all_assets[item["id"]] = item

        violations = []
        for ref in set(refs):
            if ref not in all_assets:
                violations.append(f"引用的注册表资产'{ref}'不存在")
                continue

            asset = all_assets[ref]
            if isinstance(asset, dict) and asset.get("status") == "resolved":
                violations.append(f"已解决的资产'{ref}'被重新激活")

        if violations:
            return CheckResult(
                check_id=4,
                name="叙事资产合规",
                passed=False,
                detail="; ".join(violations),
            )

        return CheckResult(
            check_id=4,
            name="叙事资产合规",
            passed=True,
            detail=f"引用了 {len(set(refs))} 个注册表资产，均通过检查",
        )

    # --- Check 5: Log completeness ---

    def check_5_log_completeness(
        self, draft_text: str, scene_plan: dict
    ) -> CheckResult:
        raw_logs = SF_LOG_PATTERN.findall(draft_text)
        found_types = set()
        format_errors = []

        for log_type, params_str in raw_logs:
            if log_type not in VALID_LOG_TYPES:
                format_errors.append(f"未知的SF_LOG类型: '{log_type}'")
                continue
            found_types.add(log_type)

            param_match_count = len(PARAM_PATTERN.findall(params_str))
            if param_match_count == 0:
                format_errors.append(
                    f"SF_LOG '{log_type}' 缺少有效的参数 key=value 对"
                )

        required_logs = scene_plan.get("required_logs", [])
        missing = [t for t in required_logs if t not in found_types]

        if format_errors:
            return CheckResult(
                check_id=5,
                name="变化标记完整性",
                passed=False,
                detail="; ".join(format_errors),
            )

        if missing:
            return CheckResult(
                check_id=5,
                name="变化标记完整性",
                passed=False,
                detail=f"缺少必需的SF_LOG类型: {', '.join(missing)}",
            )

        return CheckResult(
            check_id=5,
            name="变化标记完整性",
            passed=True,
            detail=f"检测到 {len(found_types)} 种SF_LOG类型，必需类型全部覆盖",
        )

    # --- Coherence scoring ---

    def compute_coherence_score(self, checks: list[CheckResult]) -> int:
        weights = {
            1: 30,   # Timeline
            2: 30,   # Character state
            3: 20,   # World rules
            4: 10,   # Asset compliance
            5: 10,   # Log completeness
        }
        score = 0
        for c in checks:
            if c.passed:
                score += weights.get(c.check_id, 0)
        return score

    # --- Retry hints ---

    def _generate_retry_hints(self, checks: list[CheckResult]) -> str:
        failed = [c for c in checks if not c.passed]
        if not failed:
            return ""

        hints = []
        for c in failed:
            hints.append(f"[{c.name}] {c.detail}")

        return "请修复以下问题后重写：\n" + "\n".join(f"  - {h}" for h in hints)
