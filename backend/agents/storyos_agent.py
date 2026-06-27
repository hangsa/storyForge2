import json
import logging
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional, Union

from backend.config import settings
from backend.utils.regex_patterns import (
    SF_LOG_PATTERN,
    PARAM_PATTERN,
    VALID_LOG_TYPES,
)

logger = logging.getLogger(__name__)


@dataclass
class ParsedLog:
    type: str
    params: dict = field(default_factory=dict)
    raw_text: str = ""


@dataclass
class FormatError:
    raw_text: str
    error: str


@dataclass
class RegistryUpdateReport:
    created: list[str] = field(default_factory=list)
    updated: list[str] = field(default_factory=list)
    character_state_updates: dict = field(default_factory=dict)
    unregistered_new: list[str] = field(default_factory=list)
    cascade_executed: list[str] = field(default_factory=list)


class StoryOSAgent:
    """Zero LLM — all SF_LOG parsing and registry updates are deterministic regex ops."""

    def __init__(self, project_id: str, projects_dir: Optional[Path] = None,
                 registry_manager=None):
        self.project_id = project_id
        self.projects_dir = Path(projects_dir) if projects_dir else settings.projects_dir
        self._project_dir = self.projects_dir / project_id
        self._registries_dir = self._project_dir / "storyos"
        self._registry_manager = registry_manager

    def parse_sf_logs(self, text: str) -> list[ParsedLog]:
        results: list[ParsedLog] = []
        for match in SF_LOG_PATTERN.finditer(text):
            log_type = match.group(1)
            params_str = match.group(2)
            raw = match.group(0)

            if log_type not in VALID_LOG_TYPES:
                continue

            params = self.parse_log_params(log_type, params_str)
            if not params:
                continue

            results.append(ParsedLog(
                type=log_type,
                params=params,
                raw_text=raw,
            ))
        return results

    def parse_log_params(self, log_type: str, params_str: str) -> dict:
        params: dict = {}
        for key, value in PARAM_PATTERN.findall(params_str):
            # Strip surrounding quotes
            if len(value) >= 2 and value[0] in ('"', "'") and value[-1] == value[0]:
                value = value[1:-1]

            if key == "data" and value.strip().startswith("{"):
                try:
                    params[key] = json.loads(value)
                except json.JSONDecodeError:
                    params[key] = value
            else:
                params[key] = value
        return params

    def validate_log_format(self, text: str) -> list[FormatError]:
        errors: list[FormatError] = []

        suspect_pattern = re.compile(r"<!--\s*SF_LOG\s*(.*?)\s*-->", re.DOTALL)
        for match in suspect_pattern.finditer(text):
            content = match.group(1).strip()
            raw = match.group(0)

            if not content:
                errors.append(FormatError(raw_text=raw, error="空SF_LOG标签"))
                continue

            parts = content.split(None, 1)
            log_type = parts[0]

            if log_type not in VALID_LOG_TYPES:
                errors.append(FormatError(
                    raw_text=raw,
                    error=f"未知SF_LOG类型: '{log_type}'",
                ))
                continue

            if len(parts) < 2:
                errors.append(FormatError(
                    raw_text=raw,
                    error=f"SF_LOG '{log_type}' 缺少参数",
                ))
                continue

            param_count = len(PARAM_PATTERN.findall(parts[1]))
            if param_count == 0:
                errors.append(FormatError(
                    raw_text=raw,
                    error=f"SF_LOG '{log_type}' 参数解析失败，检查引号格式",
                ))

        return errors

    def update_registries(
        self, parsed_logs: list[ParsedLog]
    ) -> RegistryUpdateReport:
        report = RegistryUpdateReport()

        for log in parsed_logs:
            if log.type == "registry_create":
                self._handle_registry_create(log, report)
            elif log.type == "conflict_escalate":
                self._handle_conflict_escalate(log, report)
            elif log.type == "mystery_clue":
                self._handle_mystery_clue(log, report)
            elif log.type == "twist_reveal":
                self._handle_twist_reveal(log, report)
            elif log.type == "expectation_fulfill":
                self._handle_expectation_fulfill(log, report)
            elif log.type == "goal_milestone":
                self._handle_goal_milestone(log, report)
            elif log.type in (
                "character_emotion",
                "character_relation_change",
                "character_location_change",
                "character_physical_change",
            ):
                self._collect_character_update(log, report)

        return report

    def _handle_registry_create(
        self, log: ParsedLog, report: RegistryUpdateReport
    ) -> None:
        reg_type = log.params.get("type", "")
        data = log.params.get("data", {})

        if isinstance(data, str):
            try:
                data = json.loads(data)
            except json.JSONDecodeError:
                return

        if reg_type == "conflict":
            filename = "conflicts.json"
        elif reg_type == "mystery":
            filename = "mysteries.json"
        elif reg_type == "twist":
            filename = "twists.json"
        elif reg_type == "goal":
            filename = "goals.json"
        elif reg_type == "promise":
            filename = "promises.json"
        elif reg_type == "reveal":
            filename = "reveals.json"
        elif reg_type == "expectation":
            filename = "expectations.json"
        elif reg_type == "foreshadowing":
            filename = "foreshadowing.json"
        else:
            report.unregistered_new.append(reg_type)
            return

        entry_id = data.get("id", "") if isinstance(data, dict) else ""
        self._ensure_registry_dir()

        registry = self._read_registry(filename)

        existing_ids = set()
        if isinstance(registry, list):
            existing_ids = {item.get("id", "") for item in registry if isinstance(item, dict)}
        elif isinstance(registry, dict):
            existing_ids = set(registry.keys())

        if entry_id and entry_id not in existing_ids:
            if isinstance(data, dict):
                data.setdefault("created_chapter", 0)
            if isinstance(registry, list):
                registry.append(data)
            self._write_registry(filename, registry)
            report.created.append(f"{reg_type}:{entry_id}")

    def _handle_conflict_escalate(
        self, log: ParsedLog, report: RegistryUpdateReport
    ) -> None:
        conflict_id = log.params.get("id", "")
        new_intensity = log.params.get("new_intensity", "")
        trigger = log.params.get("trigger", "")

        if not conflict_id:
            return

        self._ensure_registry_dir()
        conflicts = self._read_registry("conflicts.json")

        if not isinstance(conflicts, list):
            return

        for conflict in conflicts:
            if not isinstance(conflict, dict):
                continue
            if conflict.get("id") == conflict_id:
                old_intensity = conflict.get("intensity", "")
                conflict["intensity"] = new_intensity

                event = {
                    "from_intensity": old_intensity,
                    "to_intensity": new_intensity,
                    "trigger": trigger,
                }
                if "escalation_history" not in conflict:
                    conflict["escalation_history"] = []
                conflict["escalation_history"].append(event)

                self._write_registry("conflicts.json", conflicts)
                report.updated.append(f"conflict:{conflict_id}")
                if self._registry_manager:
                    result = self._registry_manager.update_asset_status(
                        "conflict", conflict_id, "escalated"
                    )
                    if result.steps_executed:
                        steps = len(result.steps_executed)
                        report.cascade_executed.append(f"conflict:{conflict_id} -> {steps} steps")
                    if result.orphaned_mysteries:
                        report.cascade_executed.append(
                            f"conflict:{conflict_id} orphaned_mysteries:{result.orphaned_mysteries}"
                        )
                return

    def _handle_mystery_clue(
        self, log: ParsedLog, report: RegistryUpdateReport
    ) -> None:
        mystery_id = log.params.get("id", "")
        clue_text = log.params.get("clue", "")

        if not mystery_id or not clue_text:
            return

        self._ensure_registry_dir()
        mysteries = self._read_registry("mysteries.json")

        if not isinstance(mysteries, list):
            return

        for mystery in mysteries:
            if not isinstance(mystery, dict):
                continue
            if mystery.get("id") == mystery_id:
                if "clues" not in mystery:
                    mystery["clues"] = []
                mystery["clues"].append({
                    "text": clue_text,
                    "source": "SF_LOG",
                })
                self._write_registry("mysteries.json", mysteries)
                report.updated.append(f"mystery:{mystery_id}")
                return

    def _handle_twist_reveal(
        self, log: ParsedLog, report: RegistryUpdateReport
    ) -> None:
        twist_id = log.params.get("id", "")
        trigger = log.params.get("trigger", "")

        if not twist_id:
            return

        self._ensure_registry_dir()
        twists = self._read_registry("twists.json")

        if not isinstance(twists, list):
            return

        for twist in twists:
            if not isinstance(twist, dict):
                continue
            if twist.get("id") == twist_id:
                twist["reveal_trigger"] = trigger
                self._write_registry("twists.json", twists)
                report.updated.append(f"twist:{twist_id}")
                if self._registry_manager:
                    result = self._registry_manager.update_asset_status(
                        "twist", twist_id, "revealed"
                    )
                    if result.steps_executed:
                        steps = len(result.steps_executed)
                        report.cascade_executed.append(f"twist:{twist_id} -> {steps} steps")
                else:
                    twist["status"] = "revealed"
                    self._write_registry("twists.json", twists)
                return

    def _handle_expectation_fulfill(
        self, log: ParsedLog, report: RegistryUpdateReport
    ) -> None:
        expectation_id = log.params.get("id", "")
        trigger = log.params.get("trigger", "")

        if not expectation_id:
            return

        self._ensure_registry_dir()
        expectations = self._read_registry("expectations.json")

        if not isinstance(expectations, list):
            return

        for exp in expectations:
            if not isinstance(exp, dict):
                continue
            if exp.get("id") == expectation_id:
                exp["status"] = "fulfilled"
                exp["fulfill_trigger"] = trigger
                self._write_registry("expectations.json", expectations)
                report.updated.append(f"expectation:{expectation_id}")
                if self._registry_manager:
                    result = self._registry_manager.update_asset_status(
                        "expectation", expectation_id, "fulfilled"
                    )
                    if result.steps_executed:
                        steps = len(result.steps_executed)
                        report.cascade_executed.append(f"expectation:{expectation_id} -> {steps} steps")
                return

    def _handle_goal_milestone(
        self, log: ParsedLog, report: RegistryUpdateReport
    ) -> None:
        goal_id = log.params.get("id", "")
        progress = log.params.get("progress", "")

        if not goal_id:
            return

        self._ensure_registry_dir()
        goals = self._read_registry("goals.json")

        if not isinstance(goals, list):
            return

        for goal in goals:
            if not isinstance(goal, dict):
                continue
            if goal.get("id") == goal_id:
                goal["progress"] = progress
                if "progress_history" not in goal:
                    goal["progress_history"] = []
                goal["progress_history"].append(progress)
                self._write_registry("goals.json", goals)
                report.updated.append(f"goal:{goal_id}")
                return

    def _collect_character_update(
        self, log: ParsedLog, report: RegistryUpdateReport
    ) -> None:
        if log.type == "character_emotion":
            char = log.params.get("char", "")
            emotion = log.params.get("emotion", "")
            if char:
                report.character_state_updates.setdefault(char, {})
                report.character_state_updates[char]["emotion"] = emotion

        elif log.type == "character_location_change":
            char = log.params.get("char", "")
            to_loc = log.params.get("to", "")
            if char:
                report.character_state_updates.setdefault(char, {})
                report.character_state_updates[char]["location"] = to_loc

        elif log.type == "character_relation_change":
            char_a = log.params.get("char_a", "")
            char_b = log.params.get("char_b", "")
            status = log.params.get("status", "")
            if char_a and char_b:
                report.character_state_updates.setdefault("relations", {})
                report.character_state_updates["relations"][
                    f"{char_a}<->{char_b}"
                ] = status

        elif log.type == "character_physical_change":
            char = log.params.get("char", "")
            change = log.params.get("change", "")
            if char:
                report.character_state_updates.setdefault(char, {})
                report.character_state_updates[char]["physical_change"] = change

    def _ensure_registry_dir(self) -> None:
        self._registries_dir.mkdir(parents=True, exist_ok=True)

    def _read_registry(self, filename: str) -> Union[list, dict]:
        path = self._registries_dir / filename
        if not path.exists():
            return []
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)

    def _write_registry(self, filename: str, data: Union[list, dict]) -> None:
        path = self._registries_dir / filename
        tmp = path.with_suffix(".tmp")
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        tmp.replace(path)


