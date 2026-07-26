from __future__ import annotations
import os
import re
import tempfile
from pathlib import Path

import yaml

from backend.config import settings
from backend.llm.model_router import get_model_router

CONFIG_PATH = Path("config/model_tiers.yaml")
PROVIDER_KEY_MAP = {
    "anthropic": "anthropic_api_key",
    "deepseek": "deepseek_api_key",
    "minimax": "minimax_api_key",
}
ALLOWED_PROVIDERS = {"anthropic", "deepseek", "minimax"}


class LLMConfigError(ValueError):
    def __init__(self, message: str, invalid_paths: list[str]):
        super().__init__(message)
        self.invalid_paths = invalid_paths


def read_yaml() -> dict:
    with open(CONFIG_PATH, "r", encoding="utf-8") as f:
        return yaml.safe_load(f) or {}


def write_yaml_atomic(data: dict) -> None:
    """Atomic write to CONFIG_PATH. Same mkstemp + os.replace pattern as
    backfill_behavior_examples._atomic_write_json — survives kill mid-write
    and never leaves a stray .tmp file."""
    CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_name = tempfile.mkstemp(
        dir=CONFIG_PATH.parent,
        prefix=".model_tiers.",
        suffix=".tmp",
    )
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            yaml.safe_dump(
                data,
                f,
                allow_unicode=True,
                sort_keys=False,
                default_flow_style=False,
            )
        os.replace(tmp_name, CONFIG_PATH)
    except Exception:
        if os.path.exists(tmp_name):
            os.unlink(tmp_name)
        raise


_ENV_LINE_RE = re.compile(r"^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$")


def _env_replace(src: str, dst: Path) -> None:
    """Wrapper around os.replace to allow monkeypatching in tests."""
    os.replace(src, dst)


def _parse_env(text: str) -> tuple[list[str], dict[str, str]]:
    """Return (raw_lines, key->value). Lines that are not assignments are kept
    verbatim in raw_lines so comments and blanks survive untouched."""
    raw = text.splitlines(keepends=False) if text else []
    values: dict[str, str] = {}
    for line in raw:
        stripped = line.lstrip()
        if not stripped or stripped.startswith("#"):
            continue
        match = _ENV_LINE_RE.match(line)
        if match:
            values[match.group(1)] = match.group(2)
    return raw, values


def _format_env_value(value: str) -> str:
    if any(ch.isspace() for ch in value) or any(ch in value for ch in ['"', "'", "#"]):
        escaped = value.replace("\\", "\\\\").replace('"', '\\"')
        return f'"{escaped}"'
    return value


def write_env_atomic(env_path: Path, updates: dict[str, str]) -> None:
    """Atomic update of a `.env` file. Preserves key order, comments, and
    blank lines. Adds new keys at the end (after a blank line if missing).
    """
    env_path.parent.mkdir(parents=True, exist_ok=True)
    text = env_path.read_text(encoding="utf-8") if env_path.exists() else ""
    raw, existing = _parse_env(text)

    new_raw: list[str] = []
    seen_keys: set[str] = set()
    for line in raw:
        stripped = line.lstrip()
        if not stripped or stripped.startswith("#"):
            new_raw.append(line)
            continue
        match = _ENV_LINE_RE.match(line)
        if not match:
            new_raw.append(line)
            continue
        key = match.group(1)
        if key in updates:
            new_raw.append(f"{key}={_format_env_value(updates[key])}")
            seen_keys.add(key)
        else:
            new_raw.append(line)

    appended = False
    for key, value in updates.items():
        if key in seen_keys:
            continue
        if not appended and new_raw and new_raw[-1].strip() != "":
            new_raw.append("")
            appended = True
        elif not new_raw:
            appended = True
        new_raw.append(f"{key}={_format_env_value(value)}")

    payload = "\n".join(new_raw) + "\n"

    fd, tmp_name = tempfile.mkstemp(
        dir=env_path.parent,
        prefix=".env.",
        suffix=".tmp",
    )
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(payload)
        _env_replace(tmp_name, env_path)
    except Exception:
        if os.path.exists(tmp_name):
            os.unlink(tmp_name)
        raise


