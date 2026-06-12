"""Shared JSON parsing utilities for LLM response extraction."""

import json
import re
from typing import Optional


def parse_json_strict(text: str) -> Optional[dict]:
    """Try direct parse, then markdown code block extraction. No loose fallback."""
    text = text.strip()
    if not text:
        return None

    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass

    match = re.search(r"```(?:json)?\s*([\s\S]*?)\s*```", text)
    if match:
        try:
            return json.loads(match.group(1))
        except json.JSONDecodeError:
            pass

    return None


def parse_json_text(text: str) -> Optional[dict]:
    """Try strict parse, then markdown block, then loose { } extraction."""
    result = parse_json_strict(text)
    if result is not None:
        return result

    start = text.find("{")
    end = text.rfind("}")
    if start != -1 and end != -1 and start < end:
        try:
            return json.loads(text[start : end + 1])
        except json.JSONDecodeError:
            pass

    return None