# --- v1.7: User Edit Assist (T3.9) ---


@dataclass
class SFLogSuggestion:
    type: str                                  # "missing" | "deleted" | "modified"
    severity: str                              # "warning" | "suggestion"
    event_type: str                            # SF_LOG type
    suggested_tag: str                         # full SF_LOG tag
    location_hint: str                         # where in the text
    reason: str                                # why we suggest it


@dataclass
class SFLogDiffReport:
    original_text: str
    modified_text: str
    deleted_logs: list[dict] = field(default_factory=list)   # raw text + parsed type/id
    suggestions: list[SFLogSuggestion] = field(default_factory=list)
    tokens_used: int = 0


class SFLogSuggestionEngine:
    """Analyzes user edits to a Scene and proposes SF_LOG changes.

    Two phases:
    1. Deterministic: parse deleted SF_LOG tags from the original text.
    2. Tier 3 LLM (optional): detect new/modified events implied by the diff.
    """

    def __init__(self, model_router) -> None:
        self._router = model_router
        self._prompt = self._load_prompt()

    async def analyze_diff(
        self,
        original_text: str,
        modified_text: str,
        existing_sf_logs: list[dict],
        character_names: list[str],
    ) -> SFLogDiffReport:
        deleted = self._detect_deleted_logs(original_text, modified_text)

        if self._router is None or not self._prompt:
            return SFLogDiffReport(
                original_text=original_text,
                modified_text=modified_text,
                deleted_logs=deleted,
                suggestions=[],
                tokens_used=0,
            )

        return await self._run_llm_phase(
            original_text, modified_text, existing_sf_logs, character_names, deleted
        )

    def apply_suggestions(self, text: str, suggestions: list[SFLogSuggestion]) -> str:
        """Insert the suggested SF_LOG tags into the text.

        Simple strategy: append each tag at the end of the text. Tags already present
        are not duplicated. This is a v1 implementation — location_hint-based
        insertion comes later.
        """
        if not suggestions:
            return text
        insertion_lines = []
        for s in suggestions:
            if s.suggested_tag and s.suggested_tag not in text:
                insertion_lines.append(s.suggested_tag)
        if not insertion_lines:
            return text
        # Append at end, one tag per line, separated by a blank line
        sep = "\n" if text.endswith("\n") else "\n\n"
        return text + sep + "\n".join(insertion_lines) + "\n"

    # --- private ---

    def _detect_deleted_logs(self, original: str, modified: str) -> list[dict]:
        """Find SF_LOG tags present in original but absent in modified."""
        orig_tags = SF_LOG_PATTERN.findall(original or "")
        mod_tags = set(SF_LOG_PATTERN.findall(modified or ""))
        deleted = []
        for tag_type, params_str in orig_tags:
            if (tag_type, params_str) in mod_tags:
                continue
            params = self._parse_simple_params(params_str)
            deleted.append({
                "raw_text": f"<!-- SF_LOG {tag_type} {params_str} -->",
                "type": tag_type,
                "id": params.get("id", ""),
            })
        return deleted

    @staticmethod
    def _parse_simple_params(params_str: str) -> dict:
        """Parse 'key="value" key2="value2"' into a dict. Tolerant of unquoted values."""
        out = {}
        for match in re.finditer(r'(\w+)\s*=\s*"([^"]*)"', params_str):
            out[match.group(1)] = match.group(2)
        return out

    def _load_prompt(self) -> Optional[dict]:
        path = Path("backend/prompts/sf_log_suggestion.yaml")
        if not path.exists():
            logger.warning("sf_log_suggestion.yaml not found at %s", path)
            return None
        try:
            import yaml
            with open(path, encoding="utf-8") as f:
                data = yaml.safe_load(f) or {}
        except Exception as e:
            logger.warning("Failed to load sf_log_suggestion.yaml: %s", e)
            return None
        return {
            "system_prompt": data.get("system_prompt", "").strip(),
            "user_template": data.get("user_prompt_template", "").strip(),
        }

    async def _run_llm_phase(
        self,
        original: str,
        modified: str,
        existing_logs: list[dict],
        character_names: list[str],
        deleted: list[dict],
    ) -> SFLogDiffReport:
        diff_text = self._make_diff_snippet(original, modified)
        if not diff_text.strip():
            return SFLogDiffReport(
                original_text=original, modified_text=modified,
                deleted_logs=deleted, suggestions=[], tokens_used=0,
            )

        existing_str = ", ".join(log.get("type", "") for log in existing_logs) or "（无）"
        chars_str = "、".join(character_names) if character_names else "（未指定）"

        user_prompt = self._prompt["user_template"].format(
            diff_text=diff_text[:1500],
            existing_logs=existing_str,
            character_names=chars_str,
        )
        messages = [
            {"role": "system", "content": self._prompt["system_prompt"]},
            {"role": "user", "content": user_prompt},
        ]

        try:
            result = await self._router.execute(
                agent_name="storyos_agent",
                task_name="sf_log_suggestion",
                messages=messages,
                json_mode=True,
            )
        except Exception as e:
            logger.warning("SF_LOG suggestion LLM call failed: %s", e)
            return SFLogDiffReport(
                original_text=original, modified_text=modified,
                deleted_logs=deleted, suggestions=[], tokens_used=0,
            )

        content = result.get("content", "")
        if not content:
            return SFLogDiffReport(
                original_text=original, modified_text=modified,
                deleted_logs=deleted, suggestions=[], tokens_used=0,
            )

        try:
            parsed = json.loads(content)
        except json.JSONDecodeError:
            logger.warning("sf_log_suggestion returned non-JSON: %r", content[:200])
            return SFLogDiffReport(
                original_text=original, modified_text=modified,
                deleted_logs=deleted, suggestions=[], tokens_used=0,
            )

        if not isinstance(parsed, dict):
            logger.warning(
                "sf_log_suggestion returned non-object JSON: %r", str(parsed)[:200]
            )
            return SFLogDiffReport(
                original_text=original, modified_text=modified,
                deleted_logs=deleted, suggestions=[], tokens_used=0,
            )

        suggestions = self._parse_suggestions(parsed.get("suggestions", []))
        tokens = result.get("usage", {})
        tokens_used = tokens.get("input", 0) + tokens.get("output", 0)

        return SFLogDiffReport(
            original_text=original,
            modified_text=modified,
            deleted_logs=deleted,
            suggestions=suggestions,
            tokens_used=tokens_used,
        )

    @staticmethod
    def _make_diff_snippet(original: str, modified: str, max_chars: int = 1500) -> str:
        """Build a concise diff snippet. Falls back to truncated modified if diff is huge."""
        import difflib
        if not original and not modified:
            return ""
        diff = list(difflib.unified_diff(
            original.splitlines(),
            modified.splitlines(),
            lineterm="",
            n=1,
        ))
        joined = "\n".join(diff)
        if len(joined) > max_chars:
            joined = joined[:max_chars] + "\n... (truncated)"
        return joined

    @staticmethod
    def _parse_suggestions(raw: list) -> list[SFLogSuggestion]:
        out: list[SFLogSuggestion] = []
        if not isinstance(raw, list):
            return out
        for item in raw:
            if not isinstance(item, dict):
                continue
            event_type = item.get("event_type", "")
            if event_type not in VALID_LOG_TYPES:
                continue
            out.append(SFLogSuggestion(
                type=item.get("type", "missing"),
                severity=item.get("severity", "suggestion"),
                event_type=event_type,
                suggested_tag=item.get("suggested_tag", ""),
                location_hint=item.get("location_hint", ""),
                reason=item.get("reason", ""),
            ))
        return out
