"""Tests for WhatIfNode branch_status field and dimension removal."""
from backend.models.creative_os import (
    WhatIfNode,
    BRANCH_STATUS_ACTIVE,
    BRANCH_STATUS_DIMMED,
    BRANCH_STATUSES,
)


def test_branch_status_constants_defined():
    assert BRANCH_STATUS_ACTIVE == "active"
    assert BRANCH_STATUS_DIMMED == "dimmed"
    assert BRANCH_STATUSES == {BRANCH_STATUS_ACTIVE, BRANCH_STATUS_DIMMED}


def test_whatif_node_defaults_to_active():
    node = WhatIfNode(
        id="wi_001_00", depth=0, parent_id=None, content="premise"
    )
    assert node.branch_status == "active"


def test_whatif_node_dimension_field_removed():
    node = WhatIfNode(
        id="wi_001_00", depth=0, parent_id=None, content="premise"
    )
    assert not hasattr(node, "dimension")
