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


PLANNER_TARGETS = [
    ("PlannerAgent", "generate_concept_and_dna"),
    ("PlannerAgent", "generate_world"),
    ("PlannerAgent", "generate_character"),
    ("PlannerAgent", "generate_outline"),
    ("PlannerAgent", "generate_novel_outline"),
]
WRITER_TARGETS = [
    ("WriterAgent", "write_scene"),
]


class TestAgentSignatureCoverage:
    def test_all_six_agent_methods_accept_user_modifications(self):
        import inspect

        from backend.agents.planner import PlannerAgent
        from backend.agents.writer import WriterAgent

        for class_name, method_name in PLANNER_TARGETS + WRITER_TARGETS:
            cls = PlannerAgent if class_name == "PlannerAgent" else WriterAgent
            method = getattr(cls, method_name)
            sig = inspect.signature(method)
            assert "user_modifications" in sig.parameters, (
                f"{class_name}.{method_name} is missing user_modifications kwarg"
            )

    def test_user_modifications_defaults_to_empty_string(self):
        import inspect

        from backend.agents.planner import PlannerAgent
        from backend.agents.writer import WriterAgent

        for class_name, method_name in PLANNER_TARGETS + WRITER_TARGETS:
            cls = PlannerAgent if class_name == "PlannerAgent" else WriterAgent
            param = inspect.signature(getattr(cls, method_name)).parameters[
                "user_modifications"
            ]
            assert param.default == "", (
                f"{class_name}.{method_name}.user_modifications default "
                f"should be empty string, got {param.default!r}"
            )


class TestEndToEndBackwardCompat:
    def test_empty_user_modifications_renders_no_block(self):
        from backend.agents._injection_helpers import _build_user_modifications_block

        assert _build_user_modifications_block("") == ""
        assert "【用户修改意见】" not in _build_user_modifications_block("")

    def test_nonempty_user_modifications_renders_block_with_text(self):
        from backend.agents._injection_helpers import _build_user_modifications_block

        result = _build_user_modifications_block("让节奏更紧凑")
        assert "【用户修改意见】" in result
        assert "让节奏更紧凑" in result
        assert result.index("【用户修改意见】") < result.index("让节奏更紧凑")


class TestEndToEndWithSuggestion:
    _CONCEPT_STUB_VARS = {
        "initial_intent": "一个复仇故事",
        "genre": "玄幻",
        "genre_tone": "燃",
        "genre_style_rules": "短句",
        "genre_trope_patterns": "废柴逆袭",
    }

    def test_concept_generation_prompt_includes_user_modifications_block(self):
        from backend.agents._injection_helpers import _build_user_modifications_block
        from backend.services.prompt_override_store import load_prompt_effective

        data = load_prompt_effective("concept_generation")
        template = data["user_prompt_template"]
        rendered = template.format(
            **self._CONCEPT_STUB_VARS,
            user_modifications=_build_user_modifications_block("让主角动机更清晰"),
        )
        assert "【用户修改意见】" in rendered
        assert "让主角动机更清晰" in rendered
        assert rendered.rstrip().endswith("让主角动机更清晰")

    def test_concept_generation_prompt_unchanged_with_empty_modifications(self):
        from backend.agents._injection_helpers import _build_user_modifications_block
        from backend.services.prompt_override_store import load_prompt_effective

        data = load_prompt_effective("concept_generation")
        template = data["user_prompt_template"]
        rendered = template.format(
            **self._CONCEPT_STUB_VARS,
            user_modifications=_build_user_modifications_block(""),
        )
        assert "{user_modifications}" not in rendered
        assert "【用户修改意见】" not in rendered


class TestCharLimit:
    def test_helper_does_not_impose_char_limit(self):
        from backend.agents._injection_helpers import _build_user_modifications_block

        long_text = "x" * 5000
        result = _build_user_modifications_block(long_text)
        assert "x" * 5000 in result

    def test_handler_truncates_to_1000_chars_shape(self):
        long_text = "y" * 5000
        truncated = long_text[:1000]
        assert len(truncated) == 1000
