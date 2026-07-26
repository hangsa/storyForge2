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


ALLOWED_PROVIDER_TYPES = {"anthropic", "openai_compatible", "mock"}


def _collect_global_models(data: dict) -> dict[str, str]:
    """Map model id -> provider key for every provider's models dict."""
    out: dict[str, str] = {}
    providers = data.get("providers") or {}
    if not isinstance(providers, dict):
        return out
    for pid, provider in providers.items():
        if not isinstance(provider, dict):
            continue
        models = provider.get("models") or {}
        if not isinstance(models, dict):
            continue
        for mid in models:
            out[mid] = pid
    return out


def validate(data: dict) -> None:
    """Validate a config dict. Raises LLMConfigError with `invalid_paths`
    on failure. Path format: dotted, e.g.
    `tiers.tier_1.models.0.id`, `providers.anthropic.models.claude-opus-4`.
    """
    if not isinstance(data, dict):
        raise LLMConfigError("配置根节点必须是对象", ["$"])

    invalid: list[str] = []

    providers = data.get("providers") or {}
    if not isinstance(providers, dict):
        raise LLMConfigError("providers 必须是对象", ["providers"])

    global_models = _collect_global_models(data)
    seen_ids: set[str] = set()
    first_seen_path: dict[str, str] = {}
    for pid, provider in providers.items():
        path = f"providers.{pid}"
        if not isinstance(provider, dict):
            invalid.append(path)
            continue
        ptype = provider.get("type")
        if ptype not in ALLOWED_PROVIDER_TYPES:
            invalid.append(f"{path}.type")
        if not provider.get("api_key_env"):
            invalid.append(f"{path}.api_key_env")
        base_url = provider.get("base_url")
        if ptype == "openai_compatible" and not base_url:
            invalid.append(f"{path}.base_url")
        models = provider.get("models") or {}
        if not isinstance(models, dict):
            invalid.append(f"{path}.models")
            continue
        for mid, model in models.items():
            mpath = f"{path}.models.{mid}"
            if not isinstance(model, dict):
                invalid.append(mpath)
                continue
            if mid in seen_ids:
                # Report both occurrences so callers can locate each one.
                invalid.append(first_seen_path[mid])
                invalid.append(f"providers.{pid}.models[duplicate_id={mid}]")
            else:
                first_seen_path[mid] = mpath
            seen_ids.add(mid)
            max_tokens = model.get("max_tokens")
            if (
                not isinstance(max_tokens, int)
                or isinstance(max_tokens, bool)
            ):
                invalid.append(f"{mpath}.max_tokens")
            cost_in = model.get("cost_per_1k_input")
            cost_out = model.get("cost_per_1k_output")
            if not isinstance(cost_in, (int, float)) or isinstance(cost_in, bool):
                invalid.append(f"{mpath}.cost_per_1k_input")
            if not isinstance(cost_out, (int, float)) or isinstance(cost_out, bool):
                invalid.append(f"{mpath}.cost_per_1k_output")
            temperature = model.get("temperature")
            if not isinstance(temperature, (int, float)) or isinstance(temperature, bool):
                invalid.append(f"{mpath}.temperature")

    tiers = data.get("tiers") or {}
    if not isinstance(tiers, dict):
        raise LLMConfigError("tiers 必须是对象", ["tiers"])

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

        whitelisted = tier.get("models") or []
        if not isinstance(whitelisted, list) or not whitelisted:
            invalid.append(f"tiers.{tier_name}.models")
            whitelisted = []
        for i, mid in enumerate(whitelisted):
            if not isinstance(mid, str) or mid not in global_models:
                invalid.append(f"tiers.{tier_name}.models.{i}")

        default = tier.get("default")
        if default and default != "none" and default not in global_models:
            invalid.append(f"tiers.{tier_name}.default")
        elif default and default != "none" and default not in whitelisted:
            invalid.append(f"tiers.{tier_name}.default")
        fallback = tier.get("fallback")
        if fallback and fallback not in global_models:
            invalid.append(f"tiers.{tier_name}.fallback")
        elif fallback and fallback not in whitelisted:
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
            if model_id and model_id != "default" and model_id not in global_models:
                invalid.append(f"agent_mapping.{agent_name}.{task_name}.model")
            elif model_id and model_id != "default" and model_id not in tier_models:
                invalid.append(f"agent_mapping.{agent_name}.{task_name}.model")
            fallback = mapping.get("fallback")
            if fallback and fallback != "default" and fallback not in global_models:
                invalid.append(f"agent_mapping.{agent_name}.{task_name}.fallback")
            elif fallback and fallback != "default" and fallback not in tier_models:
                invalid.append(f"agent_mapping.{agent_name}.{task_name}.fallback")

    if invalid:
        raise LLMConfigError(
            f"配置校验失败：{len(invalid)} 项错误", invalid
        )


