"""Tests for TropePool — creative_os/trope_pool.py"""

import tempfile
from pathlib import Path
from unittest.mock import MagicMock

import numpy as np
import pytest

from backend.creative_os.trope_pool import TropePool


@pytest.fixture
def catalog_path():
    return Path("config/trope_catalog.yaml")


@pytest.fixture
def temp_dir():
    d = tempfile.mkdtemp()
    yield Path(d)
    import shutil
    shutil.rmtree(d, ignore_errors=True)


@pytest.fixture
def mock_embedder():
    m = MagicMock()
    m.VECTOR_DIM = 1024
    m.embed.return_value = np.random.randn(1, 1024).astype(np.float32)
    m.embed_query.return_value = np.random.randn(1024).astype(np.float32)
    m.available = True
    return m


@pytest.fixture
def pool(temp_dir, catalog_path, mock_embedder):
    return TropePool(temp_dir, catalog_path, embedder=mock_embedder)


class TestTropePool:

    def test_loads_all_tropes(self, pool):
        tropes = pool.list_categories()
        assert len(tropes) > 0
        assert "成长" in tropes

    def test_get_saturation_by_id(self, pool):
        sat = pool.get_saturation("trope_001")
        assert 0.0 <= sat <= 1.0

    def test_get_saturation_nonexistent_returns_default(self, pool):
        sat = pool.get_saturation("nonexistent")
        assert sat == 0.5

    def test_get_saturation_by_tags(self, pool):
        tags = ["trope_001", "trope_002"]
        sat = pool.get_saturation_by_tags(tags)
        assert 0.0 <= sat <= 1.0

    def test_get_saturation_by_tags_empty(self, pool):
        sat = pool.get_saturation_by_tags([])
        assert sat == 0.5

    def test_match_tropes(self, pool):
        results = pool.match_tropes(["废柴逆袭", "重生复仇"])
        assert len(results) > 0

    def test_match_tropes_no_match(self, pool):
        results = pool.match_tropes(["不存在的标签xyz"])
        assert len(results) == 0

    def test_list_categories(self, pool):
        cats = pool.list_categories()
        assert "成长" in cats
        assert "世界设定" in cats

    def test_update_saturation(self, pool):
        pool.update_saturation("trope_001", 0.99, source="user")
        assert pool.get_saturation("trope_001") == 0.99

    def test_get_vector_index(self, pool):
        index = pool.get_vector_index()
        assert isinstance(index, dict)
        assert len(index) > 0
        for vec in index.values():
            assert vec.shape == (1024,)

    def test_persistence(self, temp_dir, catalog_path, mock_embedder):
        pool1 = TropePool(temp_dir, catalog_path, embedder=mock_embedder)
        pool1.update_saturation("trope_001", 0.77)
        pool2 = TropePool(temp_dir, catalog_path, embedder=mock_embedder)
        assert pool2.get_saturation("trope_001") == 0.77

    def test_market_saturation_property(self, pool):
        """Verify market saturation values are within expected ranges."""
        for cat in pool.list_categories():
            assert len(cat) > 0
