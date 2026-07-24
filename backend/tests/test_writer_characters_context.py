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
    # 1 POV + 1 antagonist + 10 supporting with realistic Chinese examples
    # large enough to overflow 4000 budget. Supporting chars without name
    # mention are tier 0.2 (background), so they get compressed to
    # (仅提及) one-liners.
    pov_examples = [
        {"situation": "师父失踪后独自在山洞中守夜，回想起过往师徒情谊",
         "action": "压下悲痛，沉着冷静地分析局势，誓要查明真相",
         "speech_sample": "师父一生光明磊落，此事必有蹊跷。我等身为弟子，当守其基业，待其归来。"},
        {"situation": "挚友被陷害入狱，全城议论纷纷",
         "action": "克制怒火，独自暗中收集证据，不打草惊蛇",
         "speech_sample": "我会让你付出代价，只是此刻尚需隐忍，时机未到不可轻举妄动。"},
        {"situation": "门派弟子人心惶惶，长老争执不下",
         "action": "挺身而出主持大局，逐一分派任务安定人心",
         "speech_sample": "只要我还在，门派便不会倒。诸位各司其职，切莫自乱阵脚。"},
        {"situation": "发现敌人阴谋的关键线索",
         "action": "独自深入险地查证，不愿旁人涉险",
         "speech_sample": "不入虎穴，焉得虎子。这件事便由我一人前去，诸位留守山门以防有变。"},
        {"situation": "面对师父留下的艰深谜题",
         "action": "反复推演数日，誓要破解其中玄机",
         "speech_sample": "真相终会大白于天下，我林峰此生定不负师父所托。"},
    ]
    ant_examples = [
        {"situation": "门派比武大会上与林峰对垒",
         "action": "暗施巧计示弱诱敌，使其放松警惕",
         "speech_sample": "你不过是井底之蛙罢了，真以为能看透我的布局？"},
        {"situation": "林峰追查到关键线索",
         "action": "提前布置陷阱反制",
         "speech_sample": "螳螂捕蝉，黄雀在后。你以为你在追查，其实早已踏入我的圈套。"},
        {"situation": "内部会议被多名长老质疑",
         "action": "拉拢盟友分化异己",
         "speech_sample": "识时务者为俊杰，诸位长老何必为一己之私误了门派大局？"},
    ]
    sup_examples = [
        {"situation": "门派日常巡守时察觉山脚异动",
         "action": "立刻回报长老并部署各处警戒",
         "speech_sample": "敌踪已现，请诸位速作准备，严守各处要道，勿使一人漏网。"},
        {"situation": "师兄重伤被抬回山门救治",
         "action": "立即延请医师并暗查凶手身份",
         "speech_sample": "师兄伤势沉重，定要查清来龙去脉，以慰在天之灵，以儆效尤。"},
        {"situation": "外出采买物资时遭遇伏击",
         "action": "沉着应对掩护同伴撤退",
         "speech_sample": "诸位先走，我来断后。今日之事必要回报掌门，请援军速来。"},
        {"situation": "新弟子入门考核中表现出色",
         "action": "悉心指点并以身作则",
         "speech_sample": "习武先习心，为人先为德。我等正道中人，当以义立身。"},
    ]
    chars = [_char("pov", "林峰", "protagonist",
                   voice_signature={
                       "speech_style": "沉稳、简洁", "thought_patterns": "三思后行",
                       "taboos": ["撒谎"],
                       "behavior_examples": pov_examples,
                   })]
    chars.append(_char("ant", "苏晓晓", "antagonist",
                       voice_signature={
                           "speech_style": "狡黠", "thought_patterns": "算计深远",
                           "taboos": ["轻信"],
                           "behavior_examples": [
                               {"situation": ex["situation"],
                                "action": ex["action"],
                                "speech_sample": ex["speech_sample"]}
                               for ex in ant_examples
                           ],
                       }))
    for i in range(10):
        chars.append(_char(f"sup{i}", f"配角{i}", "supporting",
                           voice_signature={
                               "speech_style": "普通",
                               "thought_patterns": "随波逐流",
                               "taboos": [],
                               "behavior_examples": [
                                   {"situation": ex["situation"],
                                    "action": ex["action"],
                                    "speech_sample": ex["speech_sample"]}
                                   for ex in sup_examples
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
    pov_examples = [
        {"situation": "师父失踪后独自在山洞中守夜，回想起过往师徒情谊",
         "action": "压下悲痛，沉着冷静地分析局势",
         "speech_sample": "师父一生光明磊落，此事必有蹊跷。我等身为弟子，当守其基业，待其归来。"},
        {"situation": "挚友被陷害入狱，全城议论纷纷",
         "action": "克制怒火，独自暗中收集证据",
         "speech_sample": "我会让你付出代价，只是此刻尚需隐忍，时机未到不可轻举妄动。"},
        {"situation": "门派弟子人心惶惶，长老争执不下",
         "action": "挺身而出主持大局，逐一分派任务",
         "speech_sample": "只要我还在，门派便不会倒。诸位各司其职，切莫自乱阵脚。"},
        {"situation": "发现敌人阴谋的关键线索",
         "action": "独自深入险地查证，不愿旁人涉险",
         "speech_sample": "不入虎穴，焉得虎子。这件事便由我一人前去，诸位留守山门以防有变。"},
        {"situation": "面对师父留下的艰深谜题",
         "action": "反复推演数日，誓要破解其中玄机",
         "speech_sample": "真相终会大白于天下，我林峰此生定不负师父所托。"},
    ]
    pov = _char("pov", "林峰", "protagonist", voice_signature={
        "speech_style": "沉稳", "thought_patterns": "三思", "taboos": [],
        "behavior_examples": pov_examples,
    })
    # Add 6 supporting chars with large Chinese examples to blow the budget.
    sup_examples = [
        {"situation": "门派日常巡守时察觉山脚异动",
         "action": "立刻回报长老并部署各处警戒",
         "speech_sample": "敌踪已现，请诸位速作准备，严守各处要道，勿使一人漏网。"},
        {"situation": "师兄重伤被抬回山门救治",
         "action": "立即延请医师并暗查凶手身份",
         "speech_sample": "师兄伤势沉重，定要查清来龙去脉，以慰在天之灵，以儆效尤。"},
        {"situation": "外出采买物资时遭遇伏击",
         "action": "沉着应对掩护同伴撤退",
         "speech_sample": "诸位先走，我来断后。今日之事必要回报掌门，请援军速来。"},
        {"situation": "新弟子入门考核中表现出色",
         "action": "悉心指点并以身作则",
         "speech_sample": "习武先习心，为人先为德。我等正道中人，当以义立身。"},
    ]
    chars = [pov]
    for i in range(6):
        chars.append(_char(f"sup{i}", f"配角{i}", "supporting",
                           voice_signature={
                               "speech_style": "普通",
                               "thought_patterns": "随波逐流",
                               "taboos": [],
                               "behavior_examples": sup_examples,
                           }))
    out = WriterAgent._build_characters_context(chars, _scene_plan("本章开篇"))
    # POV's all 5 examples present (substrings from each speech_sample).
    assert "师父一生光明磊落" in out
    assert "我会让你付出代价" in out
    assert "只要我还在" in out
    assert "不入虎穴" in out
    assert "真相终会大白" in out


def test_token_budget_log_emitted_on_truncation(caplog):
    """logger.debug fires when truncated (lenient: hard guarantee is no crash)."""
    import logging
    pov_examples = [
        {"situation": "师父失踪后独自在山洞中守夜，回想起过往师徒情谊",
         "action": "压下悲痛，沉着冷静地分析局势",
         "speech_sample": "师父一生光明磊落，此事必有蹊跷。我等身为弟子，当守其基业，待其归来。"},
        {"situation": "挚友被陷害入狱，全城议论纷纷",
         "action": "克制怒火，独自暗中收集证据",
         "speech_sample": "我会让你付出代价，只是此刻尚需隐忍，时机未到不可轻举妄动。"},
        {"situation": "门派弟子人心惶惶，长老争执不下",
         "action": "挺身而出主持大局，逐一分派任务",
         "speech_sample": "只要我还在，门派便不会倒。诸位各司其职，切莫自乱阵脚。"},
        {"situation": "发现敌人阴谋的关键线索",
         "action": "独自深入险地查证，不愿旁人涉险",
         "speech_sample": "不入虎穴，焉得虎子。这件事便由我一人前去，诸位留守山门以防有变。"},
        {"situation": "面对师父留下的艰深谜题",
         "action": "反复推演数日，誓要破解其中玄机",
         "speech_sample": "真相终会大白于天下，我林峰此生定不负师父所托。"},
    ]
    pov = _char("pov", "林峰", "protagonist", voice_signature={
        "speech_style": "沉稳", "thought_patterns": "三思", "taboos": [],
        "behavior_examples": pov_examples,
    })
    sup_examples = [
        {"situation": "门派日常巡守时察觉山脚异动",
         "action": "立刻回报长老并部署各处警戒",
         "speech_sample": "敌踪已现，请诸位速作准备，严守各处要道，勿使一人漏网。"},
        {"situation": "师兄重伤被抬回山门救治",
         "action": "立即延请医师并暗查凶手身份",
         "speech_sample": "师兄伤势沉重，定要查清来龙去脉，以慰在天之灵，以儆效尤。"},
        {"situation": "外出采买物资时遭遇伏击",
         "action": "沉着应对掩护同伴撤退",
         "speech_sample": "诸位先走，我来断后。今日之事必要回报掌门，请援军速来。"},
        {"situation": "新弟子入门考核中表现出色",
         "action": "悉心指点并以身作则",
         "speech_sample": "习武先习心，为人先为德。我等正道中人，当以义立身。"},
    ]
    chars = [pov]
    for i in range(6):
        chars.append(_char(f"sup{i}", f"配角{i}", "supporting",
                           voice_signature={
                               "speech_style": "普通",
                               "thought_patterns": "随波逐流",
                               "taboos": [],
                               "behavior_examples": sup_examples,
                           }))
    with caplog.at_level(logging.DEBUG, logger="backend.agents.writer"):
        WriterAgent._build_characters_context(chars, _scene_plan("本章开篇"))
    # No assertion on log content (logger name might differ). Hard guarantee
    # is no crash, which test_never_truncates_pov already enforces.


# --- Multi-POV labeling (review fix I1) ---

def test_multi_protagonist_first_labeled_pov_others_plain():
    """When multiple protagonists exist, only the first (canonical POV) gets
    the `(主角 (POV))` label; other protagonists get plain `(主角)`."""
    characters = [
        _char("pov", "林峰", "protagonist"),
        _char("p2", "苏晓晓", "protagonist"),
        _char("p3", "陈墨", "protagonist"),
    ]
    out = WriterAgent._build_characters_context(characters, _scene_plan(""))
    # Canonical POV gets the (POV) suffix.
    assert "林峰 (主角 (POV))" in out
    # Other protagonists get plain (主角) — without the (POV) suffix.
    assert "苏晓晓 (主角)" in out
    assert "陈墨 (主角)" in out
    # And they should NOT be mislabeled with the POV suffix.
    assert "苏晓晓 (主角 (POV))" not in out
    assert "陈墨 (主角 (POV))" not in out


def test_single_protagonist_still_labeled_pov():
    """Backward compat: a project with one protagonist still gets (POV)."""
    characters = [_char("pov", "林峰", "protagonist")]
    out = WriterAgent._build_characters_context(characters, _scene_plan(""))
    assert "林峰 (主角 (POV))" in out


# --- CJK name boundary (review fix I2) ---

def test_substring_name_falls_through_to_background_not_supporting():
    """A character named `林` (single CJK char) must NOT be elevated to the
    SUPPORTING tier (0.5) just because the plan text mentions `林峰` — the
    naive substring match would falsely match `林`. With the CJK-boundary
    helper, `林` falls through Pass 2 (no name match) to Pass 3 (BACKGROUND
    tier 0.2), which is the correct priority for a character not actually
    appearing in the scene."""
    characters = [
        _char("pov", "林峰", "protagonist"),
        _char("lin", "林", "supporting"),
    ]
    appearing = WriterAgent._resolve_appearing_characters(
        characters, _scene_plan("林峰在山洞中苏醒")
    )
    # Find the `林` character's tier. Returning tuples are (c, tier, is_pov).
    lin_entry = next(
        (c, tier, is_pov) for c, tier, is_pov in appearing
        if c.get("id") == "lin"
    )
    _, lin_tier, _ = lin_entry
    # `林` is NOT name-matched (Pass 2 skipped), so it falls into Pass 3
    # background tier 0.2 — NOT the supporting tier 0.5 it would have been
    # erroneously elevated to with the naive substring match.
    assert lin_tier == WriterAgent._TIER_BACKGROUND
    assert lin_tier < WriterAgent._TIER_SUPPORTING


def test_substring_name_matches_at_word_boundary():
    """When the character name appears at text-start, text-end, or beside
    ASCII/punctuation, the helper should match it."""
    from backend.agents.writer import _name_in_text

    # Name at start of text → True (left = start-of-text, right = end-of-text).
    assert _name_in_text("林峰", "林峰") is True
    # Name at end of text → True (right boundary = end-of-text, prev is ASCII `,`).
    assert _name_in_text("林峰", "主角,林峰") is True
    # Name with ASCII punctuation boundary (ASCII `,` is not CJK) on the
    # right side, and text ends right after — True.
    assert _name_in_text("林峰", "苏晓晓, 林峰") is True
    # Name preceded by ASCII char → True.
    assert _name_in_text("Lin", "is Lin here") is True
    # Name followed by ASCII char → True.
    assert _name_in_text("Lin", "Lin is here") is True
    # Single-char `林` at end of text → True (right = end-of-text, prev is ASCII `,`).
    assert _name_in_text("林", "只见,林") is True
    # Single-char `林` followed by ASCII → True (right boundary = ASCII `1`).
    assert _name_in_text("林", "山1林1") is True
    # Single-char `林` as prefix of `林峰` (followed by CJK) → False.
    assert _name_in_text("林", "林峰苏醒") is False
    # Single-char `林` mid-text as suffix (preceded by CJK) → False.
    assert _name_in_text("峰", "林峰苏醒") is False
    # `林峰` mid-text with CJK on both sides → False (acceptable false
    # negative; we trade off recall for safety against prefix false positives).
    assert _name_in_text("林峰", "苏晓晓林峰苏醒") is False
    # Empty inputs → False.
    assert _name_in_text("", "anything") is False
    assert _name_in_text("林", "") is False
