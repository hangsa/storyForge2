"""
Style Extractor — analyzes writing style features from reference text.

Deterministic: sentence length stats, dialogue ratio, vocabulary analysis (bigrams + idioms).
LLM-assisted (Tier 3): description type classification, rhythm features.
"""
import re
import json
import asyncio
from pathlib import Path
from dataclasses import dataclass, field, asdict
from collections import Counter
from typing import Optional

import yaml

from backend.config import settings
from backend.utils.file_manager import FileManager


# ── Chinese text helpers ───────────────────────────────────────────────

# Common Chinese idioms (成语) for frequency detection
_COMMON_IDIOMS: set[str] = set("""
一鸣惊人 一帆风顺 一针见血 一目了然 一举两得 三心二意 四面楚歌 五光十色
五颜六色 七上八下 九牛一毛 十全十美 百花齐放 千钧一发 万无一失
不可思议 不言而喻 不翼而飞 不劳而获 与众不同 与日俱增 心旷神怡
心血来潮 心不在焉 心想事成 心安理得 意气风发 意味深长 出人意料
出类拔萃 半途而废 半信半疑 全力以赴 全心全意 自相矛盾
自言自语 自强不息 自然而然 画龙点睛 画蛇添足 对牛弹琴 鹤立鸡群
守株待兔 掩耳盗铃 亡羊补牢 刻舟求剑 叶公好龙 狐假虎威 井底之蛙
独具匠心 别具一格 独树一帜 引人入胜 津津有味 栩栩如生 淋漓尽致
恰如其分 名副其实 名不虚传 无可厚非 显而易见 众所周知 家喻户晓
风平浪静 惊涛骇浪 翻云覆雨 风雨同舟 风雨无阻 雷厉风行
电光石火 光阴似箭 日月如梭 天长地久 海阔天空 山穷水尽 柳暗花明
胸有成竹 炉火纯青 游刃有余 得心应手 轻车熟路 驾轻就熟 如鱼得水
""".split())

_SENTENCE_END = re.compile(r"[。！？…；]\s*")
_DIALOGUE_PATTERN = re.compile(r"[“”\"]([^“”\"]+?)[“”\"]")
# Match 4-char sequences that are likely Chinese words (for bigram extraction)
_CHINESE_CHAR = re.compile(r"[一-鿿]")


def _split_sentences(text: str) -> list[str]:
    """Split Chinese text into sentences, filtering empty."""
    parts = _SENTENCE_END.split(text)
    return [p.strip() for p in parts if p.strip()]


def _char_count(text: str) -> int:
    """Count Chinese characters in text."""
    return len(_CHINESE_CHAR.findall(text))


def _extract_bigrams(text: str) -> list[str]:
    """Extract overlapping character bigrams from Chinese text."""
    chars = _CHINESE_CHAR.findall(text)
    return [chars[i] + chars[i + 1] for i in range(len(chars) - 1)]


def _count_idioms(text: str) -> int:
    """Count how many common idioms appear in text (sliding window, overlapping)."""
    chars = _CHINESE_CHAR.findall(text)
    count = 0
    for i in range(len(chars) - 3):
        candidate = chars[i] + chars[i + 1] + chars[i + 2] + chars[i + 3]
        if candidate in _COMMON_IDIOMS:
            count += 1
    return count


# ── Feature dataclasses ────────────────────────────────────────────────


@dataclass
class SentenceFeatures:
    avg_length: float = 0.0
    distribution: dict = field(default_factory=lambda: {
        "short_pct": 0, "medium_pct": 0, "long_pct": 0,
    })


@dataclass
class DialogueFeatures:
    ratio: float = 0.0
    avg_turn_length: float = 0.0


@dataclass
class DescriptionFeatures:
    environment_pct: float = 0.0
    action_pct: float = 0.0
    psychology_pct: float = 0.0
    other_pct: float = 0.0


@dataclass
class VocabularyFeatures:
    top_words: list = field(default_factory=list)
    idiom_frequency: float = 0.0
    unique_word_ratio: float = 0.0


@dataclass
class RhythmFeatures:
    scene_change_frequency: str = ""
    emotional_peak_density: str = ""


