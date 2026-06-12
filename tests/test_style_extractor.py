"""
Style Extractor unit tests.
Tests: sentence analysis, dialogue analysis, vocabulary analysis, save, API endpoints.
"""
import tempfile
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from backend.style_engine.style_extractor import (
    StyleExtractor,
    ExtractedStyle,
    SentenceFeatures,
    DialogueFeatures,
    VocabularyFeatures,
    DescriptionFeatures,
    RhythmFeatures,
    _split_sentences,
    _char_count,
    _extract_bigrams,
    _count_idioms,
)
from backend.main import app


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture
def projects_dir():
    with tempfile.TemporaryDirectory() as tmp:
        yield Path(tmp)


# ── Helpers ───────────────────────────────────────────────────────────


SAMPLE_TEXT = (
    "林峰站在城西烂尾楼的废墟上，冷风吹过他的脸颊。"
    "他握紧了拳头，指节发出咔咔的响声。"
    "“你真的要这么做吗？”身后传来一个低沉的声音。"
    "林峰没有回头。“没有退路了。”"
    "他心中翻涌着复杂的情绪——愤怒、不甘，还有一丝说不清的恐惧。"
    "这座城市太大了，大到吞噬了他的一切。"
    "但他心意已决。无论如何，今晚必须有个了断。"
    "他缓缓走向那座废弃多年的工厂。月光下，他的影子拉得很长。"
    "突然，一道黑影从厂房内闪过。林峰心中一凛，脚步却不曾停歇。"
    "他已经做好了准备。"
)

SAMPLE_WITH_IDIOMS = (
    "他做事从来都是一帆风顺，没想到今天却四面楚歌。"
    "虽然心中七上八下，但他表面上依然风平浪静。"
    "这个计划天衣无缝，简直不可思议，却又在情理之中。"
)


# ── Helper Functions ──────────────────────────────────────────────────


class TestHelpers:
    def test_split_sentences(self):
        parts = _split_sentences("林峰站在废墟上。冷风吹过。他握紧了拳头。")
        assert len(parts) == 3
        assert parts[0] == "林峰站在废墟上"
        assert parts[1] == "冷风吹过"
        assert parts[2] == "他握紧了拳头"

    def test_split_sentences_empty(self):
        assert _split_sentences("") == []

    def test_char_count(self):
        assert _char_count("林峰站在废墟上") == 7
        assert _char_count("Hello世界") == 2

    def test_extract_bigrams(self):
        bigrams = _extract_bigrams("林峰站")
        assert len(bigrams) == 2
        assert "林峰" in bigrams
        assert "峰站" in bigrams

    def test_extract_bigrams_short_text(self):
        assert _extract_bigrams("林") == []

    def test_count_idioms(self):
        count = _count_idioms("他一鸣惊人，做事一帆风顺")
        assert count == 2

    def test_count_idioms_none(self):
        assert _count_idioms("林峰站在废墟上") == 0


# ── Sentence Analysis ─────────────────────────────────────────────────


class TestSentenceAnalysis:
    def test_normal_text(self, projects_dir):
        extractor = StyleExtractor(projects_dir)
        result = extractor._analyze_sentences(SAMPLE_TEXT)
        assert result.avg_length > 0
        assert result.distribution["short_pct"] >= 0
        assert result.distribution["medium_pct"] >= 0
        assert result.distribution["long_pct"] >= 0
        total = sum(result.distribution.values())
        assert abs(total - 100.0) < 1.0

    def test_empty_text(self, projects_dir):
        extractor = StyleExtractor(projects_dir)
        result = extractor._analyze_sentences("")
        assert result.avg_length == 0
        assert result.distribution["short_pct"] == 0

    def test_single_sentence(self, projects_dir):
        extractor = StyleExtractor(projects_dir)
        result = extractor._analyze_sentences("这是一个测试句子而已。")
        assert result.avg_length > 0
        total = sum(result.distribution.values())
        assert abs(total - 100.0) < 1.0

    def test_distribution_categories(self, projects_dir):
        """Short(<15), medium(15-40), long(>40) sentence distribution."""
        text = (
            "短句。"                          # ~2 chars
            "这是一个中等长度的句子测试文本。"    # ~13 chars
            + "很长" * 30 + "。"
        )
        extractor = StyleExtractor(projects_dir)
        result = extractor._analyze_sentences(text)
        assert result.distribution["short_pct"] > 0
        assert result.distribution["long_pct"] > 0


