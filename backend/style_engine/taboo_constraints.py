"""StoryForge v1.6 Phase 4b -- TabooConstraintChecker for L3 taboo constraint detection."""
import re
import logging
from dataclasses import dataclass

logger = logging.getLogger(__name__)


@dataclass
class TabooViolation:
    pattern_name: str       # e.g. "虐主", "全局-元引用", "角色-林峰-禁止示弱"
    layer: str              # "global" | "genre" | "character"
    severity: str           # "error" | "warning"
    matched_text: str       # violating text snippet (~80 chars)
    context: str            # surrounding context (match_start-100 to match_end+100)


# --- Layer 1: Global taboo patterns (hardcoded, zero LLM) ---

_GLOBAL_TABOOS: list[dict] = [
    # Meta-reference -- error
    {"pattern": r"如果这是一本小说", "name": "全局-元引用", "severity": "error"},
    {"pattern": r"作者说", "name": "全局-元引用", "severity": "error"},
    {"pattern": r"读者朋友们", "name": "全局-元引用", "severity": "error"},
    {"pattern": r"本章完", "name": "全局-元引用", "severity": "error"},
    # Meta-reference -- warning
    {"pattern": r"按下不表", "name": "全局-元引用", "severity": "warning"},
    {"pattern": r"暂且不提", "name": "全局-元引用", "severity": "warning"},
    {"pattern": r"后文再续", "name": "全局-元引用", "severity": "warning"},
    # 4th wall breaks -- warning
    {"pattern": r"各位看官", "name": "全局-元引用", "severity": "warning"},
    {"pattern": r"书接上文", "name": "全局-元引用", "severity": "warning"},
    # Real brand names -- error
    {"pattern": r"\b(iPhone|iPad|MacBook|Apple Watch)\b", "name": "全局-真实品牌", "severity": "error"},
    {"pattern": r"(微信|支付宝|抖音|淘宝|百度|京东|美团|滴滴)", "name": "全局-真实品牌", "severity": "error"},
    {"pattern": r"\b(Nike|Adidas|Starbucks|McDonald'?s?|Google|Microsoft)\b", "name": "全局-真实品牌", "severity": "error"},
    # Real platforms in-story -- error
    {"pattern": r"(起点中文网|起点|番茄小说|晋江文学城|晋江)", "name": "全局-真实平台", "severity": "error"},
]


def _extract_context(text: str, match_start: int, match_end: int) -> str:
    """Extract ~200 chars of context around a match."""
    start = max(0, match_start - 100)
    end = min(len(text), match_end + 100)
    return text[start:end]


def _extract_matched(text: str, match_start: int, match_end: int) -> str:
    """Extract ~80 chars of matched text snippet."""
    start = max(0, match_start - 10)
    end = min(len(text), match_end + 70)
    return text[start:end]


