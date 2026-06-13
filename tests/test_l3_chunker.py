"""Tests for TextChunker and BgeM3Embedder (Phase 2.1)."""

import pytest
from backend.memory_os.l3_chunker import TextChunker, TextChunk, BgeM3Embedder, _SF_LOG_STRIP_PATTERN


class TestTextChunker:
    def test_split_single_paragraph(self):
        chunker = TextChunker()
        chunks = chunker.split_scene(
            "主角独自走在寂静的街道上，路灯闪烁不定。",
            project_id="proj_test", chapter_number=1, scene_number=1,
        )
        assert len(chunks) == 1
        assert "主角独自走" in chunks[0].text
        assert "SF_LOG" not in chunks[0].text

    def test_split_multiple_paragraphs(self):
        chunker = TextChunker()
        text = "第一段内容。\n\n第二段内容。\n\n第三段内容。"
        chunks = chunker.split_scene(
            text, project_id="proj_test", chapter_number=1, scene_number=1,
        )
        assert len(chunks) == 1  # short paragraphs merged or kept as one
        # Actually with very short content, all merge into one buffer

    def test_metadata_correct(self):
        chunker = TextChunker()
        chunks = chunker.split_scene(
            "林峰站在废墟上，眺望远方。" * 10,
            project_id="proj_x", chapter_number=3, scene_number=5,
        )
        for c in chunks:
            assert c.project_id == "proj_x"
            assert c.chapter_number == 3
            assert c.scene_number == 5
            assert c.chunk_id.startswith("ch3_sc5_")

    def test_empty_text(self):
        chunker = TextChunker()
        chunks = chunker.split_scene("", "proj_test", 1, 1)
        assert chunks == []

    def test_sf_log_stripped(self):
        chunker = TextChunker()
        text = (
            "林峰走向实验室。\n\n"
            "<!-- SF_LOG character_emotion char=\"林峰\" emotion=\"愤怒\" trigger=\"发现真相\" -->\n\n"
            "他发现了一个惊人的秘密。"
        )
        chunks = chunker.split_scene(text, "proj_test", 1, 1)
        for c in chunks:
            assert "SF_LOG" not in c.text
            assert "character_emotion" not in c.text

    def test_split_chapter_multiple_scenes(self):
        chunker = TextChunker()
        scenes = [
            "场景一文本。" * 50,
            "场景二文本。" * 50,
        ]
        chunks = chunker.split_chapter(scenes, "proj_test", 2)
        assert len(chunks) >= 2
        scenes_found = {c.scene_number for c in chunks}
        assert scenes_found == {1, 2}

    def test_long_paragraph_split(self):
        chunker = TextChunker()
        # Build a paragraph that exceeds MAX_CHUNK_LENGTH (500)
        long_text = "这是一段很长的文本。" * 100
        chunks = chunker.split_scene(long_text, "proj_test", 1, 1)
        # Should be split into multiple chunks
        assert len(chunks) >= 2

    def test_chunk_ids_unique(self):
        chunker = TextChunker()
        text = "段落一。\n\n段落二。\n\n段落三。\n\n段落四。" * 20
        chunks = chunker.split_scene(text, "proj_test", 1, 1)
        ids = [c.chunk_id for c in chunks]
        assert len(ids) == len(set(ids))


class TestBgeM3Embedder:
    def test_init_not_loaded(self):
        embedder = BgeM3Embedder()
        assert embedder._model is None
        assert embedder._available is None

    def test_embed_empty_list(self):
        embedder = BgeM3Embedder()
        result = embedder.embed([])
        assert result.shape[0] == 0

    def test_embed_query_returns_correct_dim(self):
        embedder = BgeM3Embedder()
        embedder.ensure_loaded()
        if not embedder.available:
            pytest.skip("BgeM3 model not available")
        vec = embedder.embed_query("测试查询")
        assert vec.shape == (1024,)
        assert vec.dtype.name == "float32"

    def test_embed_batch_returns_correct_shape(self):
        embedder = BgeM3Embedder()
        embedder.ensure_loaded()
        if not embedder.available:
            pytest.skip("BgeM3 model not available")
        texts = ["文本一", "文本二", "文本三"]
        result = embedder.embed(texts)
        assert result.shape == (3, 1024)


class TestSFLogStripping:
    def test_strips_single_line_sf_log(self):
        text = "前面文字 <!-- SF_LOG character_emotion char=\"A\" emotion=\"怒\" --> 后面文字"
        result = _SF_LOG_STRIP_PATTERN.sub("", text)
        assert "SF_LOG" not in result
        assert "前面文字" in result
        assert "后面文字" in result

    def test_strips_multiline_sf_log(self):
        text = "开始\n<!-- SF_LOG registry_create type=\"conflict\"\ndata='{\"key\":\"value\"}' -->\n结束"
        result = _SF_LOG_STRIP_PATTERN.sub("", text)
        assert "SF_LOG" not in result
        assert "开始" in result
        assert "结束" in result

    def test_leaves_non_sf_log_comments(self):
        text = "文字 <!-- 普通 HTML 注释 --> 更多文字"
        result = _SF_LOG_STRIP_PATTERN.sub("", text)
        assert "普通 HTML 注释" in result