# ── Dialogue Analysis ─────────────────────────────────────────────────


class TestDialogueAnalysis:
    def test_detects_dialogue(self, projects_dir):
        extractor = StyleExtractor(projects_dir)
        result = extractor._analyze_dialogue(
            '林峰说："你真的要这么做吗？"她沉默片刻。"是的。"'
        )
        assert result.ratio > 0
        assert result.avg_turn_length > 0

    def test_no_dialogue(self, projects_dir):
        extractor = StyleExtractor(projects_dir)
        result = extractor._analyze_dialogue("林峰站在废墟上。冷风吹过。")
        assert result.ratio == 0
        assert result.avg_turn_length == 0

    def test_empty_text(self, projects_dir):
        extractor = StyleExtractor(projects_dir)
        result = extractor._analyze_dialogue("")
        assert result.ratio == 0


# ── Vocabulary Analysis ───────────────────────────────────────────────


class TestVocabularyAnalysis:
    def test_top_words_from_bigrams(self, projects_dir):
        extractor = StyleExtractor(projects_dir)
        result = extractor._analyze_vocabulary("林峰林峰林峰站着站着")
        assert len(result.top_words) > 0
        # "林峰" (大林峰组) should be high frequency
        assert result.top_words[0] in ["林峰", "峰林"]

    def test_empty_text(self, projects_dir):
        extractor = StyleExtractor(projects_dir)
        result = extractor._analyze_vocabulary("")
        assert result.top_words == []
        assert result.idiom_frequency == 0
        assert result.unique_word_ratio == 0

    def test_idiom_frequency(self, projects_dir):
        extractor = StyleExtractor(projects_dir)
        result = extractor._analyze_vocabulary(SAMPLE_WITH_IDIOMS)
        assert result.idiom_frequency > 0

    def test_unique_word_ratio(self, projects_dir):
        extractor = StyleExtractor(projects_dir)
        result = extractor._analyze_vocabulary("林峰林峰林峰")
        # Repeating same bigram → low uniqueness
        assert result.unique_word_ratio < 1.0

    def test_top_words_capped_at_50(self, projects_dir):
        extractor = StyleExtractor(projects_dir)
        result = extractor._analyze_vocabulary(SAMPLE_TEXT * 10)
        assert len(result.top_words) <= 50


# ── Extract Pipeline ──────────────────────────────────────────────────


class TestExtractPipeline:
    def test_full_extract_deterministic(self, projects_dir):
        """Deterministic features should be populated even without LLM."""
        extractor = StyleExtractor(projects_dir)
        style = extractor.extract(SAMPLE_TEXT)
        assert style.sentence.avg_length > 0
        assert style.vocabulary.top_words  # has vocabulary
        assert style.source_text_length > 0
        assert style.name == "用户自定义风格"

    def test_extract_empty_text(self, projects_dir):
        extractor = StyleExtractor(projects_dir)
        style = extractor.extract("")
        assert style.source_text_length == 0
        assert style.sentence.avg_length == 0

    def test_extract_short_text_skips_llm(self, projects_dir):
        """Text under 100 chars skips LLM-assisted analysis."""
        extractor = StyleExtractor(projects_dir)
        style = extractor.extract("短文本。")
        # Deterministic features should work
        assert style.sentence.avg_length > 0
        # LLM features should have defaults
        assert style.description.environment_pct == 0
        assert style.rhythm.scene_change_frequency == ""

    def test_extracted_style_to_dict(self, projects_dir):
        extractor = StyleExtractor(projects_dir)
        style = extractor.extract(SAMPLE_TEXT)
        d = style.to_dict()
        assert "sentence" in d
        assert "dialogue" in d
        assert "vocabulary" in d
        assert "description" in d
        assert "rhythm" in d

    def test_default_description_values(self, projects_dir):
        extractor = StyleExtractor(projects_dir)
        style = extractor.extract("短。")
        assert style.description.environment_pct == 0
        assert style.description.action_pct == 0
        assert style.description.psychology_pct == 0
        assert style.description.other_pct == 0


