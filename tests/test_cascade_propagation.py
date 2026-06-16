"""Unit tests for RegistryTransactionManager cascade propagation."""

import json
import tempfile
from pathlib import Path

import pytest

from backend.story_os.registry_transaction import (
    RegistryTransactionManager,
    CascadeTrigger,
    CascadeStep,
    CascadeResult,
)


@pytest.fixture
def tmp_project():
    with tempfile.TemporaryDirectory() as tmp:
        yield Path(tmp)


def _write_registry(base: Path, project_id: str, rtype: str, items: list[dict]):
    filename = RegistryTransactionManager.REGISTRY_FILES.get(rtype, f"{rtype}s.json")
    path = base / project_id / "storyos" / filename
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(items, f, ensure_ascii=False)


@pytest.fixture
def populated_project(tmp_project):
    """Project with mysteries, reveals, conflicts, twists, expectations."""
    pid = "proj_test"
    _write_registry(tmp_project, pid, "mystery", [
        {"id": "mys_001", "status": "active", "title": "失踪之谜"},
        {"id": "mys_002", "status": "active", "title": "身份之谜"},
    ])
    _write_registry(tmp_project, pid, "reveal", [
        {"id": "rev_001", "status": "planned", "related_mystery": "mys_001"},
    ])
    _write_registry(tmp_project, pid, "conflict", [
        {"id": "cf_001", "status": "active", "intensity": "high",
         "related_mystery": "mys_001"},
    ])
    _write_registry(tmp_project, pid, "twist", [
        {"id": "tw_001", "status": "planned", "related_mystery": "mys_001"},
    ])
    _write_registry(tmp_project, pid, "expectation", [
        {"id": "exp_001", "status": "active", "related_mystery": "mys_001"},
    ])
    return tmp_project


class TestCascadeRules:
    def test_mystery_revealed_triggers_reveal_and_expectation(self):
        targets = RegistryTransactionManager.CASCADE_RULES[CascadeTrigger.MYSTERY_REVEALED]
        assert ("reveal", "revealed") in targets
        assert ("expectation", "fulfilled") in targets

    def test_twist_revealed_triggers_expectation(self):
        targets = RegistryTransactionManager.CASCADE_RULES[CascadeTrigger.TWIST_REVEALED]
        assert ("expectation", "ready_to_fulfill") in targets

    def test_reveal_revealed_triggers_conflict(self):
        targets = RegistryTransactionManager.CASCADE_RULES[CascadeTrigger.REVEAL_REVEALED]
        assert ("conflict", "escalated") in targets

    def test_promise_fulfilled_triggers_expectation(self):
        targets = RegistryTransactionManager.CASCADE_RULES[CascadeTrigger.PROMISE_FULFILLED]
        assert ("expectation", "fulfilled") in targets


class TestPropagate:
    def test_no_linked_assets_returns_empty_success(self, populated_project):
        txn = RegistryTransactionManager(projects_dir=populated_project)
        result = txn.propagate("proj_test", CascadeTrigger.MYSTERY_REVEALED,
                               "mystery", "mys_002")
        assert result.success is True
        assert len(result.steps_executed) == 0

    def test_cascade_mystery_to_reveal(self, populated_project):
        txn = RegistryTransactionManager(projects_dir=populated_project)
        result = txn.propagate("proj_test", CascadeTrigger.MYSTERY_REVEALED,
                               "mystery", "mys_001")
        reveal_steps = [s for s in result.steps_executed if s.target_asset_type == "reveal"]
        assert len(reveal_steps) >= 1
        assert reveal_steps[0].new_status == "revealed"

    def test_cascade_writes_status_changes(self, populated_project):
        txn = RegistryTransactionManager(projects_dir=populated_project)
        result = txn.propagate("proj_test", CascadeTrigger.MYSTERY_REVEALED,
                               "mystery", "mys_001")
        assert result.success is True
        # Verify reveal was updated on disk
        storyos_dir = populated_project / "proj_test" / "storyos"
        items = txn._read_registry(storyos_dir, "reveal")
        updated = next((i for i in items if i["id"] == "rev_001"), None)
        assert updated is not None
        assert updated["status"] == "revealed"


