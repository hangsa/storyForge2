import logging
import re
from dataclasses import dataclass, field
from typing import Optional

from backend.utils.json_parser import parse_json_text
from backend.utils.regex_patterns import (
    SF_LOG_PATTERN,
    PARAM_PATTERN,
    LOCATION_CHANGE_PATTERN,
    POWER_USAGE_PATTERN,
    COST_DECLARATION_PATTERN,
    ASSET_REF_PATTERN,
    VALID_LOG_TYPES,
)

logger = logging.getLogger(__name__)


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


# --- v1.6: Narrative Guard data types ---


@dataclass
class NarrativeDrift:
    drift_type: str          # "emotion_surge" / "relation_shift" / "behavior_contradiction" / "knowledge_leak"
    character_name: str
    severity: str            # "high" / "medium" / "low"
    description: str         # 人类可读的漂移描述
    suggested_log_type: str  # 建议补充的 SF_LOG 类型


@dataclass
class NarrativeGuardResult:
    drifts: list[NarrativeDrift] = field(default_factory=list)
    overall_assessment: str = ""
    model_used: str = ""
    tokens_used: int = 0


class ReviewerAgent:
    """Fact Guard reviewer + v1.6 Narrative Guard + Style Guard L3. Checks 1-5 are zero-LLM."""

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
            self.check_6_semantic_precheck_review(),  # v1.6: framework stub
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

    # --- Check 6: Semantic precheck review (v1.6 framework) ---

    def check_6_semantic_precheck_review(
        self,
        semantic_precheck_results: Optional[list[CheckResult]] = None,
    ) -> CheckResult:
        """
        Fact Guard 第 6 项：语义预检结果复核。

        v1.6: semantic_precheck_results 始终为 None → 始终 passed
        v1.7: 接入 LLM 语义完整性预检结果，复核并过滤误报

        此项不阻断——语义预检基于 LLM，存在误报可能。
        """
        if semantic_precheck_results is None:
            return CheckResult(
                check_id=6,
                name="语义预检结果复核",
                passed=True,
                detail="v1.6 — 语义预检尚未接入，此项暂不生效",
            )

        # v1.7: 以下为预留逻辑
        failed_checks = [c for c in semantic_precheck_results if not c.passed]
        if not failed_checks:
            return CheckResult(
                check_id=6, name="语义预检结果复核", passed=True,
                detail="语义预检全部通过",
            )

        return CheckResult(
            check_id=6,
            name="语义预检结果复核",
            passed=True,  # 不阻断
            detail=f"语义预检 {len(failed_checks)} 项未通过，待 v1.7 复核引擎处理",
        )

    # --- v1.6: Narrative Guard ---

    async def run_narrative_guard(
        self,
        scene_text: str,
        character_behavior_summary: str,
        voice_signatures: str,
        unknown_to_character: str,
    ) -> NarrativeGuardResult:
        """
        执行 Narrative Guard 状态漂移检测（Tier 2 LLM）。

        从 L2 温记忆中加载角色历史行为模式，
        使用 Tier 2 模型对比当前 Scene 中角色行为与其历史模式，
        检测情感突变/关系突变/行为矛盾/知识泄露四类漂移。

        Tier 2 不可用时静默跳过，返回空结果。
        """
        from backend.llm.model_router import get_model_router, ModelUnavailableError

        router = get_model_router()

        # Truncate scene text to ~6K tokens (≈ 12K chars for Chinese)
        scene_snippet = scene_text[:12000] if len(scene_text) > 12000 else scene_text

        # Load prompt template
        from pathlib import Path
        import yaml
        prompt_path = Path("backend/prompts/narrative_guard.yaml")
        if not prompt_path.exists():
            logger.warning("narrative_guard.yaml not found, skipping Narrative Guard")
            return NarrativeGuardResult(
                overall_assessment="Narrative Guard prompt 未找到，已跳过",
            )

        with open(prompt_path, "r", encoding="utf-8") as f:
            prompt_data = yaml.safe_load(f) or {}

        system_prompt = prompt_data.get("system_prompt", "")
        user_template = prompt_data.get("user_prompt_template", "")

        user_prompt = user_template.format(
            scene_text=scene_snippet,
            character_behavior_summary=character_behavior_summary,
            voice_signatures=voice_signatures,
            unknown_to_character=unknown_to_character,
        )

        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ]

        try:
            result = await router.execute(
                agent_name="reviewer",
                task_name="narrative_guard",
                messages=messages,
                json_mode=False,
            )
        except (ModelUnavailableError, KeyError):
            logger.warning("Narrative Guard Tier 2 unavailable, skipping")
            return NarrativeGuardResult(
                overall_assessment="Narrative Guard 不可用（Tier 2 模型不可用），已跳过",
            )

        content = result.get("content", "")
        if not content:
            return NarrativeGuardResult(
                overall_assessment="Narrative Guard 不可用，已跳过",
            )

        # Parse LLM response
        try:
            parsed = self._parse_json_text(content)
            drifts_data = parsed.get("drifts", []) if parsed else []
        except Exception:
            logger.warning("Failed to parse Narrative Guard response: %s", content[:200])
            return NarrativeGuardResult(
                overall_assessment="Narrative Guard 响应解析失败",
                model_used=result.get("model", ""),
                tokens_used=result.get("usage", {}).get("input", 0),
            )

        # Post-process: filter drifts that have corresponding SF_LOG coverage
        confirmed_drifts = []
        for d in drifts_data:
            if not isinstance(d, dict):
                continue
            raw_text = scene_text

            # Check if drift has corresponding SF_LOG coverage
            drift_type = d.get("drift_type", "")
            char_name = d.get("character_name", "")
            suggested_log = d.get("suggested_log_type", "")

            has_log_coverage = False
            if suggested_log and char_name:
                pattern = rf"<!--\s*SF_LOG\s+{re.escape(suggested_log)}\b"
                matches = re.findall(pattern, raw_text)
                for match in matches:
                    if char_name in match:
                        has_log_coverage = True
                        break

            if not has_log_coverage:
                confirmed_drifts.append(NarrativeDrift(
                    drift_type=drift_type,
                    character_name=char_name,
                    severity=d.get("severity", "medium"),
                    description=d.get("description", ""),
                    suggested_log_type=suggested_log,
                ))

        return NarrativeGuardResult(
            drifts=confirmed_drifts,
            overall_assessment=parsed.get("overall_assessment", "") if parsed else "",
            model_used=result.get("model", ""),
            tokens_used=result.get("usage", {}).get("input", 0),
        )

    # --- v1.6 Phase 4b: Style Guard ---

    async def run_style_guard(
        self,
        scene_text: str,
        genre_template: dict,
        characters: list[dict],
    ) -> list[dict]:
        """
        执行 Style Guard L3 禁忌约束检测。
        在 Narrative Guard 之后调用。不阻断 Scene。
        返回 TabooViolation 列表的 dict 形式。

        Args:
            scene_text: Scene draft text
            genre_template: Loaded genre template dict (contains taboos key)
            characters: List of character dicts with voice_signature.taboos
        """
        try:
            from backend.style_engine.taboo_constraints import TabooConstraintChecker

            checker = TabooConstraintChecker()

            genre_taboos = genre_template.get("taboos", []) if genre_template else []

            character_taboos = [
                {
                    "name": c.get("name", "未知角色"),
                    "taboos": c.get("voice_signature", {}).get("taboos", []),
                }
                for c in characters
                if c.get("voice_signature", {}).get("taboos")
            ]

            violations = await checker.check_async(
                scene_text=scene_text,
                genre_taboos=genre_taboos,
                character_taboos=character_taboos,
            )

            return [
                {
                    "pattern_name": v.pattern_name,
                    "layer": v.layer,
                    "severity": v.severity,
                    "matched_text": v.matched_text,
                    "context": v.context,
                }
                for v in violations
            ]
        except Exception as e:
            logger.warning("Style Guard check failed (non-blocking): %s", e)
            return []

    @staticmethod
    def _parse_json_text(text: str) -> Optional[dict]:
        return parse_json_text(text)

    # --- Coherence scoring ---

    def compute_coherence_score(self, checks: list[CheckResult]) -> int:
        weights = {
            1: 30,   # Timeline
            2: 30,   # Character state
            3: 20,   # World rules
            4: 10,   # Asset compliance
            5: 10,   # Log completeness
            6: 0,    # Semantic precheck (informational only)
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