# ── Save ──────────────────────────────────────────────────────────────


class TestSave:
    def test_saves_to_project_dir(self, projects_dir):
        project_id = "proj_style_test"
        extractor = StyleExtractor(projects_dir)
        style = extractor.extract(SAMPLE_TEXT)

        path = extractor.save(project_id, style)
        assert path.exists()
        assert path.parent.name == "style"
        assert path.name == "extracted_style.yaml"

    def test_creates_style_dir(self, projects_dir):
        project_id = "proj_style_test"
        style_dir = projects_dir / project_id / "style"
        assert not style_dir.exists()

        extractor = StyleExtractor(projects_dir)
        style = extractor.extract(SAMPLE_TEXT)
        extractor.save(project_id, style)

        assert style_dir.exists()

    def test_saved_yaml_is_valid(self, projects_dir):
        import yaml

        project_id = "proj_style_test"
        extractor = StyleExtractor(projects_dir)
        style = extractor.extract(SAMPLE_TEXT)
        path = extractor.save(project_id, style)

        with open(path, "r", encoding="utf-8") as f:
            data = yaml.safe_load(f)

        assert data["sentence"]["avg_length"] > 0
        assert "top_words" in data["vocabulary"]


# ── API Endpoints ─────────────────────────────────────────────────────


class TestStyleAPI:
    def test_extract_success(self, client):
        """POST /api/style/extract with valid input."""
        create_resp = client.post("/api/project/create", json={
            "title": "风格测试", "genre": "cool_novel", "min_words": 4000,
            "free_text": "测试风格提取",
        })
        proj_id = create_resp.json()["detail"]["id"]

        resp = client.post("/api/style/extract", json={
            "project_id": proj_id,
            "reference_text": SAMPLE_TEXT,
        })
        assert resp.status_code == 200
        data = resp.json()
        assert data["error"] is False
        detail = data["detail"]
        assert detail["sentence"]["avg_length"] > 0
        assert detail["source_text_length"] > 0

    def test_extract_missing_project_id(self, client):
        resp = client.post("/api/style/extract", json={
            "project_id": "", "reference_text": "测试",
        })
        assert resp.status_code == 400
        assert resp.json()["detail"]["code"] == "VALIDATION_ERROR"

    def test_extract_missing_text(self, client):
        create_resp = client.post("/api/project/create", json={
            "title": "测试", "genre": "cool_novel", "min_words": 4000,
            "free_text": "测试",
        })
        proj_id = create_resp.json()["detail"]["id"]

        resp = client.post("/api/style/extract", json={
            "project_id": proj_id, "reference_text": "",
        })
        assert resp.status_code == 400
        assert resp.json()["detail"]["code"] == "VALIDATION_ERROR"

    def test_extract_whitespace_only_text(self, client):
        create_resp = client.post("/api/project/create", json={
            "title": "测试", "genre": "cool_novel", "min_words": 4000,
            "free_text": "测试",
        })
        proj_id = create_resp.json()["detail"]["id"]

        resp = client.post("/api/style/extract", json={
            "project_id": proj_id, "reference_text": "   ",
        })
        assert resp.status_code == 400


# ── Dataclass Defaults ────────────────────────────────────────────────


class TestDataclassDefaults:
    def test_sentence_features_default(self):
        s = SentenceFeatures()
        assert s.avg_length == 0.0
        assert s.distribution["short_pct"] == 0

    def test_dialogue_features_default(self):
        d = DialogueFeatures()
        assert d.ratio == 0.0

    def test_vocabulary_features_default(self):
        v = VocabularyFeatures()
        assert v.top_words == []

    def test_description_features_default(self):
        d = DescriptionFeatures()
        assert d.environment_pct == 0.0

    def test_rhythm_features_default(self):
        r = RhythmFeatures()
        assert r.scene_change_frequency == ""

    def test_extracted_style_default(self):
        s = ExtractedStyle()
        assert s.name == "用户自定义风格"
        assert s.source_text_length == 0