class TabooConstraintChecker:
    """L3 taboo constraint detection -- 3 layers, only character taboos use Tier 3 LLM."""

    def check_sync(
        self, scene_text: str, genre_taboos: list[dict], character_taboos: list[dict]
    ) -> list[TabooViolation]:
        """
        Layers 1-2 only (zero LLM).

        Args:
            scene_text: Scene draft text to check
            genre_taboos: List of taboo entries from genre template YAML taboos block
            character_taboos: List of dicts with {"name": str, "taboos": list[str]}

        Returns:
            list[TabooViolation] -- merged results from Layers 1-2
        """
        if not scene_text or not scene_text.strip():
            return []

        violations = []
        violations.extend(self._check_global_taboos(scene_text))
        violations.extend(self._check_genre_taboos(scene_text, genre_taboos))
        return violations

    def _check_global_taboos(self, scene_text: str) -> list[TabooViolation]:
        """Global taboo detection (regex + keyword, zero LLM)."""
        violations = []
        for entry in _GLOBAL_TABOOS:
            pattern = entry["pattern"]
            matches = list(re.finditer(pattern, scene_text))
            for m in matches:
                violations.append(TabooViolation(
                    pattern_name=entry["name"],
                    layer="global",
                    severity=entry["severity"],
                    matched_text=_extract_matched(scene_text, m.start(), m.end()),
                    context=_extract_context(scene_text, m.start(), m.end()),
                ))
        return violations

    def _check_genre_taboos(
        self, scene_text: str, genre_taboos: list[dict]
    ) -> list[TabooViolation]:
        """Genre taboo detection (YAML-driven, zero LLM).

        Supports three types:
        - keyword: simple keyword match against words list
        - sliding_window: keyword density in sliding windows
        - consecutive_match: consecutive paragraphs containing failure keywords
        """
        if not genre_taboos:
            return []

        violations = []
        for taboo in genre_taboos:
            taboo_type = taboo.get("type", "")
            if taboo_type == "keyword":
                violations.extend(self._check_keyword_taboo(scene_text, taboo))
            elif taboo_type == "sliding_window":
                violations.extend(self._check_sliding_window(scene_text, taboo))
            elif taboo_type == "consecutive_match":
                violations.extend(self._check_consecutive_match(scene_text, taboo))
            # Unknown type → skip silently
        return violations

    def _check_keyword_taboo(
        self, scene_text: str, taboo: dict
    ) -> list[TabooViolation]:
        words = taboo.get("words", [])
        if not words:
            return []
        violations = []
        for word in words:
            for m in re.finditer(re.escape(word), scene_text):
                violations.append(TabooViolation(
                    pattern_name=taboo["name"],
                    layer="genre",
                    severity=taboo.get("severity", "error"),
                    matched_text=_extract_matched(scene_text, m.start(), m.end()),
                    context=_extract_context(scene_text, m.start(), m.end()),
                ))
        return violations

    def _check_sliding_window(
        self, scene_text: str, taboo: dict
    ) -> list[TabooViolation]:
        keywords = taboo.get("keywords", [])
        max_chars = taboo.get("max_chars", 300)
        if not keywords or max_chars <= 0:
            return []

        step = max(1, max_chars // 4)
        violations = []
        last_reported_end = -max_chars  # ensure first window always reports

        for start in range(0, len(scene_text), step):
            window_end = min(len(scene_text), start + max_chars)
            window = scene_text[start:window_end]

            hit_count = 0
            hit_positions = []
            for kw in keywords:
                for m in re.finditer(re.escape(kw), window):
                    hit_count += 1
                    hit_positions.append(start + m.start())

            if hit_count >= 3:
                if start >= last_reported_end:
                    last_reported_end = start + max_chars
                    match_pos = hit_positions[0] if hit_positions else start
                    violations.append(TabooViolation(
                        pattern_name=taboo["name"],
                        layer="genre",
                        severity=taboo.get("severity", "error"),
                        matched_text=_extract_matched(scene_text, match_pos, match_pos + 10),
                        context=_extract_context(scene_text, start, window_end),
                    ))

        return violations

    def _check_consecutive_match(
        self, scene_text: str, taboo: dict
    ) -> list[TabooViolation]:
        failure_keywords = taboo.get("failure_keywords", [])
        max_consecutive = taboo.get("max_consecutive", 2)
        if not failure_keywords:
            return []

        paragraphs = [p.strip() for p in scene_text.split("\n\n") if p.strip()]
        if not paragraphs:
            return []

        # Find all consecutive runs
        hit_runs: list[list[int]] = []
        current_run: list[int] = []

        for i, para in enumerate(paragraphs):
            hit = any(
                re.search(re.escape(kw), para)
                for kw in failure_keywords
            )
            if hit:
                current_run.append(i)
            else:
                if len(current_run) >= max_consecutive:
                    hit_runs.append(current_run)
                current_run = []

        # Don't forget trailing run
        if len(current_run) >= max_consecutive:
            hit_runs.append(current_run)

        violations = []
        for run in hit_runs:
            # Find position in original text
            first_para = paragraphs[run[0]]
            match_start = scene_text.find(first_para)
            if match_start == -1:
                match_start = 0
            violations.append(TabooViolation(
                pattern_name=taboo["name"],
                layer="genre",
                severity=taboo.get("severity", "error"),
                matched_text=first_para[:80],
                context=_extract_context(scene_text, match_start, match_start + len(first_para)),
            ))

        return violations

    async def check_async(
        self, scene_text: str, genre_taboos: list[dict], character_taboos: list[dict]
    ) -> list[TabooViolation]:
        """Full 3-layer check. Stub -- implemented in Task 5."""
        return self.check_sync(scene_text, genre_taboos, character_taboos)

    def _check_character_taboos(
        self, scene_text: str, character_taboos: list[dict]
    ) -> list[TabooViolation]:
        """Character taboo keyword matching (sync part). Stub -- implemented in Task 5."""
        return []

    async def _check_character_taboos_async(
        self, scene_text: str, character_taboos: list[dict]
    ) -> list[TabooViolation]:
        """Character taboo keyword + Tier 3 LLM confirmation. Stub -- implemented in Task 5."""
        return []
