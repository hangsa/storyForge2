"""GlobalPromptOverrideStore — project-independent JSON overrides on top of YAML defaults.

This is Layer 1 in the 3-tier prompt architecture:
- Layer 0 (YAML): backend/prompts/*.yaml — read-only factory defaults.
- Layer 1 (Global): config/global_prompt_overrides.json — user-edited fallbacks
  that apply to ALL projects when no project-specific override exists. (this file)
- Layer 2 (Project): projects/{id}/prompt_overrides.json — per-project customizations.

The store is the only writer to config/global_prompt_overrides.json.
backend/prompts/*.yaml files are NEVER written; they remain the factory defaults.

Mirrors PromptOverrideStore but with no project_id — there is a single global file.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import yaml

# Reuse the same label constants as the per-project store so the UI stays consistent.
from backend.services.prompt_override_store import PROMPT_LABEL_OVERRIDES  # noqa: F401


class GlobalPromptOverrideStore:
    """Reads/writes config/global_prompt_overrides.json."""

    def __init__(self, global_overrides_path: Path, prompts_dir: Path) -> None:
        self.global_overrides_path = Path(global_overrides_path)
        self.prompts_dir = Path(prompts_dir)

    def _iter_yaml_files(self) -> list[tuple[Path, str]]:
        """Returns (path, category) for every .yaml under prompts_dir (recursive).

        category is the subdir name relative to prompts_dir, or "" for root.
        """
        results: list[tuple[Path, str]] = []
        for path in sorted(self.prompts_dir.rglob("*.yaml")):
            rel = path.relative_to(self.prompts_dir)
            category = rel.parts[0] if len(rel.parts) > 1 else ""
            # Only treat top-level subdirs as categories; deeper nesting is not supported
            if len(rel.parts) > 2:
                continue
            results.append((path, category))
        return results

    def validate_project_id(self, project_id: str | None = None) -> str | None:
        """No-op for the global store — kept for interface symmetry with the
        per-project store. Global overrides are not scoped to a project, so there
        is nothing to validate. Always returns the input unchanged.
        """
        return project_id

    def _load_yaml(self, name: str) -> dict[str, Any]:
        """Load a YAML prompt file by base name (with or without .yaml)."""
        candidate = name if name.endswith(".yaml") else f"{name}.yaml"
        # Try root first, then subdirs
        for path, _category in self._iter_yaml_files():
            if path.name == candidate and path.stem == name:
                with open(path, "r", encoding="utf-8") as f:
                    data = yaml.safe_load(f) or {}
                return data
        raise FileNotFoundError(f"Prompt template not found: {name}")

    def _read_overrides(self) -> dict[str, Any]:
        path = self.global_overrides_path
        if not path.exists():
            return {}
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f) or {}

    def _write_overrides(self, data: dict[str, Any]) -> None:
        path = self.global_overrides_path
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(".tmp")
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        tmp.replace(path)

    def list_available(self) -> list[dict[str, Any]]:
        overrides = self._read_overrides()
        result: list[dict[str, Any]] = []
        for path, category in self._iter_yaml_files():
            name = path.stem
            override_entry = overrides.get(name) or {}
            modified_at = override_entry.get("_modified_at")
            result.append({
                "name": name,
                "category": category,
                "label": PROMPT_LABEL_OVERRIDES.get(name, name),
                "has_override": bool(override_entry),
                "modified_at": modified_at,
                "builtin": True,
            })
        return result

    def get_effective(self, name: str, base: dict[str, Any] | None = None) -> dict[str, Any]:
        """Merge global overrides on top of a base dict.

        If base is None, the YAML default is loaded and used as the base.
        Passing base lets a caller compose layers (e.g. YAML already loaded)
        without re-reading the YAML file.
        """
        if base is None:
            base = self._load_yaml(name)
        overrides = self._read_overrides()
        entry = overrides.get(name) or {}
        # Strip metadata keys before merging
        fields = {k: v for k, v in entry.items() if not k.startswith("_")}
        return {**base, **fields}

    def get_override_only(self, name: str) -> dict[str, Any] | None:
        # Validate name exists in YAML (raises FileNotFoundError if not)
        self._load_yaml(name)
        overrides = self._read_overrides()
        entry = overrides.get(name)
        return entry if entry else None

    def _pruned_override(self, name: str, full: dict[str, Any]) -> dict[str, Any]:
        """Drop fields whose value matches the YAML default — keeps the JSON clean."""
        base = self._load_yaml(name)
        pruned: dict[str, Any] = {}
        for k, v in full.items():
            if k.startswith("_"):
                continue
            if base.get(k) != v:
                pruned[k] = v
        pruned["_modified_at"] = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        return pruned

    def set_override(self, name: str, payload: dict[str, Any]) -> dict[str, Any]:
        # Validate name exists in YAML (raises FileNotFoundError if not)
        self._load_yaml(name)

        existing = self._read_overrides()
        current_entry = existing.get(name) or {}
        # Strip metadata before merging so payload doesn't clobber _modified_at
        current_fields = {k: v for k, v in current_entry.items() if not k.startswith("_")}
        merged_fields = {**current_fields, **payload}
        pruned = self._pruned_override(name, merged_fields)

        # Always keep the entry (with just _modified_at) so the UI can show
        # "last touched at X". DELETE is the only way to drop the entry
        # entirely; if the resulting JSON has no entries at all, drop the file.
        existing[name] = pruned

        if existing:
            self._write_overrides(existing)
        else:
            path = self.global_overrides_path
            if path.exists():
                path.unlink()

        return existing.get(name) or {}

    def delete_override(self, name: str) -> None:
        existing = self._read_overrides()
        if name not in existing:
            return
        existing.pop(name)
        if existing:
            self._write_overrides(existing)
        else:
            path = self.global_overrides_path
            if path.exists():
                path.unlink()
