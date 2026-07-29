"""Tests for the BehaviorExample Pydantic model and VoiceSignature extension."""
import pytest
from backend.models.character import VoiceSignature, Character, BehaviorExample


def test_behavior_example_accepts_three_fields():
    ex = BehaviorExample(situation="挚友被陷害", action="压制怒火,暗中收集证据", speech_sample="我会让你付出代价。")
    assert ex.situation == "挚友被陷害"
    assert ex.action == "压制怒火,暗中收集证据"
    assert ex.speech_sample == "我会让你付出代价。"


def test_voice_signature_behavior_examples_defaults_to_empty():
    vs = VoiceSignature(speech_style="简洁", thought_patterns="三思", taboos=["撒谎"])
    assert vs.behavior_examples == []


def test_voice_signature_accepts_behavior_examples():
    vs = VoiceSignature(
        speech_style="简洁",
        thought_patterns="三思",
        taboos=["撒谎"],
        behavior_examples=[
            BehaviorExample(situation="x", action="y", speech_sample="z"),
        ],
    )
    assert len(vs.behavior_examples) == 1


def test_character_backward_compat_without_behavior_examples():
    """A character dict written before the field was added must still load."""
    old_char = {
        "id": "char_old",
        "name": "老角色",
        "personality": {"beliefs": [], "desires": [], "fears": [], "values": [], "core_traits": []},
        "current_state": {"location": "", "physical_condition": "normal", "emotional": "neutral", "known_secrets": []},
        "voice_signature": {"speech_style": "s", "thought_patterns": "t", "taboos": []},  # no behavior_examples
        "unknown_to_character": [],
        "is_core_character": True,
        "character_type": "protagonist",
        "relations": {},
    }
    char = Character(**old_char)
    assert char.voice_signature.behavior_examples == []