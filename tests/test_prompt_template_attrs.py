"""Verify vestigial PromptTemplate attributes have been removed."""

from backend.agents.base_agent import PromptTemplate


def _make_template() -> PromptTemplate:
    return PromptTemplate({
        "name": "x",
        "provider": "anthropic",
        "model": "claude-test",
        "system_prompt": "sys",
        "user_prompt_template": "user",
        "temperature": 0.5,
        "max_tokens": 100,
        "output_format": {"type": "json"},
    })


class TestDeadAttributesRemoved:
    def test_model_attr_does_not_exist(self):
        t = _make_template()
        assert not hasattr(t, "model")

    def test_provider_attr_does_not_exist(self):
        t = _make_template()
        assert not hasattr(t, "provider")

    def test_name_attr_does_not_exist(self):
        t = _make_template()
        assert not hasattr(t, "name")


class TestLiveAttributesStillPresent:
    """Sanity check: live attributes are not collateral damage."""

    def test_live_attrs_remain(self):
        t = _make_template()
        assert t.temperature == 0.5
        assert t.max_tokens == 100
        assert t.system_prompt == "sys"
        assert t.user_prompt_template == "user"
        assert t.output_format == {"type": "json"}
        assert t.is_json_mode is True
