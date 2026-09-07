from backend.services.dimension_labels import Dimension, label_zh, label_en, DIMENSION_LABELS_ZH


def test_labels_zh_returns_chinese_for_known_dimension():
    assert label_zh(Dimension.ONTOLOGY.value) == "世界构成"


def test_labels_zh_falls_back_to_value_for_unknown():
    assert label_zh("unknown_dim") == "unknown_dim"


def test_labels_en_returns_english_for_known_dimension():
    assert label_en(Dimension.ENERGETICS.value) == "Energetics"


def test_dimension_enum_values_match_labels_keys():
    assert set(DIMENSION_LABELS_ZH.keys()) == {d.value for d in Dimension}
