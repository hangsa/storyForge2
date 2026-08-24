"""PromptOverrideStore — per-project JSON overrides on top of read-only YAML defaults.

The store is the only writer to projects/{project_id}/prompt_overrides.json.
backend/prompts/*.yaml files are NEVER written; they remain the factory defaults.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

import yaml

from backend.config import settings


PROMPT_CATEGORIES: dict[str, str] = {
    "creative": "创意",
    "character_designer": "角色",
    "style_engine": "风格",
    "": "其它",
}

PROMPT_LABEL_OVERRIDES: dict[str, str] = {
    "scene_writing": "场景写作",
    "outline_generation": "章节大纲",
    "novel_outline_generation": "全文大纲",
    "narrative_guard": "叙事守护",
    "concept_generation": "概念生成",
    "world_generation": "世界观生成",
    "character_generation": "角色生成",
    "chapter_summary": "章节摘要",
    "scene_rewrite": "场景改写",
    "semantic_precheck": "语义预检",
    "sf_log_suggestion": "SF_LOG 建议",
    "branch_simulation_llm": "分支模拟",
    "canvas_to_concept": "画布转概念",
}


class PromptOverrideStore:
    """Reads/writes projects/{project_id}/prompt_overrides.json."""

    def __init__(self, projects_dir: Path, prompts_dir: Path) -> None:
        self.projects_dir = Path(projects_dir)
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

    def _validate_project_id(self, project_id: str) -> str:
        """Reject empty, absolute, or path-traversing project IDs.

        Raises ValueError on any unsafe input. Callers should let this
        propagate so HTTP routers can translate it to a 400 response.
        """
        if not project_id or not isinstance(project_id, str):
            raise ValueError(f"Invalid project_id: {project_id!r}")
        if "/" in project_id or "\\" in project_id or ".." in project_id:
            raise ValueError(f"Invalid project_id (path traversal): {project_id!r}")
        if project_id.startswith(".") or project_id != project_id.strip():
            raise ValueError(f"Invalid project_id: {project_id!r}")
        return project_id

    def validate_project_id(self, project_id: str) -> str:
        """Public version of _validate_project_id for API-layer use.

        Callers (HTTP routers) want to translate ValueError into a 400
        response without having to reach into a private method. Same
        behavior; just a non-underscore name for the public surface.
        """
        return self._validate_project_id(project_id)

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

    def _override_path(self, project_id: str) -> Path:
        self._validate_project_id(project_id)
        return self.projects_dir / project_id / "prompt_overrides.json"

    def _read_overrides(self, project_id: str) -> dict[str, Any]:
        path = self._override_path(project_id)
        if not path.exists():
            return {}
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f) or {}

    def _write_overrides(self, project_id: str, data: dict[str, Any]) -> None:
        path = self._override_path(project_id)
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(".tmp")
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        tmp.replace(path)

    def list_available(self, project_id: str) -> list[dict[str, Any]]:
        overrides = self._read_overrides(project_id)
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

    def get_effective(
        self,
        project_id: str,
        name: str,
        base: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """Merge the project's overrides on top of a base dict.

        If base is None, the YAML default is loaded and used as the base.
        Passing base lets a caller compose layers (e.g. YAML + global already
        merged) without re-reading the YAML file. Backward compatible: existing
        callers that omit base still get YAML + project override.
        """
        if base is None:
            base = self._load_yaml(name)
        overrides = self._read_overrides(project_id)
        entry = overrides.get(name) or {}
        # Strip metadata keys before merging
        fields = {k: v for k, v in entry.items() if not k.startswith("_")}
        return {**base, **fields}

    def get_override_only(self, project_id: str, name: str) -> dict[str, Any] | None:
        # Validate name exists in YAML (raises FileNotFoundError if not)
        self._load_yaml(name)
        overrides = self._read_overrides(project_id)
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

    def set_override(
        self,
        project_id: str,
        name: str,
        payload: dict[str, Any],
    ) -> dict[str, Any]:
        # Validate name exists in YAML (raises FileNotFoundError if not)
        self._load_yaml(name)

        existing = self._read_overrides(project_id)
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
            self._write_overrides(project_id, existing)
        else:
            path = self._override_path(project_id)
            if path.exists():
                path.unlink()

        return existing.get(name) or {}

    def delete_override(self, project_id: str, name: str) -> None:
        existing = self._read_overrides(project_id)
        if name not in existing:
            return
        existing.pop(name)
        if existing:
            self._write_overrides(project_id, existing)
        else:
            path = self._override_path(project_id)
            if path.exists():
                path.unlink()


# --- Free-function helpers + singleton accessor ----------------------------------
# These let non-BaseAgent callers (BranchSimulator, etc.) reuse the 3-tier merge
# logic without inheriting BaseAgent. Mirror the same shape as `get_model_router()`
# (`backend/llm/model_router.py`) so the wiring is uniform across the codebase.


_override_store_instance: Optional["PromptOverrideStore"] = None


def _load_yaml_prompt(name: str, prompts_dir: Path) -> dict[str, Any]:
    """Load a YAML prompt file by base name (with or without .yaml).

    Names may be either a bare stem (`scene_writing`) or a subdir-qualified
    stem (`character_designer/growth_discuss`). The latter resolves to
    `<prompts_dir>/character_designer/growth_discuss.yaml` — same behavior as
    the pre-existing `BaseAgent._load_prompt_dict_from_yaml` so that agents
    using subdirs (character_designer, creative, style_engine) keep working.
    """
    candidate = name if name.endswith(".yaml") else f"{name}.yaml"
    path = prompts_dir / candidate
    if not path.exists():
        raise FileNotFoundError(f"Prompt template not found: {name}")
    with open(path, "r", encoding="utf-8") as f:
        data = yaml.safe_load(f) or {}
    return data


def load_prompt_effective(
    name: str,
    project_id: Optional[str] = None,
    *,
    override_store: Optional["PromptOverrideStore"] = None,
    global_override_store: Optional["GlobalPromptOverrideStore"] = None,
    prompts_dir: Optional[Path] = None,
) -> dict[str, Any]:
    """Resolve the effective prompt dict by composing YAML → global → project.

    Same 3-tier merge as `BaseAgent.load_prompt`, but returns a plain dict so
    non-BaseAgent callers (BranchSimulator, etc.) can use it without inheriting
    BaseAgent. The two override-store args are keyword-only and default to None:
    passing None at any layer simply skips that layer (YAML-only).

    Raises FileNotFoundError if `name` does not exist in YAML.
    """
    base = _load_yaml_prompt(name, prompts_dir or settings.prompts_dir)
    if global_override_store is not None:
        try:
            base = global_override_store.get_effective(name, base=base)
        except FileNotFoundError:
            pass
    if project_id is not None and override_store is not None:
        base = override_store.get_effective(project_id, name, base=base)
    return base


def get_project_override_store() -> "PromptOverrideStore":
    """Module-level singleton accessor — mirror of `get_model_router()`.

    Lazy-inits once using `settings.projects_dir` + `settings.prompts_dir`.
    Call sites that need to construct a BaseAgent subclass should pass the
    returned instance as `override_store=` so the 3-tier merge in
    `BaseAgent.load_prompt` actually sees Layer 2.
    """
    global _override_store_instance
    if _override_store_instance is None:
        _override_store_instance = PromptOverrideStore(
            projects_dir=settings.projects_dir,
            prompts_dir=settings.prompts_dir,
        )
    return _override_store_instance


def reset_project_override_store() -> None:
    """Test hook — clears the singleton so the next get_project_override_store()
    call rebuilds from current settings. Mirror of `reset_model_router()`."""
    global _override_store_instance
    _override_store_instance = None


def render_negative_block(value: str) -> str:
    """Format a free-text negative-constraint list as the `【禁止事项】` block.

    Returns "" when input is empty / whitespace-only so BaseAgent can
    decide not to substitute {negative_constraints} at all.
    """
    lines = [ln.strip() for ln in value.splitlines() if ln.strip()]
    if not lines:
        return ""
    body = "\n".join(f"- {ln}" for ln in lines)
    return f"\n\n【禁止事项】\n{body}"
