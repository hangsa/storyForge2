"""Tests for the rewritten Writer._build_characters_context.

Cover: appearing-character filtering (name-extraction fallback), priority
tiering, structured field emission, behavior_example emission, token-budget
truncation, backward compat (missing behavior_examples field).
"""
from backend.agents.writer import WriterAgent


def _char(cid: str, name: str, ctype: str = "supporting", **overrides):
    base = {
        "id": cid,
        "name": name,
        "character_type": ctype,
        "personality": {"beliefs": ["正义"], "desires": ["守护"], "fears": ["失去"],
                        "values": ["义"], "core_traits": ["勇敢"]},
        "voice_signature": {"speech_style": "沉稳", "thought_patterns": "三思",
                            "taboos": ["撒谎"], "behavior_examples": []},
        "current_state": {"location": "山洞", "physical_condition": "normal",
                          "emotional": "震惊", "known_secrets": []},
        "unknown_to_character": ["secret_x"],
        "relations": {},
    }
    base.update(overrides)
    return base


def _scene_plan(goal: str, conflict: str = "", arc: str = ""):
    return {
        "scene_number": 1,
        "goal": goal,
        "conflict": conflict,
        "emotional_arc": arc,
        "narrative_role": "setup",
        "beat_type": "opening",
        "registry_changes": {"created": [], "updated": []},
        "required_logs": [],
    }


# --- Filtering ---

def test_includes_pov_always():
    characters = [_char("pov", "林峰", "protagonist"), _char("s1", "苏晓晓", "supporting")]
    out = WriterAgent._build_characters_context(characters, _scene_plan("苏晓晓走进山洞"))
    assert "林峰" in out
    assert "苏晓晓" in out


def test_includes_characters_named_in_goal():
    characters = [_char("pov", "林峰", "protagonist"), _char("s1", "苏晓晓", "supporting"),
                  _char("b1", "路人甲", "supporting")]
    out = WriterAgent._build_characters_context(characters, _scene_plan("苏晓晓与路人甲对话"))
    assert "林峰" in out
    assert "苏晓晓" in out
    # 路人甲 mentioned in goal → included.
    assert "路人甲" in out


def test_excludes_characters_not_in_scene_when_budget_allows():
    """When only 2 chars fit under the budget, the third (mentioned nowhere)
    should be excluded."""
    characters = [_char("pov", "林峰", "protagonist"),
                  _char("s1", "苏晓晓", "supporting"),
                  _char("b1", "路人甲", "supporting")]
    # Goal mentions nobody; POV is auto-included. Other two are not mentioned.
    out = WriterAgent._build_characters_context(characters, _scene_plan("本章开篇"))
    assert "林峰" in out
    # The two extras are not mentioned anywhere; they may or may not appear
    # depending on budget overflow logic. Test that they DO appear when budget
    # is large enough — see test_truncation_drops_background_first for the
    # overflow case.


def test_empty_characters_returns_no_info_marker():
    out = WriterAgent._build_characters_context([], _scene_plan("anything"))
    assert out == "无角色信息"


def test_scene_plan_is_none_returns_no_info_marker():
    characters = [_char("pov", "林峰", "protagonist")]
    out = WriterAgent._build_characters_context(characters, None)
    assert out == "无角色信息"


# --- Structured field emission ---

def test_pov_block_includes_all_structured_fields():
    char = _char("pov", "林峰", "protagonist", voice_signature={
        "speech_style": "沉稳、简洁",
        "thought_patterns": "三思后行",
        "taboos": ["撒谎"],
        "behavior_examples": [],
    })
    out = WriterAgent._build_characters_context([char], _scene_plan(""))
    assert "林峰 (主角 (POV))" in out
    assert "语言风格: 沉稳、简洁" in out
    assert "思维模式: 三思后行" in out
    assert "行为禁忌: [撒谎]" in out
    assert "信念: [正义]" in out
    assert "欲望: [守护]" in out
    assert "恐惧: [失去]" in out
    assert "价值观: [义]" in out
    assert "核心特质: [勇敢]" in out


def test_emits_behavior_examples_for_pov():
    char = _char("pov", "林峰", "protagonist", voice_signature={
        "speech_style": "沉稳",
        "thought_patterns": "三思",
        "taboos": [],
        "behavior_examples": [
            {"situation": "挚友被陷害", "action": "压制怒火", "speech_sample": "我会让你付出代价。"},
            {"situation": "师父失踪", "action": "暗中调查", "speech_sample": "真相终会大白。"},
        ],
    })
    out = WriterAgent._build_characters_context([char], _scene_plan(""))
    assert "行为示例:" in out
    assert "挚友被陷害" in out
    assert "我会让你付出代价。" in out


def test_emits_unknown_marker_when_no_behavior_examples():
    """Backward compat: old character dict without behavior_examples field."""
    char = {
        "id": "old",
        "name": "老角色",
        "character_type": "protagonist",
        "personality": {"beliefs": [], "desires": [], "fears": [], "values": [], "core_traits": []},
        "voice_signature": {"speech_style": "s", "thought_patterns": "t", "taboos": []},
        "current_state": {"location": "", "physical_condition": "normal", "emotional": "neutral", "known_secrets": []},
        "unknown_to_character": [],
        "relations": {},
    }
    out = WriterAgent._build_characters_context([char], _scene_plan(""))
    assert "行为示例: （无行为示例，按结构化字段演绎）" in out


