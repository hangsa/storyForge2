import json
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


class StoryOSAgent:
    """Zero LLM — all SF_LOG parsing and registry updates are deterministic regex ops."""

    def __init__(self, project_id: str, projects_dir: Optional[Path] = None):
        self.project_id = project_id
        self.projects_dir = Path(projects_dir) if projects_dir else settings.projects_dir
        self._project_dir = self.projects_dir / project_id
        self._registries_dir = self._project_dir / "storyos"

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
            elif log.type in (
                "character_emotion",
                "character_relation_change",
                "character_location_change",
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
