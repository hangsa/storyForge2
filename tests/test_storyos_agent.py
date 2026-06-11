import tempfile
import os
import json
import pytest
from backend.agents.storyos_agent import StoryOSAgent


@pytest.fixture
def agent():
    tmp = tempfile.mkdtemp()
    os.makedirs(os.path.join(tmp, "test-proj", "storyos"))
    return StoryOSAgent("test-proj", projects_dir=tmp)


SAMPLE_TEXT = """
林峰站在教室窗边。

<!-- SF_LOG character_emotion char="林峰" emotion="警惕" -->

他走向实验室。

<!-- SF_LOG character_location_change char="林峰" from="教室" to="实验室" -->

<!-- SF_LOG registry_create type="conflict" data='{"id": "cf_001", "owner": "林峰", "target": "师父", "type": "betrayal"}' -->

<!-- SF_LOG registry_create type="mystery" data='{"id": "mys_001", "question": "超脑的秘密"}' -->

<!-- SF_LOG mystery_clue id="mys_001" clue="超脑认识观察者文明的符号" -->

<!-- SF_LOG conflict_escalate id="cf_001" new_intensity="critical" trigger="发现证据" -->

<!-- SF_LOG knowledge_gain char="林峰" content="师父的秘密联络记录" source="实验室终端" -->

<!-- SF_LOG bad_type no="params" -->

<!-- SF_LOG character_emotion char=林峰 emotion=警惕 -->
"""


class TestStoryOSAgent:

    def test_parse_sf_logs(self, agent):
        logs = agent.parse_sf_logs(SAMPLE_TEXT)
        types = [l.type for l in logs]
        assert len(logs) == 7
        assert "character_emotion" in types
        assert "character_location_change" in types
        assert "registry_create" in types
        assert "mystery_clue" in types
        assert "conflict_escalate" in types
        assert "knowledge_gain" in types

    def test_parse_log_params_simple(self, agent):
        params = agent.parse_log_params(
            "character_emotion", 'char="林峰" emotion="警惕"'
        )
        assert params == {"char": "林峰", "emotion": "警惕"}

    def test_parse_log_params_json_data(self, agent):
        params = agent.parse_log_params(
            "registry_create",
            'type="conflict" data=\'{"id": "cf_001", "owner": "林峰"}\'',
        )
        assert params["type"] == "conflict"
        assert isinstance(params["data"], dict)
        assert params["data"]["id"] == "cf_001"

    def test_validate_log_format(self, agent):
        errors = agent.validate_log_format(SAMPLE_TEXT)
        assert len(errors) >= 1
        bad_log_errors = [e for e in errors if "BAD_LOG" in e.raw_text or "bad_type" in e.raw_text]
        assert len(bad_log_errors) >= 1

    def test_update_registries(self, agent):
        logs = agent.parse_sf_logs(SAMPLE_TEXT)
        report = agent.update_registries(logs)

        assert "conflict:cf_001" in report.created
        assert "conflict:cf_001" in report.updated
        assert "mystery:mys_001" in report.updated
        assert "林峰" in report.character_state_updates
        assert report.character_state_updates["林峰"]["emotion"] == "警惕"
        assert report.character_state_updates["林峰"]["location"] == "实验室"

        # Verify conflicts.json
        conflicts_path = os.path.join(
            agent.projects_dir, "test-proj", "storyos", "conflicts.json"
        )
        with open(conflicts_path) as f:
            conflicts = json.load(f)
        assert len(conflicts) == 1
        assert conflicts[0]["id"] == "cf_001"
        assert conflicts[0]["intensity"] == "critical"
        assert len(conflicts[0]["escalation_history"]) == 1
        assert conflicts[0]["escalation_history"][0]["to_intensity"] == "critical"

        # Verify mysteries.json
        mysteries_path = os.path.join(
            agent.projects_dir, "test-proj", "storyos", "mysteries.json"
        )
        with open(mysteries_path) as f:
            mysteries = json.load(f)
        assert len(mysteries) == 1
        assert len(mysteries[0]["clues"]) == 1
        assert "超脑" in mysteries[0]["clues"][0]["text"]

    def test_no_duplicate_registry_create(self, agent):
        logs = agent.parse_sf_logs(SAMPLE_TEXT)
        agent.update_registries(logs)
        # Second call should not duplicate
        report2 = agent.update_registries(logs)
        assert "conflict:cf_001" not in report2.created

    def test_empty_text(self, agent):
        logs = agent.parse_sf_logs("")
        assert logs == []
        errors = agent.validate_log_format("")
        assert errors == []
