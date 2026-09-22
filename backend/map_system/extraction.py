"""location mention extraction — 把场景文本里的中文地名 mentions 解析为 canonical id。

两个入口:
  - extract_mentions_from_text(project_id, chapter, text) -> dict[alias, canonical_id]
    纯字典查:遍历 text,匹配 map 的 name + alias + region name,命中即返回。零 LLM。

  - extract_mentions_with_llm(project_id, chapter, text, model_router=None)
    -> dict[alias, canonical_id]
    Tier-1 LLM 处理 ambiguous 表述("那座北门的城"、"临河的小镇" 等)。
    config/model_tiers.yaml 已经把 `planner.map_system` 路由到 tier_1。
    默认 model_router 通过 backend.llm.model_router.get_model_router() 获取,
    tests 通过注入 _MockRouter 旁路。

JSON 输出 schema(LLM 路径):
  {"mentions": {"<alias>": "<canonical_id>", ...}}
LLM 返回的 canonical_id 若不在 map.json 中会被丢弃(避免 hallucinated ID)。
"""
from __future__ import annotations

import json
import logging
import re
from typing import Optional

from backend.map_system.storage import build_name_index, load_map

logger = logging.getLogger(__name__)

# Match CJK runs (length 2-12) — long enough to be a real name, short
# enough to skip 90% of prose. Words shorter than 2 chars rarely form
# location names; longer than 12 chars are usually phrases.
_CJK_RUN_RE = re.compile(r"[一-鿿]{2,12}")


def _all_candidate_phrases(index: dict[str, str]) -> list[str]:
    """Sort index keys longest-first so '黑水镇北门' matches before '黑水镇'."""
    return sorted(index.keys(), key=lambda k: -len(k))


def extract_mentions_from_text(
    project_id: str, chapter: int, text: str
) -> dict[str, str]:
    """Deterministic alias → canonical resolution by dictionary lookup.

    Scans `text` for CJK runs and matches each against the name_to_id
    reverse index (built from Plan 1's Map.name/alias/region_name fields).
    Longest-match wins per CJK position.

    Returns {} when no map.json or no matches.
    """
    if not text:
        return {}
    data = load_map(project_id)
    if not data:
        return {}

    index = build_name_index(project_id)
    if not index:
        return {}

    phrases = _all_candidate_phrases(index)
    # Build a single regex alternation of all phrases (longest-first).
    # Phrases that overlap shorter ones (e.g. "黑水镇北门" / "黑水镇")
    # are handled by re.finditer's leftmost-longest greedy behavior.
    phrase_alt = "|".join(re.escape(p) for p in phrases)
    if not phrase_alt:
        return {}
    pattern = re.compile(phrase_alt)

    matches: dict[str, str] = {}
    for m in pattern.finditer(text):
        alias = m.group(0)
        canonical_id = index.get(alias)
        if canonical_id:
            matches[alias] = canonical_id
    return matches


async def extract_mentions_with_llm(
    project_id: str,
    chapter: int,
    text: str,
    model_router=None,
) -> dict[str, str]:
    """LLM-assisted mention resolution for ambiguous circumlocutions.

    Uses `planner.map_system` tier (already mapped to tier_1 in
    config/model_tiers.yaml). When `model_router` is None, falls back
    to `backend.llm.model_router.get_model_router()`.
    """
    if not text:
        return {}

    data = load_map(project_id)
    if not data:
        return {}

    # Build a catalog of canonical locations for the LLM prompt.
    catalog_lines = []
    for loc in data.get("locations", []):
        aliases = loc.get("aliases", [])
        alias_str = f" (aliases: {', '.join(aliases)})" if aliases else ""
        catalog_lines.append(f"- {loc['id']}: {loc['name']}{alias_str}")
    for region in data.get("regions", []):
        aliases = region.get("aliases", [])
        alias_str = f" (aliases: {', '.join(aliases)})" if aliases else ""
        catalog_lines.append(f"- {region['id']}: {region['name']}{alias_str}")
    catalog = "\n".join(catalog_lines)

    user_prompt = (
        f"请阅读以下中文场景文本,提取其中提到的地名 mentions(可包含绰号、"
        f"指代、隐喻),并把每个 mention 解析到下列 canonical id 之一。\n\n"
        f"## 已知地点 catalog:\n{catalog}\n\n"
        f"## 场景文本:\n{text[:3000]}\n\n"
        f"输出 JSON 格式(仅输出 JSON,不要任何其他文字):\n"
        f'{{"mentions": {{"<alias>": "<canonical_id>", ...}}}}\n'
    )

    if model_router is None:
        from backend.llm.model_router import get_model_router
        model_router = get_model_router()

    try:
        # Production ModelRouter uses execute(agent_name, task_name, messages,
        # ...). Test mocks pass an object exposing execute() returning
        # `{"content": str, ...}`. The previous `route()` call shape was a
        # legacy alias that no longer exists on ModelRouter.
        response = await model_router.execute(
            agent_name="planner",
            task_name="location_mention_extraction",  # 独立 key,Q3 决策;与 generate_map 不共享配额
            messages=[
                {"role": "system", "content": "你是一个中文地名 mentions 解析助手。"},
                {"role": "user", "content": user_prompt},
            ],
            json_mode=True,
        )
    except Exception as e:
        logger.warning("[map] mention extraction LLM call failed: %s", e)
        return {}

    # Production returns dict {"content": ...}; tests may return either a
    # dict or an object with `.text`. Tolerate both.
    if isinstance(response, dict):
        raw = response.get("content", "") or ""
    else:
        raw = getattr(response, "text", "") or ""
    parsed = _parse_mentions_json(raw)
    if parsed is None:
        return {}

    # Validate against the map's known ids
    valid_ids = {
        loc["id"] for loc in data.get("locations", [])
    } | {r["id"] for r in data.get("regions", [])}
    valid_ids |= {poi["id"] for poi in data.get("pois", [])}

    out: dict[str, str] = {}
    for alias, canonical_id in parsed.get("mentions", {}).items():
        if canonical_id in valid_ids:
            out[alias] = canonical_id
    return out


def _parse_mentions_json(raw: str) -> Optional[dict]:
    """Parse LLM output. Tolerate ```json fences and trailing garbage."""
    if not raw:
        return None
    stripped = raw.strip()
    # Strip ```json ... ``` fences if present
    if stripped.startswith("```"):
        stripped = re.sub(r"^```(?:json)?\s*\n?", "", stripped)
        stripped = re.sub(r"\n?```\s*$", "", stripped)
    try:
        return json.loads(stripped)
    except Exception:
        # Try greedy regex for the {"mentions": {...}} block
        m = re.search(r'\{\s*"mentions"\s*:\s*\{(.*?)\}\s*\}', raw, re.DOTALL)
        if m:
            try:
                return json.loads("{" + m.group(0)[1:-1] + "}")
            except Exception:
                return None
        return None


__all__ = ["extract_mentions_from_text", "extract_mentions_with_llm"]