class TestBFSExpansion:
    def test_transitive_cascade_reveal_to_conflict(self, tmp_project):
        """When mystery→revealed cascades to reveal→revealed, and that triggers
        reveal→revealed → conflict→escalated sub-cascade."""
        pid = "proj_test"
        _write_registry(tmp_project, pid, "mystery", [
            {"id": "mys_001", "status": "active"},
        ])
        _write_registry(tmp_project, pid, "reveal", [
            {"id": "rev_001", "status": "planned", "related_mystery": "mys_001"},
        ])
        # Conflict linked to reveal (not mystery) so sub-cascade finds it
        _write_registry(tmp_project, pid, "conflict", [
            {"id": "cf_001", "status": "active", "related_reveal": "rev_001"},
        ])
        txn = RegistryTransactionManager(projects_dir=tmp_project)
        result = txn.propagate(pid, CascadeTrigger.MYSTERY_REVEALED,
                               "mystery", "mys_001")
        conflict_steps = [s for s in result.steps_executed
                          if s.target_asset_type == "conflict"]
        assert len(conflict_steps) >= 1
        assert conflict_steps[0].new_status == "escalated"


class TestForbiddenTransitions:
    def test_forbidden_transitions_defined(self):
        assert ("resolved", "active") in RegistryTransactionManager.FORBIDDEN_TRANSITIONS
        assert ("revealed", "foreshadowing") in RegistryTransactionManager.FORBIDDEN_TRANSITIONS
        assert ("fulfilled", "accumulating") in RegistryTransactionManager.FORBIDDEN_TRANSITIONS


class TestOrphanedMysteries:
    def test_orphaned_when_conflict_resolved(self, tmp_project):
        pid = "proj_test"
        _write_registry(tmp_project, pid, "mystery", [
            {"id": "mys_001", "status": "active", "related_conflict": "cf_001"},
            {"id": "mys_002", "status": "revealed", "related_conflict": "cf_001"},
        ])
        txn = RegistryTransactionManager(projects_dir=tmp_project)
        orphaned = txn.check_orphaned_mysteries(pid, "cf_001")
        # mys_001 is active → orphaned; mys_002 is revealed → skipped
        assert "mys_001" in orphaned
        assert "mys_002" not in orphaned


class TestAtomicCommit:
    def test_writes_updated_registries(self, tmp_project):
        pid = "proj_test"
        storyos_dir = tmp_project / pid / "storyos"
        _write_registry(tmp_project, pid, "mystery", [
            {"id": "mys_001", "status": "active"},
        ])
        txn = RegistryTransactionManager(projects_dir=tmp_project)
        steps = [
            CascadeStep(
                trigger=CascadeTrigger.MYSTERY_REVEALED,
                source_asset_type="mystery",
                source_asset_id="mys_001",
                target_asset_type="mystery",
                target_asset_id="mys_001",
                new_status="revealed",
            ),
        ]
        txn._atomic_commit(storyos_dir, steps)
        items = txn._read_registry(storyos_dir, "mystery")
        updated = next((i for i in items if i["id"] == "mys_001"), None)
        assert updated is not None
        assert updated["status"] == "revealed"

    def test_rollback_on_write_failure(self, tmp_project, monkeypatch):
        pid = "proj_test"
        storyos_dir = tmp_project / pid / "storyos"
        _write_registry(tmp_project, pid, "mystery", [
            {"id": "mys_001", "status": "active"},
        ])
        txn = RegistryTransactionManager(projects_dir=tmp_project)
        steps = [
            CascadeStep(
                trigger=CascadeTrigger.MYSTERY_REVEALED,
                source_asset_type="mystery",
                source_asset_id="mys_001",
                target_asset_type="mystery",
                target_asset_id="mys_001",
                new_status="revealed",
            ),
        ]
        # Force write failure on first try-block write (backup uses _read_registry)

        def _fail_write(*args, **kwargs):
            raise IOError("disk full")

        monkeypatch.setattr(txn, "_write_registry", _fail_write)
        with pytest.raises(IOError):
            txn._atomic_commit(storyos_dir, steps)
        # Original data should be intact after rollback
        items = txn._read_registry(storyos_dir, "mystery")
        updated = next((i for i in items if i["id"] == "mys_001"), None)
        assert updated["status"] == "active"