def find_references(data: dict, target: str) -> list[str]:
    """Return dotted paths referencing the given target.

    `target` forms:
      `provider:<id>` — finds any tier/agent_mapping entry that references a
        model owned by that provider.
      `model:<id>` — finds any tier/agent_mapping entry that references that
        model id directly.
    """
    if ":" not in target:
        raise ValueError(f"target must be 'provider:<id>' or 'model:<id>', got {target!r}")
    kind, value = target.split(":", 1)
    paths: list[str] = []
    tiers = data.get("tiers") or {}
    provider_map = _collect_global_models(data)

    if kind == "model":
        target_id = value
        target_provider = provider_map.get(target_id)
    elif kind == "provider":
        target_id = None
        target_provider = value
    else:
        raise ValueError(f"unknown target kind {kind!r}")

    for tier_name, tier in tiers.items():
        if not isinstance(tier, dict):
            continue
        whitelist = tier.get("models") or []
        if isinstance(whitelist, list):
            for i, mid in enumerate(whitelist):
                if kind == "model" and mid == target_id:
                    paths.append(f"tiers.{tier_name}.models.{i}")
                elif kind == "provider" and provider_map.get(mid) == target_provider:
                    paths.append(f"tiers.{tier_name}.models.{i}")
        default = tier.get("default")
        if isinstance(default, str):
            if kind == "model" and default == target_id:
                paths.append(f"tiers.{tier_name}.default")
            elif kind == "provider" and provider_map.get(default) == target_provider:
                paths.append(f"tiers.{tier_name}.default")
        fallback = tier.get("fallback")
        if isinstance(fallback, str):
            if kind == "model" and fallback == target_id:
                paths.append(f"tiers.{tier_name}.fallback")
            elif kind == "provider" and provider_map.get(fallback) == target_provider:
                paths.append(f"tiers.{tier_name}.fallback")

    mappings = data.get("agent_mapping") or {}
    for agent_name, tasks in mappings.items():
        if not isinstance(tasks, dict):
            continue
        for task_name, mapping in tasks.items():
            if not isinstance(mapping, dict):
                continue
            for field in ("model", "fallback"):
                value = mapping.get(field)
                if not isinstance(value, str):
                    continue
                if kind == "model" and value == target_id:
                    paths.append(f"agent_mapping.{agent_name}.{task_name}.{field}")
                elif kind == "provider" and provider_map.get(value) == target_provider:
                    paths.append(f"agent_mapping.{agent_name}.{task_name}.{field}")
    return paths


def validate_removal(data: dict, target: str) -> None:
    paths = find_references(data, target)
    if paths:
        sample = "，".join(paths[:3]) + ("…" if len(paths) > 3 else "")
        raise LLMConfigError(
            f"无法删除 {target}，仍有 {len(paths)} 处引用：{sample}",
            paths,
        )


def reload_router() -> dict:
    """Validate disk config, then swap the live router's tiers / mappings in."""
    validate(read_yaml())
    router = get_model_router()
    router.reload_config()
    return {"tiers": len(router._tiers), "agents": len(router._mappings)}


def _setting_for_env(env_name: str) -> str:
    """Map an API key env name (e.g. ANTHROPIC_API_KEY) to the matching
    Settings attribute (`anthropic_api_key`). Falls back to the env name
    so unknown keys just return empty (no API key configured)."""
    mapping = {
        "ANTHROPIC_API_KEY": "anthropic_api_key",
        "DEEPSEEK_API_KEY": "deepseek_api_key",
        "MINIMAX_API_KEY": "minimax_api_key",
    }
    return mapping.get(env_name, env_name.lower())


def provider_status() -> list[dict]:
    """Return one record per entry in `providers`.

    Each record carries: `provider`, `type`, `base_url`, `api_key_env`,
    `api_key_configured`, `enabled`, and `models` (list of {id, display_name}).
    Secrets are NEVER serialized.
    """
    cfg = read_yaml()
    providers = cfg.get("providers") or {}
    out: list[dict] = []
    for pid, provider in providers.items():
        if not isinstance(provider, dict):
            continue
        api_key_env = provider.get("api_key_env", "")
        configured = (
            bool(getattr(settings, _setting_for_env(api_key_env), ""))
            if api_key_env
            else False
        )
        models_out = []
        for mid, model in (provider.get("models") or {}).items():
            if not isinstance(model, dict):
                continue
            models_out.append({
                "id": mid,
                "display_name": model.get("display_name", mid),
                "cost_per_1k_input": model.get("cost_per_1k_input", 0),
                "cost_per_1k_output": model.get("cost_per_1k_output", 0),
                "max_tokens": model.get("max_tokens", 8192),
                "temperature": model.get("temperature", 0.7),
                "json_mode": bool(model.get("json_mode", False)),
                "stream": bool(model.get("stream", True)),
            })
        out.append({
            "provider": pid,
            "type": provider.get("type", "openai_compatible"),
            "display_name": provider.get("display_name", pid),
            "base_url": provider.get("base_url", ""),
            "api_key_env": api_key_env,
            "api_key_configured": configured,
            "enabled": bool(provider.get("enabled", True)),
            "models": models_out,
        })
    return out
