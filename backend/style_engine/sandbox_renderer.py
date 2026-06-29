"""Tier-3 preview renderer for the style sandbox.

Reuses StyleExtractor's helpers (_split_sentences, _DIALOGUE_PATTERN) for
sentence-splitting and dialogue detection to stay consistent with v1.6 style
analysis.
"""
from __future__ import annotations

import re
from pathlib import Path

import yaml

from backend.config import settings
from backend.style_engine.sandbox_models import PreviewResponse, SandboxParams
from backend.style_engine.style_extractor import _split_sentences


def compute_avg_length(text: str) -> float:
    """Return average character count per sentence (Chinese-aware)."""
    sentences = _split_sentences(text)
    if not sentences:
        return 0.0
    # Exclude common Chinese/English punctuation from length count
    punct = "，。！？；：、,.!?;:\n\r\t "
    cleaned_lengths = [
        len(re.sub(f"[{re.escape(punct)}]", "", s))
        for s in sentences
    ]
    cleaned_lengths = [n for n in cleaned_lengths if n > 0]
    if not cleaned_lengths:
        return 0.0
    return sum(cleaned_lengths) / len(cleaned_lengths)


def _build_params_description(params: SandboxParams) -> str:
    """Convert SandboxParams to a Chinese-language description for the prompt."""
    s = params.sentence
    d = params.dialogue
    r = params.rhythm
    dens = params.density
    sat = params.satisfaction
    return (
        f"- 句长区间：{s.avg_length_range[0]}–{s.avg_length_range[1]} 字；短句占比 {s.short_sentence_ratio:.0%}；"
        f"段长 {s.paragraph_length_range[0]}–{s.paragraph_length_range[1]} 字\n"
        f"- 对白占比：{d.ratio:.0%}；连续对白 ≤ {d.max_consecutive_lines} 行\n"
        f"- 节奏：{r.pacing_bpm} BPM；场景切换频率 {r.scene_change_frequency:.0%}\n"
        f"- 描写/动作占比：{dens.description_ratio:.0%} / {dens.action_ratio:.0%}\n"
        f"- 爽点/钩子：{sat.satisfaction_beat_count} 处；悬念钩子{'必需' if sat.suspense_hook_required else '可选'}"
    )


_PROMPT_PATH = Path(settings.prompts_dir) / "style_engine" / "sandbox_preview.yaml"


def _load_prompt() -> dict:
    with open(_PROMPT_PATH, encoding="utf-8") as f:
        return yaml.safe_load(f)


async def render_preview(
    *,
    model_router,
    source_text: str,
    params: SandboxParams,
    genre: str,
) -> PreviewResponse:
    """Render a style preview via Tier 3 LLM. Returns skipped response on failure."""
    source_avg = compute_avg_length(source_text)
    try:
        prompt = _load_prompt()
        user_prompt = prompt["user_prompt_template"].format(
            genre=genre,
            params_description=_build_params_description(params),
            source_text=source_text,
        )
        result = await model_router.execute(
            agent_name="style_sandbox",
            task_name="preview",
            messages=[
                {"role": "system", "content": prompt["system_prompt"]},
                {"role": "user", "content": user_prompt},
            ],
            json_mode=False,
            temperature=prompt.get("temperature", 0.6),
            max_tokens=prompt.get("max_tokens", 1024),
        )
        content = (result.get("content") or "").strip()
        usage = result.get("usage", {})
        tokens_used = int(usage.get("input", 0)) + int(usage.get("output", 0))
        if not content:
            return PreviewResponse(
                rendered_text="", source_avg_length=source_avg, rendered_avg_length=0.0,
                tokens_used=tokens_used, skipped_reason="no LLM response",
            )
        # Strip stray markdown fences if present
        if content.startswith("```"):
            content = re.sub(r"^```[a-z]*\n?", "", content)
            content = re.sub(r"\n?```$", "", content)
        rendered_avg = compute_avg_length(content)
        return PreviewResponse(
            rendered_text=content,
            source_avg_length=source_avg,
            rendered_avg_length=rendered_avg,
            tokens_used=tokens_used,
        )
    except Exception as exc:
        return PreviewResponse(
            rendered_text="", source_avg_length=source_avg, rendered_avg_length=0.0,
            tokens_used=0, skipped_reason=f"llm error: {type(exc).__name__}: {exc}",
        )


import re
from datetime import datetime, timezone

from backend.style_engine.sandbox_models import SavedStyleConfig, SandboxParams


_NAME_FORBIDDEN = re.compile(r"[^\w一-鿿\-]+", re.UNICODE)
_NAME_MAX = 64


def _sanitize_name(name: str) -> str:
    cleaned = _NAME_FORBIDDEN.sub("_", name).strip("_")
    if not cleaned:
        cleaned = "unnamed"
    return cleaned[:_NAME_MAX]


def _styles_dir(project_id: str) -> Path:
    base = Path(settings.projects_dir) / project_id / "styles"
    base.mkdir(parents=True, exist_ok=True)
    return base


def save_sandbox_config(*, project_id: str, name: str, params: SandboxParams) -> Path:
    safe = _sanitize_name(name)
    path = _styles_dir(project_id) / f"{safe}.yaml"
    if path.exists():
        raise FileExistsError(f"已存在同名配置：{safe}")
    data = {
        "name": safe,
        "params": params.model_dump(),
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    path.write_text(yaml.safe_dump(data, allow_unicode=True, sort_keys=False), encoding="utf-8")
    return path


def list_sandbox_configs(project_id: str) -> list[SavedStyleConfig]:
    base = Path(settings.projects_dir) / project_id / "styles"
    if not base.exists():
        return []
    configs: list[SavedStyleConfig] = []
    for p in sorted(base.glob("*.yaml")):
        try:
            data = yaml.safe_load(p.read_text(encoding="utf-8"))
        except yaml.YAMLError:
            continue
        if not isinstance(data, dict):
            continue
        configs.append(SavedStyleConfig(
            name=data.get("name", p.stem),
            path=str(p),
            params=SandboxParams(**data.get("params", {})),
            created_at=data.get("created_at", ""),
        ))
    return configs


def load_sandbox_config(*, project_id: str, name: str) -> SavedStyleConfig:
    safe = _sanitize_name(name)
    path = _styles_dir(project_id) / f"{safe}.yaml"
    if not path.exists():
        raise FileNotFoundError(f"配置不存在：{safe}")
    data = yaml.safe_load(path.read_text(encoding="utf-8"))
    return SavedStyleConfig(
        name=data.get("name", safe),
        path=str(path),
        params=SandboxParams(**data.get("params", {})),
        created_at=data.get("created_at", ""),
    )