def validate(data: dict) -> None:
    """Validate a config dict. Raises LLMConfigError with `invalid_paths`
    on failure. Path format matches JSON-pointer-ish dotted syntax:
    e.g. `tiers.tier_1.models.0.id`, `agent_mapping.writer.scene_writing.tier`.
    """
    if not isinstance(data, dict):
        raise LLMConfigError("配置根节点必须是对象", ["$"])

    tiers = data.get("tiers") or {}
    if not isinstance(tiers, dict):
        raise LLMConfigError("tiers 必须是对象", ["tiers"])

    invalid: list[str] = []
    known_tier_names = set(tiers.keys())
    if "tier_0" not in known_tier_names:
        invalid.append("tier_0")

    for tier_name, tier in tiers.items():
        if not tier_name.strip() or not isinstance(tier, dict):
            invalid.append(f"tiers.{tier_name or '<empty>'}")
            continue
        if tier_name == "tier_0":
            if tier.get("models") or tier.get("default") != "none":
                invalid.append("tiers.tier_0")
            continue

        models = tier.get("models") or []
        if not models:
            invalid.append(f"tiers.{tier_name}.models")

        model_ids = [
            m.get("id") for m in models if isinstance(m, dict) and m.get("id")
        ]
        if len(model_ids) != len(set(model_ids)):
            counts: dict[str, int] = {}
            for mid in model_ids:
                counts[mid] = counts.get(mid, 0) + 1
            for mid, n in counts.items():
                if n > 1:
                    invalid.append(f"tiers.{tier_name}.models[duplicate_id={mid}]")

        for i, m in enumerate(models):
            if not isinstance(m, dict):
                invalid.append(f"tiers.{tier_name}.models.{i}")
                continue
            mid = m.get("id")
            if not mid:
                invalid.append(f"tiers.{tier_name}.models.{i}.id")
                continue
            if m.get("provider") not in ALLOWED_PROVIDERS:
                invalid.append(f"tiers.{tier_name}.models.{i}.provider")
            if not isinstance(m.get("max_tokens"), int) or isinstance(m.get("max_tokens"), bool):
                invalid.append(f"tiers.{tier_name}.models.{i}.max_tokens")

        default = tier.get("default")
        if default and default != "none" and not any(m.get("id") == default for m in models):
            invalid.append(f"tiers.{tier_name}.default")
        fallback = tier.get("fallback")
        if fallback and not any(m.get("id") == fallback for m in models):
            invalid.append(f"tiers.{tier_name}.fallback")

    mappings = data.get("agent_mapping") or {}
    if not isinstance(mappings, dict):
        invalid.append("agent_mapping")
        mappings = {}

    for agent_name, tasks in mappings.items():
        if not agent_name.strip() or not isinstance(tasks, dict):
            invalid.append(f"agent_mapping.{agent_name or '<empty>'}")
            continue
        for task_name, mapping in tasks.items():
            if not task_name.strip() or not isinstance(mapping, dict):
                invalid.append(f"agent_mapping.{agent_name}.{task_name or '<empty>'}")
                continue
            tier_name = mapping.get("tier")
            if tier_name and tier_name not in known_tier_names:
                invalid.append(f"agent_mapping.{agent_name}.{task_name}.tier")
                continue
            tier_models = (
                (tiers.get(tier_name) or {}).get("models") or []
                if tier_name in known_tier_names
                else []
            )
            model_id = mapping.get("model")
            if model_id and model_id != "default" and not any(
                m.get("id") == model_id for m in tier_models
            ):
                invalid.append(f"agent_mapping.{agent_name}.{task_name}.model")
            fallback = mapping.get("fallback")
            if (
                fallback
                and fallback != "default"
                and not any(m.get("id") == fallback for m in tier_models)
            ):
                invalid.append(f"agent_mapping.{agent_name}.{task_name}.fallback")

    if invalid:
        raise LLMConfigError(
            f"配置校验失败：{len(invalid)} 项错误", invalid
        )


def reload_router() -> dict:
    """Validate disk config, then swap the live router's tiers / mappings in."""
    validate(read_yaml())
    router = get_model_router()
    router.reload_config()
    return {"tiers": len(router._tiers), "agents": len(router._mappings)}


def provider_status() -> list[dict]:
    cfg = read_yaml()
    tiers = cfg.get("tiers") or {}
    by_provider: dict[str, set[str]] = {p: set() for p in ALLOWED_PROVIDERS}
    for tier in tiers.values():
        if not isinstance(tier, dict):
            continue
        for m in tier.get("models") or []:
            if not isinstance(m, dict):
                continue
            provider = m.get("provider")
            mid = m.get("id")
            if provider in by_provider and mid:
                by_provider[provider].add(mid)
    out: list[dict] = []
    for provider, models in by_provider.items():
        api_key_attr = PROVIDER_KEY_MAP.get(provider, "")
        configured = (
            bool(getattr(settings, api_key_attr, ""))
            if api_key_attr
            else False
        )
        base_url_attr = (
            f"{provider}_base_url" if provider in {"deepseek", "minimax"} else ""
        )
        base_url = (
            getattr(settings, base_url_attr, "") if base_url_attr else ""
        )
        out.append({
            "provider": provider,
            "base_url": base_url,
            "api_key_configured": configured,
            "models": sorted(models),
        })
    return out
