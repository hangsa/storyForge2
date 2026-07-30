"""Tests for backend.agents._injection_helpers._build_user_modifications_block."""

from backend.agents._injection_helpers import _build_user_modifications_block


class TestUserModificationsHelper:
    def test_empty_string_returns_empty(self):
        assert _build_user_modifications_block("") == ""

    def test_whitespace_only_returns_empty(self):
        assert _build_user_modifications_block("   \n\t  ") == ""

    def test_simple_text_contains_marker_and_text(self):
        result = _build_user_modifications_block("提升冲突密度")
        assert "【用户修改意见】" in result
        assert "提升冲突密度" in result

    def test_leading_and_trailing_whitespace_stripped(self):
        result = _build_user_modifications_block("   请加快节奏   ")
        assert "   请加快节奏   " not in result
        assert "请加快节奏" in result

    def test_multiline_text_preserved(self):
        text = "第一行\n第二行\n第三行"
        result = _build_user_modifications_block(text)
        assert text in result
        assert "【用户修改意见】" in result


class TestFormatUserDefault:
    def test_format_user_supplies_default_for_user_modifications(self):
        from backend.agents.base_agent import PromptTemplate

        template = PromptTemplate(
            {
                "name": "default_guard_test",
                "user_prompt_template": "你好 {user_modifications}",
            }
        )
        rendered = template.format_user()
        assert rendered == "你好 "
        assert "{user_modifications}" not in rendered

    def test_format_user_preserves_explicit_value(self):
        from backend.agents.base_agent import PromptTemplate

        template = PromptTemplate(
            {
                "name": "default_guard_test",
                "user_prompt_template": "你好 {user_modifications}",
            }
        )
        rendered = template.format_user(user_modifications="X")
        assert rendered == "你好 X"


PROMPT_TEMPLATES_WITH_USER_MODIFICATIONS = [
    "concept_generation",
    "world_generation",
    "character_generation",
    "novel_outline_generation",
    "outline_generation",
    "scene_writing",
]


class TestPromptCoverage:
    def test_every_template_declares_user_modifications_placeholder(self):
        from backend.services.prompt_override_store import load_prompt_effective

        missing = []
        for name in PROMPT_TEMPLATES_WITH_USER_MODIFICATIONS:
            template = load_prompt_effective(name)["user_prompt_template"]
            if "{user_modifications}" not in template:
                missing.append(name)
        assert missing == [], f"prompts missing {{user_modifications}}: {missing}"

    def test_placeholder_is_last_content_in_template(self):
        from backend.services.prompt_override_store import load_prompt_effective

        misplaced = []
        for name in PROMPT_TEMPLATES_WITH_USER_MODIFICATIONS:
            template = load_prompt_effective(name)["user_prompt_template"]
            if not template.rstrip().endswith("{user_modifications}"):
                misplaced.append(name)
        assert misplaced == [], (
            f"prompts where {{user_modifications}} is not trailing: {misplaced}"
        )