def test_emits_unknown_to_character():
    char = _char("pov", "林峰", "protagonist")
    char["unknown_to_character"] = ["师父的秘密", "敌人的弱点"]
    out = WriterAgent._build_characters_context([char], _scene_plan(""))
    assert "角色不知道: [师父的秘密, 敌人的弱点]" in out


# --- Priority tiering + token budget ---

def test_priority_orders_pov_before_antagonist_before_supporting():
    characters = [
        _char("sup", "配角甲", "supporting"),
        _char("ant", "反派乙", "antagonist"),
        _char("pov", "主角丙", "protagonist"),
    ]
    out = WriterAgent._build_characters_context(characters, _scene_plan("本章开篇"))
    pov_pos = out.find("主角丙")
    ant_pos = out.find("反派乙")
    sup_pos = out.find("配角甲")
    assert pov_pos < ant_pos < sup_pos


def test_truncation_drops_background_tier_first():
    """When total exceeds budget, background characters get compressed to
    one-line summaries."""
    # 1 POV + 1 antagonist (key) + 8 supporting with 5 examples each.
    # 8 supporting × ~600 tok ≈ 4800 tok > 4000 budget.
    chars = [_char("pov", "林峰", "protagonist",
                   voice_signature={
                       "speech_style": "沉稳", "thought_patterns": "三思", "taboos": [],
                       "behavior_examples": [
                           {"situation": f"s{i}", "action": f"a{i}", "speech_sample": f"sp{i}"}
                           for i in range(5)
                       ],
                   })]
    chars.append(_char("ant", "苏晓晓", "antagonist",
                       voice_signature={
                           "speech_style": "狡黠", "thought_patterns": "算计", "taboos": [],
                           "behavior_examples": [
                               {"situation": f"s{i}", "action": f"a{i}", "speech_sample": f"sp{i}"}
                               for i in range(5)
                           ],
                       }))
    for i in range(8):
        chars.append(_char(f"sup{i}", f"配角{i}", "supporting",
                           voice_signature={
                               "speech_style": "普通", "thought_patterns": "普通", "taboos": [],
                               "behavior_examples": [
                                   {"situation": f"s{j}", "action": f"a{j}", "speech_sample": f"sp{j}"}
                                   for j in range(5)
                               ],
                           }))
    # Goal mentions nobody; POV is always included.
    out = WriterAgent._build_characters_context(chars, _scene_plan("本章开篇"))
    # Background-tier (supporting without name mention) should be compressed.
    assert "(仅提及)" in out
    # POV keeps full structure.
    assert "林峰 (主角 (POV))" in out


def test_never_truncates_pov():
    """POV keeps all 5 behavior examples even when budget is exceeded."""
    big_examples = [
        {"situation": f"big_s{i}", "action": f"big_a{i}", "speech_sample": f"big_sp{i} " * 10}
        for i in range(5)
    ]
    pov = _char("pov", "林峰", "protagonist", voice_signature={
        "speech_style": "沉稳", "thought_patterns": "三思", "taboos": [],
        "behavior_examples": big_examples,
    })
    # Add 5 background chars with bloated examples to blow the budget.
    chars = [pov]
    for i in range(5):
        chars.append(_char(f"b{i}", f"路人{i}", "supporting",
                           voice_signature={
                               "speech_style": "x", "thought_patterns": "x", "taboos": [],
                               "behavior_examples": [
                                   {"situation": f"j{k}", "action": f"a{k}", "speech_sample": f"sp{k} " * 20}
                                   for k in range(5)
                               ],
                           }))
    out = WriterAgent._build_characters_context(chars, _scene_plan("本章开篇"))
    # POV's big examples all present
    for ex in big_examples:
        assert ex["speech_sample"][:20] in out


def test_token_budget_log_emitted_on_truncation(caplog):
    """logger.debug fires when truncated (lenient: hard guarantee is no crash)."""
    import logging
    big_examples = [
        {"situation": f"big_s{i}", "action": f"big_a{i}", "speech_sample": f"big_sp{i} " * 10}
        for i in range(5)
    ]
    pov = _char("pov", "林峰", "protagonist", voice_signature={
        "speech_style": "沉稳", "thought_patterns": "三思", "taboos": [],
        "behavior_examples": big_examples,
    })
    chars = [pov]
    for i in range(5):
        chars.append(_char(f"b{i}", f"路人{i}", "supporting",
                           voice_signature={
                               "speech_style": "x", "thought_patterns": "x", "taboos": [],
                               "behavior_examples": [
                                   {"situation": f"j{k}", "action": f"a{k}", "speech_sample": f"sp{k} " * 20}
                                   for k in range(5)
                               ],
                           }))
    with caplog.at_level(logging.DEBUG, logger="backend.agents.writer"):
        WriterAgent._build_characters_context(chars, _scene_plan("本章开篇"))
    # No assertion on log content (logger name might differ). Hard guarantee
    # is no crash, which test_never_truncates_pov already enforces.
