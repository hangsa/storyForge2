"""Integration test for the migration script (runs against the real repo)."""
import subprocess
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).parent.parent
SCRIPT = REPO_ROOT / "scripts" / "migrate_genre_catalog.py"


def test_dry_run_exits_zero_without_writing(tmp_path):
    """Dry-run reports what would be written; target dir stays empty."""
    target = tmp_path / "preview-genres"
    result = subprocess.run(
        [sys.executable, str(SCRIPT), "--target", str(target), "--dry-run"],
        cwd=str(REPO_ROOT),
        capture_output=True, text=True, timeout=60,
    )
    assert result.returncode == 0, f"stderr: {result.stderr}"
    assert not target.exists() or list(target.iterdir()) == []


def test_apply_produces_loading_catalog(tmp_path):
    """Apply to a fresh target dir; GenreCatalog loads the result cleanly."""
    target = tmp_path / "migrated-genres"
    result = subprocess.run(
        [sys.executable, str(SCRIPT), "--target", str(target), "--apply", "--force"],
        cwd=str(REPO_ROOT),
        capture_output=True, text=True, timeout=60,
    )
    assert result.returncode == 0, f"stderr: {result.stderr}"
    assert (target / "index.yaml").exists()

    # Load the generated catalog
    sys.path.insert(0, str(REPO_ROOT))
    from backend.genres.catalog import GenreCatalog
    cat = GenreCatalog(genres_dir=target)
    cat._load()  # must not raise
    # At least the 7 well-known ids should be present
    for gid in ["cool_novel", "xianxia", "xuanyi", "yanqing"]:
        assert gid in cat._entries, f"missing {gid} in migrated catalog"


def test_apply_is_idempotent(tmp_path):
    """Running --apply twice with same target produces no errors."""
    target = tmp_path / "migrated-genres"
    for _ in range(2):
        result = subprocess.run(
            [sys.executable, str(SCRIPT), "--target", str(target), "--apply", "--force"],
            cwd=str(REPO_ROOT),
            capture_output=True, text=True, timeout=60,
        )
        assert result.returncode == 0, f"stderr: {result.stderr}"