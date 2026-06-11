"""
Scene Engine schema unit tests.
"""

import pytest

from backend.scene_engine.schema import (
    NarrativeRole,
    BeatType,
    SceneSchema,
    BEAT_PATTERNS,
)


class TestEnums:
    def test_narrative_role_values(self):
        assert NarrativeRole.SETUP.value == "setup"
        assert NarrativeRole.MINI_PAYOFF.value == "mini_payoff"
        assert NarrativeRole.CLIFFHANGER.value == "cliffhanger"
        assert NarrativeRole.MAJOR_REVEAL.value == "major_reveal"

    def test_beat_type_values(self):
        assert BeatType.SETUP.value == "setup"
        assert BeatType.TENSION_BUILD.value == "tension_build"
        assert BeatType.CLIFFHANGER.value == "cliffhanger"
        assert BeatType.TRANSITION.value == "transition"


class TestSceneSchema:
    def test_default_values(self):
        scene = SceneSchema(scene_number=1)
        assert scene.scene_number == 1
        assert scene.goal == ""
        assert scene.narrative_role == NarrativeRole.SETUP
        assert scene.beat_type == BeatType.SETUP
        assert scene.required_logs == []

    def test_full_initialization(self):
        scene = SceneSchema(
            scene_number=3,
            goal="揭露真相",
            conflict="主角vs反派",
            emotional_arc="紧张→释放",
            narrative_role=NarrativeRole.MAJOR_REVEAL,
            beat_type=BeatType.MAJOR_PAYOFF,
            required_logs=["character_emotion", "twist_reveal"],
            registry_changes={"created": []},
        )
        assert scene.scene_number == 3
        assert scene.goal == "揭露真相"
        assert scene.narrative_role == NarrativeRole.MAJOR_REVEAL


class TestBeatPatterns:
    def test_all_beat_types_have_patterns(self):
        for beat in BeatType:
            assert beat in BEAT_PATTERNS
            assert "description" in BEAT_PATTERNS[beat]
            assert "expected_beats" in BEAT_PATTERNS[beat]

    def test_setup_pattern(self):
        pattern = BEAT_PATTERNS[BeatType.SETUP]
        assert "建立场景" in pattern["description"]
        assert "scene_description" in pattern["expected_beats"]

    def test_cliffhanger_pattern(self):
        pattern = BEAT_PATTERNS[BeatType.CLIFFHANGER]
        assert "悬念" in pattern["description"]
        assert "hook" in pattern["expected_beats"]