@dataclass
class ExtractedStyle:
    sentence: SentenceFeatures = field(default_factory=SentenceFeatures)
    dialogue: DialogueFeatures = field(default_factory=DialogueFeatures)
    description: DescriptionFeatures = field(default_factory=DescriptionFeatures)
    vocabulary: VocabularyFeatures = field(default_factory=VocabularyFeatures)
    rhythm: RhythmFeatures = field(default_factory=RhythmFeatures)
    source_text_length: int = 0
    name: str = "用户自定义风格"

    def to_dict(self) -> dict:
        return asdict(self)


# ── StyleExtractor ─────────────────────────────────────────────────────


class StyleExtractor:
    """Analyzes writing style features from reference text.

    Sentence/vocabulary/dialogue stats are deterministic calculations.
    Description classification and rhythm detection use Tier 3 LLM.
    """

    def __init__(self, projects_dir: Optional[Path] = None):
        self._projects_dir = Path(projects_dir) if projects_dir else settings.projects_dir
        self._fm = FileManager(self._projects_dir)

    # ── Deterministic analysis ──────────────────────────────────────

    def _analyze_sentences(self, text: str) -> SentenceFeatures:
        sentences = _split_sentences(text)
        if not sentences:
            return SentenceFeatures()

        lengths = [_char_count(s) for s in sentences]
        avg = sum(lengths) / len(lengths)
        total = len(lengths)

        short = sum(1 for l in lengths if l < 15)
        medium = sum(1 for l in lengths if 15 <= l <= 40)
        long = sum(1 for l in lengths if l > 40)

        return SentenceFeatures(
            avg_length=round(avg, 1),
            distribution={
                "short_pct": round(short / total * 100, 1),
                "medium_pct": round(medium / total * 100, 1),
                "long_pct": round(long / total * 100, 1),
            },
        )

    def _analyze_dialogue(self, text: str) -> DialogueFeatures:
        total_chars = _char_count(text)
        if total_chars == 0:
            return DialogueFeatures()

        turns = _DIALOGUE_PATTERN.findall(text)
        if not turns:
            return DialogueFeatures()

        turn_lengths = [_char_count(t) for t in turns]
        dialogue_chars = sum(turn_lengths)
        avg_turn = dialogue_chars / len(turns)

        return DialogueFeatures(
            ratio=round(dialogue_chars / total_chars, 2),
            avg_turn_length=round(avg_turn, 1),
        )

    def _analyze_vocabulary(self, text: str) -> VocabularyFeatures:
        total_chars = _char_count(text)
        if total_chars == 0:
            return VocabularyFeatures()

        bigrams = _extract_bigrams(text)
        if not bigrams:
            return VocabularyFeatures()

        freq = Counter(bigrams)
        top = [word for word, _ in freq.most_common(50)]
        unique_ratio = round(len(set(bigrams)) / len(bigrams), 2)

        idiom_count = _count_idioms(text)
        idiom_freq = round(idiom_count / total_chars, 2)

        return VocabularyFeatures(
            top_words=top,
            idiom_frequency=idiom_freq,
            unique_word_ratio=unique_ratio,
        )

    # ── LLM-assisted analysis ───────────────────────────────────────

    def _classify_descriptions(self, text: str) -> DescriptionFeatures:
        """Use Tier 3 LLM to classify description types in the text."""
        provider = self._get_provider()

        # Sample text at intervals for classification (max ~2000 chars)
        sample = text[:2000]

        system = (
            "你是一个文学文本分析专家。分析给定的中文小说片段，判断描写类型的分布。"
            "只返回 JSON，不要有其他内容。"
        )
        user = (
            "分析以下文本的描写类型，返回各类描写的百分比（总和为100）：\n"
            "- environment: 环境描写（场景、景物、氛围）\n"
            "- action: 动作描写（打斗、移动、操作、行为）\n"
            "- psychology: 心理描写（内心活动、情感、思考）\n"
            "- other: 其他（对话、叙述过渡等）\n\n"
            "返回 JSON 格式："
            '{"environment_pct": 数字, "action_pct": 数字, "psychology_pct": 数字, "other_pct": 数字}\n\n'
            f"文本：\n{sample}"
        )

        try:
            response = asyncio.run(provider.generate(system, user, max_tokens=256, temperature=0.1))
            result = self._parse_json_response(response.text)
            return DescriptionFeatures(
                environment_pct=float(result.get("environment_pct", 25)),
                action_pct=float(result.get("action_pct", 25)),
                psychology_pct=float(result.get("psychology_pct", 25)),
                other_pct=float(result.get("other_pct", 25)),
            )
        except Exception:
            return DescriptionFeatures(25, 25, 25, 25)

    def _detect_rhythm(self, text: str) -> RhythmFeatures:
        """Use Tier 3 LLM to detect scene change and emotional peak frequency."""
        provider = self._get_provider()

        total_chars = _char_count(text)
        if total_chars < 100:
            return RhythmFeatures(
                scene_change_frequency=f"每 ~{total_chars} 字",
                emotional_peak_density=f"每 ~{total_chars} 字",
            )

        sample = text[:3000]

        system = (
            "你是一个文学节奏分析专家。分析给定文本的节奏特征。"
            "只返回 JSON，不要有其他内容。"
        )
        user = (
            "分析以下文本的节奏特征：\n"
            '1. scene_change_frequency: 场景切换的频率，如 "每 ~800 字"\n'
            '2. emotional_peak_density: 情绪高潮的密度，如 "每 ~1200 字"\n\n'
            "返回 JSON 格式：\n"
            '{"scene_change_frequency": "每 ~X 字", "emotional_peak_density": "每 ~Y 字"}\n\n'
            f"文本总长度约 {total_chars} 字。\n\n"
            f"文本：\n{sample}"
        )

        try:
            response = asyncio.run(provider.generate(system, user, max_tokens=256, temperature=0.1))
            result = self._parse_json_response(response.text)
            return RhythmFeatures(
                scene_change_frequency=str(result.get("scene_change_frequency", f"每 ~{total_chars // 2} 字")),
                emotional_peak_density=str(result.get("emotional_peak_density", f"每 ~{total_chars} 字")),
            )
        except Exception:
            return RhythmFeatures(
                scene_change_frequency=f"每 ~{total_chars // 2} 字",
                emotional_peak_density=f"每 ~{total_chars} 字",
            )

    def _get_provider(self):
        from backend.llm import create_provider
        return create_provider()

    def _parse_json_response(self, text: str) -> dict:
        """Extract JSON from LLM response, handling markdown fences."""
        text = text.strip()
        # Try direct parse first
        try:
            return json.loads(text)
        except json.JSONDecodeError:
            pass
        # Try extracting from markdown code block
        match = re.search(r"```(?:json)?\s*\n?(.*?)\n?```", text, re.DOTALL)
        if match:
            return json.loads(match.group(1))
        # Try finding JSON object in text
        match = re.search(r"\{.*\}", text, re.DOTALL)
        if match:
            return json.loads(match.group(0))
        return {}

    # ── Main pipeline ────────────────────────────────────────────────

    def extract(self, reference_text: str) -> ExtractedStyle:
        """Run full analysis pipeline on reference text."""
        text = reference_text.strip()
        total_chars = _char_count(text)

        style = ExtractedStyle(
            sentence=self._analyze_sentences(text),
            dialogue=self._analyze_dialogue(text),
            vocabulary=self._analyze_vocabulary(text),
            source_text_length=total_chars,
        )

        # LLM-assisted (skip if no LLM configured or text too short)
        if total_chars >= 100:
            try:
                style.description = self._classify_descriptions(text)
            except Exception:
                pass
            try:
                style.rhythm = self._detect_rhythm(text)
            except Exception:
                pass

        return style

    def save(self, project_id: str, style: ExtractedStyle) -> Path:
        """Save extracted style to projects/{id}/style/extracted_style.yaml."""
        style_dir = self._projects_dir / project_id / "style"
        style_dir.mkdir(parents=True, exist_ok=True)

        path = style_dir / "extracted_style.yaml"
        with open(path, "w", encoding="utf-8") as f:
            yaml.dump(style.to_dict(), f, allow_unicode=True, default_flow_style=False, sort_keys=False)

        return path
