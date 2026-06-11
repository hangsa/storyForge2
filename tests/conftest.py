"""Shared test fixtures for all test modules."""

import pytest
import tempfile
from pathlib import Path


@pytest.fixture
def temp_dir():
    """Temporary directory that cleans up after the test."""
    with tempfile.TemporaryDirectory() as tmp:
        yield Path(tmp)
