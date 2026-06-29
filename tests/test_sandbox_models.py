import pytest
from pydantic import ValidationError

from backend.style_engine.sandbox_models import (
    SandboxParams, SandboxSentenceParams, SandboxDialogueParams,
    SandboxRhythmParams, SandboxDensityParams, SandboxSatisfactionParams,
    PreviewRequest, PreviewResponse, SaveStyleRequest, SavedStyleConfig,
)


def test_sentence_params_defaults():
    p = SandboxSentenceParams()
    assert p.avg_length_range == [15, 45]
    assert p.short_sentence_ratio == 0.3


def test_dialogue_params_validation():
    p = SandboxDialogueParams(ratio=0.4)
    assert p.ratio == 0.4
    with pytest.raises(ValidationError):
        SandboxDialogueParams(ratio=1.5)


def test_full_sandbox_params_composition():
    p = SandboxParams()
    assert isinstance(p.sentence, SandboxSentenceParams)
    assert isinstance(p.dialogue, SandboxDialogueParams)
    assert isinstance(p.rhythm, SandboxRhythmParams)
    assert isinstance(p.density, SandboxDensityParams)
    assert isinstance(p.satisfaction, SandboxSatisfactionParams)


def test_preview_request_minimal():
    r = PreviewRequest(source_text="x" * 200, params=SandboxParams())
    assert r.genre == "cool_novel"


def test_preview_request_rejects_short_text():
    with pytest.raises(ValidationError):
        PreviewRequest(source_text="short", params=SandboxParams())


def test_save_style_request_roundtrip():
    req = SaveStyleRequest(name="爽文 v1", params=SandboxParams())
    d = req.model_dump()
    assert d["name"] == "爽文 v1"
    assert d["params"]["sentence"]["avg_length_range"] == [15, 45]


def test_saved_style_config_serialization():
    cfg = SavedStyleConfig(
        name="test", path="/tmp/test.yaml",
        params=SandboxParams(), created_at="2026-06-29T10:00:00Z",
    )
    assert cfg.params.sentence.avg_length_range == [15, 45]