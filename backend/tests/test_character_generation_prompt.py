"""Tests that the character_generation prompt requires behavior_examples output."""
from pathlib import Path


def _load_prompt() -> str:
    p = Path(__file__).resolve().parents[2] / "backend" / "prompts" / "character_generation.yaml"
    return p.read_text(encoding="utf-8")


def test_prompt_user_instructions_mention_behavior_examples():
    text = _load_prompt()
    assert "behavior_examples" in text, "character_generation.yaml must mention behavior_examples in user instructions"


def test_prompt_requires_3_to_5_examples():
    text = _load_prompt()
    assert "3-5" in text or "3到5" in text, "prompt must require 3-5 behavior examples"


def test_prompt_output_schema_includes_behavior_examples_with_required_fields():
    text = _load_prompt()
    # Schema is in the JSON example in user_prompt_template. Check all 3 fields appear in the voice_signature block.
    # Take everything from the voice_signature {{ ... }} block up to the next closing "}}".
    after_voice = text.split('"voice_signature":', 1)[1]
    voice_block = after_voice.split("}}", 1)[0]
    assert '"behavior_examples"' in voice_block, "voice_signature block must include behavior_examples key"
    assert '"situation"' in voice_block, "behavior_examples entries must include situation"
    assert '"action"' in voice_block, "behavior_examples entries must include action"
    assert '"speech_sample"' in voice_block, "behavior_examples entries must include speech_sample"
