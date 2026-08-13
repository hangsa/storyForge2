"""World.power_systems migration.

`World.power_system` used to be a single object. It is now `power_systems`,
a list. Old world.json files on disk still carry the singular key, so the
model folds it forward on validate and `iter_power_systems` tolerates both
shapes for the code paths that read world.json as a bare dict.
"""

from backend.models.world import World, iter_power_systems, _raw_power_systems_list


LEGACY_PS = {
    "name": "灵力",
    "description": "天地灵气",
    "stages": ["炼气", "筑基"],
    "core_rules": ["灵气有限"],
    "ceilings": ["最高元婴"],
    "cost_system": "折寿",
}


def test_legacy_single_power_system_folds_into_a_one_element_list():
    world = World.model_validate({"era": "古代", "power_system": LEGACY_PS})
    assert len(world.power_systems) == 1
    ps = world.power_systems[0]
    assert ps.name == "灵力"
    assert ps.description == "天地灵气"
    assert ps.stages == ["炼气", "筑基"]
    assert ps.core_rules == ["灵气有限"]
    assert ps.ceilings == ["最高元婴"]
    assert ps.cost_system == "折寿"


def test_empty_legacy_power_system_folds_to_an_empty_list():
    # A blank system carries no information; keeping it would render an
    # empty card in the wizard on every legacy project.
    world = World.model_validate({"power_system": {}})
    assert world.power_systems == []


def test_legacy_null_power_system_folds_to_an_empty_list():
    world = World.model_validate({"power_system": None})
    assert world.power_systems == []


def test_new_array_shape_is_preserved():
    world = World.model_validate(
        {"power_systems": [LEGACY_PS, {"name": "剑道"}]}
    )
    assert [ps.name for ps in world.power_systems] == ["灵力", "剑道"]


def test_power_systems_wins_when_both_keys_are_present():
    world = World.model_validate(
        {"power_systems": [{"name": "新"}], "power_system": LEGACY_PS}
    )
    assert [ps.name for ps in world.power_systems] == ["新"]


def test_missing_both_keys_yields_an_empty_list():
    assert World.model_validate({"era": "古代"}).power_systems == []


def test_model_dump_drops_the_legacy_key():
    dumped = World.model_validate({"power_system": LEGACY_PS}).model_dump()
    assert "power_system" not in dumped
    assert dumped["power_systems"][0]["name"] == "灵力"


def test_stage_coercion_still_applies_to_each_system():
    # proj_ec67d3e2: the LLM returns `stages` as a dict of lists. The
    # per-system coercion must survive the fold.
    world = World.model_validate(
        {"power_system": {"name": "灵力", "stages": {"人道": ["养气"], "地道": ["贯通"]}}}
    )
    assert world.power_systems[0].stages == ["养气", "贯通"]


def test_iter_power_systems_reads_the_legacy_shape():
    assert iter_power_systems({"power_system": LEGACY_PS}) == [LEGACY_PS]


def test_iter_power_systems_reads_the_array_shape():
    assert iter_power_systems({"power_systems": [LEGACY_PS]}) == [LEGACY_PS]


def test_iter_power_systems_on_missing_or_blank_input():
    assert iter_power_systems({}) == []
    assert iter_power_systems({"power_system": {}}) == []
    assert iter_power_systems({"power_systems": []}) == []
    assert iter_power_systems(None) == []


def test_iter_power_systems_tolerates_a_non_dict_legacy_value():
    # Some very old projects stored power_system as a bare string.
    assert iter_power_systems({"power_system": "灵力"}) == [{"name": "灵力"}]


def test_raw_power_systems_list_keeps_empty_entries():
    # Used by the per-item regenerate endpoint so the bounds check matches
    # the slot count the wizard renders. iter_power_systems filters these
    # out, which is what we want for prompt construction (writer/reviewer)
    # but wrong for addressing an arbitrary user-clicked card.
    world = {
        "power_systems": [LEGACY_PS, {}, {"name": ""}, {"name": "武道"}],
    }
    assert len(_raw_power_systems_list(world)) == 4
    assert iter_power_systems(world) == [LEGACY_PS, {"name": "武道"}]


def test_raw_power_systems_list_drops_non_dict_entries():
    # Malformed files may have nulls / strings mixed in. Match iter's
    # behavior of dropping non-dict slots so the index the user clicked
    # can't be a `null` placeholder.
    world = {"power_systems": [LEGACY_PS, None, "bad", {"name": "武道"}]}
    assert _raw_power_systems_list(world) == [LEGACY_PS, {"name": "武道"}]
