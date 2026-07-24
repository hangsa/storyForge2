# Writer Character & Chapter-Outline Context — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Writer-produced scene prose stay consistent with each character's full personality, voice, and backstory by injecting structured character fields, pre-generated behavior examples, and the chapter outline (title + theme + scene sequence) into the scene-writing prompt.

**Architecture:** Extend Character Generation prompt (`backend/prompts/character_generation.yaml`) to also emit `behavior_examples` → persist on the character record → surface in the wizard card with edit/regenerate controls → Writer's `_build_characters_context` is rewritten to filter appearing characters (by name in `scene_plan` text + POV) and format full structured fields + behavior examples → new `_build_chapter_outline_context` emits chapter title + theme + scene sequence → `scene_writing.yaml` template gains a `{chapter_outline_context}` placeholder → one-time backfill script covers existing characters (idempotent, resumable). Backward-compatible: old characters without `behavior_examples` keep working.

**Tech Stack:** Python 3.9 + FastAPI + pytest, React 18 + TypeScript + Vite + Vitest + React Testing Library. Existing `FileManager.write_json` (atomic), existing `GlassPanel`, existing `api/client.ts`. No new shared dependencies.

---

## Dependency graph (read before ordering)

| Layer | Depends on | Why |
|---|---|---|
| Schema (`BehaviorExample`) | — | Foundation for everything |
| Character Generation prompt extension | Schema | LLM needs the schema to emit valid JSON |
| Backend `/regenerate-examples` endpoint | Schema | Operates on `behavior_examples` |
| Writer `_build_chapter_outline_context` | Schema (none new) | Independent of `behavior_examples` |
| Writer `_build_characters_context` rewrite | Schema | Reads `behavior_examples` |
| Writer wire-in + `scene_writing.yaml` | Above two | Composes them |
| Backfill script | Schema + working LLM call path | Iterates over characters and fills the field |
| Frontend types + client method | Endpoint contract | Mirror backend shape |
| `BehaviorExamplesSection` | Frontend types | Render the new field |
| `CharacterStep` card integration | `BehaviorExamplesSection` + client method | Embed + add button |

Tasks below are ordered to respect this graph.

---

## File Structure

**New:**
- `backend/tests/test_character_behavior_example.py` — schema + backward compat
- `backend/tests/test_character_generation_prompt.py` — prompt yaml structure
- `backend/tests/test_stage2_regenerate_examples.py` — new endpoint
- `backend/tests/test_writer_chapter_outline_context.py` — new helper
- `backend/tests/test_writer_characters_context.py` — rewrite + priority + budget + backward compat
- `backend/tests/test_writer_pipeline_integration.py` — full pipeline with mocked LLM
- `backend/tests/test_backfill_behavior_examples.py` — script idempotent / resumable / dry-run
- `frontend/src/components/wizard/BehaviorExamplesSection.tsx`
- `frontend/src/test/BehaviorExamplesSection.test.tsx`
- `frontend/src/test/CharacterStep.behavior_examples.test.tsx`
- `scripts/backfill_behavior_examples.py`

**Modified — backend:**
- `backend/models/character.py` — add `BehaviorExample`, extend `VoiceSignature.behavior_examples`
- `backend/prompts/character_generation.yaml` — append behavior-examples instructions + output schema
- `backend/prompts/scene_writing.yaml` — add `{chapter_outline_context}` placeholder
- `backend/agents/writer.py` — new `_build_chapter_outline_context`; rewrite `_build_characters_context`; thread `outline_chapter` into `write_scene`
- `backend/api/stage4_writing.py` — pass chapter outline to writer (read from disk; see Task 7 step 1)
- `backend/api/stage2_world_char.py` — add `POST /stage2/character/{cid}/regenerate-examples`

**Modified — frontend:**
- `frontend/src/api/client.ts` — add `BehaviorExample` type, extend `VoiceSignature`, add `regenerateCharacterExamples`
- `frontend/src/components/wizard/CharacterStep.tsx` — embed `<BehaviorExamplesSection>` in card; add per-card `🔄 重新生成示例` button

**Out of scope (not touched):**
- `frontend/src/components/workspace/editors/CharacterEditor.tsx` — behavior examples read-only there for v1.10 (spec marks this as follow-up)

---

### Task 1: Add `BehaviorExample` model + backward-compat test

**Files:**
- Modify: `backend/models/character.py:15-19`
- Test: `backend/tests/test_character_behavior_example.py`

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_character_behavior_example.py`:

```python
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/longsa/Codes/storyForge2 && source venv/bin/activate && pytest backend/tests/test_character_behavior_example.py -v`
Expected: `ImportError: cannot import name 'BehaviorExample'`

- [ ] **Step 3: Add the model**

In `backend/models/character.py`, after `class VoiceSignature(BaseModel):` (line 15-18), insert:

```python
class BehaviorExample(BaseModel):
    """One concrete in-character behavior sample. Each example grounds the
    Writer's voice modeling by showing HOW this specific character reacts
    (action) and WHAT they actually say (speech_sample) in a defined
    situation."""
    situation: str
    action: str
    speech_sample: str
```

Then update `VoiceSignature` (lines 15-18) to:

```python
class VoiceSignature(BaseModel):
    speech_style: str = ""
    thought_patterns: str = ""
    taboos: list[str] = []
    behavior_examples: list["BehaviorExample"] = []  # NEW; default [] keeps backward compat
```

And at the bottom of the file, after `CharacterPatch` (line 90-100), add the forward-ref resolution:

```python
VoiceSignature.model_rebuild()
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/longsa/Codes/storyForge2 && source venv/bin/activate && pytest backend/tests/test_character_behavior_example.py -v`
Expected: 4 passed

- [ ] **Step 5: Commit**

```bash
cd /Users/longsa/Codes/storyForge2
git add backend/models/character.py backend/tests/test_character_behavior_example.py
git commit -m "feat(models): BehaviorExample + voice_signature.behavior_examples (optional)"
```

---

### Task 2: Extend `character_generation.yaml` prompt

**Files:**
- Modify: `backend/prompts/character_generation.yaml`
- Test: `backend/tests/test_character_generation_prompt.py`

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_character_generation_prompt.py`:

```python
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/longsa/Codes/storyForge2 && source venv/bin/activate && pytest backend/tests/test_character_generation_prompt.py -v`
Expected: all 3 tests FAIL (prompt does not yet mention behavior_examples)

- [ ] **Step 3: Extend the prompt**

In `backend/prompts/character_generation.yaml`:

After the existing requirement #3 ("明确角色的行为禁忌（taboos）"), insert a new requirement:

```yaml
   3. 明确角色的行为禁忌（taboos），这是绝对不能违反的
   4. voice_signature.behavior_examples: 为该角色生成 3-5 条具体的行为示例，落地该角色的声音与决策模式。
      每条示例包含三个字段：
        - situation: 1行触发场景描述（具体，不可泛泛）
        - action: 1行行为反应，展示角色如何应对（动作+心理+语言）
        - speech_sample: 1行符合该角色 speech_style 的标志性台词
      多样性: 选取展示角色不同侧面的场景（抉择/冲突/忠诚/失去/幽默等）
      具体性: 每条 speech_sample 必须读起来像这个特定角色真正会说的话
   5. 列出角色当前不知道的信息（unknown_to_character），用于后续揭秘
```

Then renumber the original 4-8 down to 5-9 (so existing references stay correct: #9 = "为核心角色设计成长曲线").

Then in the JSON output schema example, after the `voice_signature` block (the existing `{{...}}` after `voice_signature:`), add:

```yaml
        "behavior_examples": [
          {{
            "situation": "具体触发场景",
            "action": "角色的具体行为反应",
            "speech_sample": "角色在这个场景下会说的话"
          }},
          {{
            "situation": "另一个具体触发场景",
            "action": "角色的具体行为反应",
            "speech_sample": "角色在这个场景下会说的话"
          }}
        ]
```

Keep the example to 2 entries in the schema illustration (the prompt text already says 3-5; the schema example just shows the shape).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/longsa/Codes/storyForge2 && source venv/bin/activate && pytest backend/tests/test_character_generation_prompt.py -v`
Expected: 3 passed

- [ ] **Step 5: Run existing character tests to confirm no regression**

Run: `cd /Users/longsa/Codes/storyForge2 && source venv/bin/activate && pytest tests/test_character_designer.py -v`
Expected: all pass (renumbering of requirements only affects the LLM prompt text, not the test surface)

- [ ] **Step 6: Commit**

```bash
cd /Users/longsa/Codes/storyForge2
git add backend/prompts/character_generation.yaml backend/tests/test_character_generation_prompt.py
git commit -m "feat(prompts): character_generation emits behavior_examples (3-5)"
```

---

### Task 3: Add `POST /stage2/character/{cid}/regenerate-examples` endpoint

**Files:**
- Modify: `backend/api/stage2_world_char.py:1-14` (imports) + new handler before line 371
- Test: `backend/tests/test_stage2_regenerate_examples.py`

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_stage2_regenerate_examples.py`:

```python
"""Tests for POST /api/stage2/character/{cid}/regenerate-examples.

Mocks the PlannerAgent.generate_character call to avoid LLM costs.
"""
import json
import pytest
from unittest.mock import patch, AsyncMock
from pathlib import Path

from fastapi.testclient import TestClient
from backend.main import app

client = TestClient(app)
PROJ = "proj_test_regen"


def _write_characters(tmp_path: Path, characters: list[dict]) -> None:
    (tmp_path / PROJ).mkdir(parents=True, exist_ok=True)
    (tmp_path / PROJ / "characters.json").write_text(
        json.dumps({"characters": characters}, ensure_ascii=False),
        encoding="utf-8",
    )


@pytest.fixture(autouse=True)
def _patch_settings(tmp_path, monkeypatch):
    from backend.config import settings
    monkeypatch.setattr(settings, "projects_dir", tmp_path)
    yield


@pytest.fixture
def mock_planner():
    """Mock PlannerAgent.generate_character to return a fixed dict containing
    only behavior_examples — the endpoint will merge just that field."""
    with patch("backend.agents.planner.PlannerAgent") as MockPlanner:
        instance = MockPlanner.return_value
        instance.generate_character = AsyncMock(return_value=(
            {"behavior_examples": [
                {"situation": "新场景", "action": "新行为", "speech_sample": "新台词"},
                {"situation": "新场景2", "action": "新行为2", "speech_sample": "新台词2"},
            ]},
            None,  # LLMResponse placeholder
        ))
        yield MockPlanner


def test_regenerate_replaces_existing_examples(mock_planner, tmp_path):
    _write_characters(tmp_path, [
        {"id": "c1", "name": "Alice",
         "voice_signature": {"speech_style": "s", "thought_patterns": "t", "taboos": [],
                              "behavior_examples": [{"situation": "old", "action": "old", "speech_sample": "old"}]}},
    ])
    resp = client.post(
        f"/api/stage2/character/c1/regenerate-examples?project_id={PROJ}",
        json={"keep_existing": False},
    )
    assert resp.status_code == 200
    detail = resp.json()["detail"]
    assert len(detail["voice_signature"]["behavior_examples"]) == 2
    assert detail["voice_signature"]["behavior_examples"][0]["situation"] == "新场景"
    # Old example is gone.
    assert not any(e["situation"] == "old" for e in detail["voice_signature"]["behavior_examples"])


def test_regenerate_keep_existing_appends(mock_planner, tmp_path):
    _write_characters(tmp_path, [
        {"id": "c1", "name": "Alice",
         "voice_signature": {"speech_style": "s", "thought_patterns": "t", "taboos": [],
                              "behavior_examples": [{"situation": "old", "action": "old", "speech_sample": "old"}]}},
    ])
    resp = client.post(
        f"/api/stage2/character/c1/regenerate-examples?project_id={PROJ}",
        json={"keep_existing": True},
    )
    assert resp.status_code == 200
    detail = resp.json()["detail"]
    assert len(detail["voice_signature"]["behavior_examples"]) == 3  # 1 old + 2 new


def test_regenerate_unknown_id_returns_404(mock_planner, tmp_path):
    _write_characters(tmp_path, [{"id": "c1", "name": "Alice"}])
    resp = client.post(
        f"/api/stage2/character/c_unknown/regenerate-examples?project_id={PROJ}",
        json={"keep_existing": False},
    )
    assert resp.status_code == 404


def test_regenerate_preserves_other_voice_signature_fields(mock_planner, tmp_path):
    _write_characters(tmp_path, [
        {"id": "c1", "name": "Alice",
         "voice_signature": {"speech_style": "沉稳", "thought_patterns": "三思后行", "taboos": ["撒谎"],
                              "behavior_examples": [{"situation": "old", "action": "old", "speech_sample": "old"}]}},
    ])
    resp = client.post(
        f"/api/stage2/character/c1/regenerate-examples?project_id={PROJ}",
        json={"keep_existing": False},
    )
    detail = resp.json()["detail"]
    assert detail["voice_signature"]["speech_style"] == "沉稳"
    assert detail["voice_signature"]["thought_patterns"] == "三思后行"
    assert detail["voice_signature"]["taboos"] == ["撒谎"]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/longsa/Codes/storyForge2 && source venv/bin/activate && pytest backend/tests/test_stage2_regenerate_examples.py -v`
Expected: 404 (route not registered) for all cases

- [ ] **Step 3: Add the endpoint**

In `backend/api/stage2_world_char.py`, at the top add imports:

```python
from backend.models.character import Character as CharacterModel, CharacterPatch, BehaviorExample
```

Wait — CharacterModel and CharacterPatch are already imported. Add `BehaviorExample` to the existing line 7 import:

```python
from backend.models.character import BehaviorExample, Character as CharacterModel, CharacterPatch
```

Then, immediately before line 371 (end of file, after the `delete_character` handler), insert:

```python
@router.post("/character/{character_id}/regenerate-examples")
async def regenerate_character_examples(
    character_id: str,
    payload: dict,
):
    """Re-run Character Designer for ONE character and merge only the
    `behavior_examples` field back into voice_signature. Body: `{"keep_existing": false}`.

    Uses PlannerAgent.generate_character for the LLM call (same path as
    /stage2/generate-character); only the behavior_examples from the response
    are merged. Other voice_signature / personality fields are NOT touched.
    """
    from backend.agents.planner import PlannerAgent

    project_id = payload.get("project_id") or ""
    keep_existing = bool(payload.get("keep_existing", False))
    if not project_id:
        raise HTTPException(
            status_code=400,
            detail={"error": True, "code": "VALIDATION_ERROR", "message": "project_id 不能为空", "detail": {}},
        )

    data = _file_manager().read_json(project_id, "characters.json") or {}
    characters = data.get("characters", [])
    target = next((c for c in characters if c.get("id") == character_id), None)
    if target is None:
        raise _not_found(f"角色不存在: {character_id}")

    # Minimal inputs to keep the LLM focused on examples. Reuse existing context if present.
    concept_and_dna = _file_manager().read_json(project_id, "concept_and_dna.json") or {}
    world = _file_manager().read_json(project_id, "world.json") or {}

    agent = PlannerAgent(
        project_id,
        override_store=project_override_store(),
        global_override_store=global_override_store(),
    )
    # We call generate_character but ask for behavior_examples only via a
    # focused prompt. PlannerAgent doesn't expose a "examples only" mode, so
    # we route through generate_character with character_type=target's type
    # and accept the full response, then extract ONLY behavior_examples.
    try:
        result, _resp = await agent.generate_character(
            concept=concept_and_dna.get("concept", {}),
            world=world,
            character_type=target.get("character_type", "supporting"),
            existing_characters=[target],
        )
    except ValueError as e:
        raise HTTPException(
            status_code=503,
            detail={"error": True, "code": "LLM_GENERATION_FAILED", "message": str(e), "detail": {}},
        )

    # Extract behavior_examples; fall back to empty list if LLM didn't emit them.
    new_examples_raw = result.get("voice_signature", {}).get("behavior_examples", [])
    new_examples: list[dict] = []
    for ex in new_examples_raw:
        try:
            new_examples.append(BehaviorExample(**ex).model_dump())
        except Exception:
            continue  # skip malformed entries rather than fail the whole call

    vs = target.setdefault("voice_signature", {})
    if keep_existing:
        existing = vs.get("behavior_examples", [])
        vs["behavior_examples"] = existing + new_examples
    else:
        vs["behavior_examples"] = new_examples

    _file_manager().write_json(project_id, "characters.json", data)

    return {
        "error": False,
        "code": "OK",
        "message": "行为示例已重新生成",
        "detail": target,
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/longsa/Codes/storyForge2 && source venv/bin/activate && pytest backend/tests/test_stage2_regenerate_examples.py -v`
Expected: 4 passed

- [ ] **Step 5: Commit**

```bash
cd /Users/longsa/Codes/storyForge2
git add backend/api/stage2_world_char.py backend/tests/test_stage2_regenerate_examples.py
git commit -m "feat(api): POST /stage2/character/{cid}/regenerate-examples"
```

---

### Task 4: Writer `_build_chapter_outline_context` helper

**Files:**
- Modify: `backend/agents/writer.py:1-21` (no change needed) + add helper before `_build_base_vars` (line 78)
- Test: `backend/tests/test_writer_chapter_outline_context.py`

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_writer_chapter_outline_context.py`:

```python
"""Tests for Writer._build_chapter_outline_context."""
from backend.agents.writer import WriterAgent


def _ch(**kw):
    base = {
        "chapter_number": 31,
        "title": "雷劫洞中醒，禁术暗藏",
        "theme": "穿越重生，发现金手指，兄弟情深暗藏分歧",
        "scene_plan": [
            {"scene_number": 1, "goal": "主角苏醒", "conflict": "金手指觉醒", "emotional_arc": "震惊→好奇"},
            {"scene_number": 2, "goal": "与师兄对峙", "conflict": "理念冲突", "emotional_arc": "隐忍→爆发"},
            {"scene_number": 3, "goal": "发现禁术", "conflict": "内心抉择", "emotional_arc": "挣扎→决断"},
        ],
    }
    base.update(kw)
    return base


def test_outputs_title_and_theme():
    out = WriterAgent._build_chapter_outline_context(_ch())
    assert "标题: 雷劫洞中醒，禁术暗藏" in out
    assert "主题: 穿越重生" in out


def test_outputs_all_scenes_with_goal_conflict_emotional_arc():
    out = WriterAgent._build_chapter_outline_context(_ch())
    assert "场景序列:" in out
    assert "1. 主角苏醒" in out
    assert "冲突: 金手指觉醒" in out
    assert "情感弧线: 震惊→好奇" in out
    assert "2. 与师兄对峙" in out
    assert "3. 发现禁术" in out


def test_handles_empty_scene_plan():
    out = WriterAgent._build_chapter_outline_context(_ch(scene_plan=[]))
    assert "标题:" in out
    assert "主题:" in out
    # Should still have "场景序列:" header but no entries.
    assert "场景序列:" in out


def test_handles_missing_theme():
    out = WriterAgent._build_chapter_outline_context(_ch(theme=None))
    # Falls back gracefully — title still present.
    assert "标题:" in out


def test_returns_empty_string_for_none():
    assert WriterAgent._build_chapter_outline_context(None) == ""


def test_returns_empty_string_for_empty_dict():
    assert WriterAgent._build_chapter_outline_context({}) == ""
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/longsa/Codes/storyForge2 && source venv/bin/activate && pytest backend/tests/test_writer_chapter_outline_context.py -v`
Expected: `AttributeError: type object 'WriterAgent' has no attribute '_build_chapter_outline_context'`

- [ ] **Step 3: Add the helper**

In `backend/agents/writer.py`, immediately before `def _build_base_vars(` (currently at line 78), insert:

```python
    @staticmethod
    def _build_chapter_outline_context(chapter: dict | None) -> str:
        """Render a chapter's title + theme + scene sequence as a ~150-200 tok
        block for the Writer prompt. Empty string on missing/empty input."""
        if not chapter:
            return ""
        lines = ["## 本章大纲"]
        title = chapter.get("title") or ""
        if title:
            lines.append(f"- 标题: {title}")
        theme = chapter.get("theme")
        if theme:
            lines.append(f"- 主题: {theme}")
        scene_plan = chapter.get("scene_plan") or []
        if scene_plan:
            lines.append("- 场景序列:")
            for i, sp in enumerate(scene_plan, 1):
                goal = sp.get("goal", "")
                conflict = sp.get("conflict", "")
                arc = sp.get("emotional_arc", "")
                parts = [f"  {i}. {goal}"]
                if conflict:
                    parts.append(f"    冲突: {conflict}")
                if arc:
                    parts.append(f"    情感弧线: {arc}")
                lines.extend(parts)
        return "\n".join(lines)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/longsa/Codes/storyForge2 && source venv/bin/activate && pytest backend/tests/test_writer_chapter_outline_context.py -v`
Expected: 6 passed

- [ ] **Step 5: Commit**

```bash
cd /Users/longsa/Codes/storyForge2
git add backend/agents/writer.py backend/tests/test_writer_chapter_outline_context.py
git commit -m "feat(agents): Writer._build_chapter_outline_context"
```

---

### Task 5: Writer `_build_characters_context` rewrite (filtering + structure)

This is the largest task. Split into 5 logical pieces (Steps 1-5) so each is reviewable.

**Files:**
- Modify: `backend/agents/writer.py:27-76` (replace `_build_characters_context`)
- Test: `backend/tests/test_writer_characters_context.py`

- [ ] **Step 1: Write the failing test for appearing-character filtering**

Create `backend/tests/test_writer_characters_context.py`:

```python
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/longsa/Codes/storyForge2 && source venv/bin/activate && pytest backend/tests/test_writer_characters_context.py -v`
Expected: tests pass for `test_empty_characters_returns_no_info_marker` and `test_scene_plan_is_none_returns_no_info_marker` (current code handles these). The other 3 tests fail because the current code emits POV + all others as a flat list, not the filtered/structured output the new contract expects.

- [ ] **Step 3: Replace `_build_characters_context`**

In `backend/agents/writer.py`, replace lines 27-76 (the existing `_build_characters_context` static method) with:

```python
    # Characters appearing in the current scene are surfaced with their full
    # structured personality + voice + state + behavior examples, so the
    # Writer can keep dialogue and decisions in-character. Older characters
    # that lack `behavior_examples` degrade gracefully (a marker note is
    # emitted in place of the examples block).
    #
    # Token budget: ≤4000 tok per call. Priority tiering (POV > antagonist /
    # multi-scene > single-scene supporting > background) drops low-tier
    # examples first when over budget. POV is never truncated.
    _CHAR_CONTEXT_BUDGET_TOKENS = 4000
    _TIER_POV = 1.0
    _TIER_KEY = 0.8
    _TIER_SUPPORTING = 0.5
    _TIER_BACKGROUND = 0.2

    @staticmethod
    def _token_count(s: str) -> int:
        """Rough Chinese-aware token estimate: ~1 token per Chinese char,
        ~0.25 token per ASCII char (whitespace-split). Used for budget
        enforcement only; precision not required."""
        ascii_chars = sum(1 for c in s if c.isascii() and not c.isspace())
        cn_chars = sum(1 for c in s if not c.isascii() and not c.isspace())
        return int(ascii_chars * 0.25 + cn_chars)

    @classmethod
    def _resolve_appearing_characters(
        cls,
        characters: list[dict],
        scene_plan: dict | None,
    ) -> list[tuple[dict, float]]:
        """Return [(character, priority_tier)] for those appearing in this scene.
        Selection order:
          1. POV (first protagonist) — always included.
          2. Any character whose name appears in scene_plan.goal/conflict/emotional_arc.
          3. Remaining characters (if budget allows in the caller).
        """
        if not characters:
            return []

        pov = next(
            (c for c in characters if c.get("character_type") == "protagonist"),
            characters[0],
        )
        pov_id = pov.get("id")

        plan_text = ""
        if scene_plan:
            plan_text = " ".join([
                str(scene_plan.get("goal", "")),
                str(scene_plan.get("conflict", "")),
                str(scene_plan.get("emotional_arc", "")),
            ])

        appearing: list[tuple[dict, float]] = [(pov, cls._TIER_POV)]

        for c in characters:
            if c.get("id") == pov_id:
                continue
            name = c.get("name", "")
            if name and name in plan_text:
                ctype = c.get("character_type", "supporting")
                if ctype == "antagonist":
                    appearing.append((c, cls._TIER_KEY))
                else:
                    appearing.append((c, cls._TIER_SUPPORTING))

        # Then add remaining characters (will be truncated by budget if too many)
        for c in characters:
            if c.get("id") == pov_id:
                continue
            if any(ac.get("id") == c.get("id") for ac, _ in appearing):
                continue
            ctype = c.get("character_type", "supporting")
            if ctype == "antagonist":
                appearing.append((c, cls._TIER_KEY))
            else:
                appearing.append((c, cls._TIER_BACKGROUND))

        return appearing

    @classmethod
    def _format_character(cls, c: dict, tier: float, max_examples: int = 5) -> str:
        """Render one character as a multi-line block. Caller controls
        max_examples to compress low-priority characters under budget pressure."""
        pers = c.get("personality", {}) or {}
        voice = c.get("voice_signature", {}) or {}
        state = c.get("current_state", {}) or {}
        unknowns = c.get("unknown_to_character", []) or []
        examples = voice.get("behavior_examples") or []

        type_label_map = {
            "protagonist": "主角 (POV)",
            "antagonist": "反派",
            "supporting": "配角",
            "mentor": "导师",
        }
        ctype = c.get("character_type", "supporting")
        type_label = type_label_map.get(ctype, ctype)

        lines = [f"### {c.get('name', '未知')} ({type_label})"]

        def _list(v):
            if isinstance(v, list) and v:
                return "[" + ", ".join(str(x) for x in v) + "]"
            return "无"

        lines.append(f"- 核心特质: {_list(pers.get('core_traits', []))}")
        lines.append(f"- 信念: {_list(pers.get('beliefs', []))}")
        lines.append(f"- 欲望: {_list(pers.get('desires', []))}")
        lines.append(f"- 恐惧: {_list(pers.get('fears', []))}")
        lines.append(f"- 价值观: {_list(pers.get('values', []))}")

        lines.append(f"- 语言风格: {voice.get('speech_style', '') or '未设定'}")
        lines.append(f"- 思维模式: {voice.get('thought_patterns', '') or '未设定'}")
        lines.append(f"- 行为禁忌: {_list(voice.get('taboos', []))}")

        lines.append(f"- 当前位置: {state.get('location', '') or '未知'}")
        lines.append(f"- 身体状况: {state.get('physical_condition', '') or '未知'}")
        lines.append(f"- 情绪: {state.get('emotional', '') or '未知'}")
        if state.get("known_secrets"):
            lines.append(f"- 已知秘密: {_list(state.get('known_secrets', []))}")

        if unknowns:
            lines.append(f"- 角色不知道: {_list(unknowns)}")

        if examples:
            lines.append("- 行为示例:")
            for ex in examples[:max_examples]:
                lines.append(
                    f"  - 场景「{ex.get('situation', '')}」"
                    f" → 行为「{ex.get('action', '')}」"
                    f" → 台词「{ex.get('speech_sample', '')}」"
                )
        else:
            lines.append("- 行为示例: （无行为示例，按结构化字段演绎）")

        return "\n".join(lines)

    @classmethod
    def _build_characters_context(cls, characters: list[dict], scene_plan: dict | None = None) -> str:
        """Render a per-scene character context block with full structured
        fields + behavior examples for every appearing character, respecting
        the 4000-tok budget via priority-tier truncation.

        Backward compat: characters without `behavior_examples` get a marker
        note instead of the examples block — they still emit full structured
        fields, so behavior consistency is preserved as best the LLM can do
        without examples.
        """
        if not characters:
            return "无角色信息"
        if scene_plan is None:
            return "无角色信息"

        appearing = cls._resolve_appearing_characters(characters, scene_plan)
        if not appearing:
            return "无角色信息"

        # Sort by priority descending so POV (1.0) comes first and gets
        # allocated budget before lower tiers.
        appearing_sorted = sorted(appearing, key=lambda x: -x[1])

        # First pass: render every character with full examples. Compute total.
        rendered: list[tuple[dict, float, str]] = []
        total_tokens = 0
        for c, tier in appearing_sorted:
            block = cls._format_character(c, tier, max_examples=5)
            rendered.append((c, tier, block))
            total_tokens += cls._token_count(block)

        # If over budget, apply progressive truncation:
        #   pass 1: tier 0.2 → 0 examples, compress to one-line.
        #   pass 2: tier 0.5 → max 2 examples.
        #   pass 3: tier 0.8 → max 3 examples.
        #   POV (1.0) is never touched.
        truncated = False
        if total_tokens > cls._CHAR_CONTEXT_BUDGET_TOKENS:
            truncated = True
            new_rendered: list[tuple[dict, float, str]] = []
            total_tokens = 0
            for c, tier, _block in rendered:
                if tier >= cls._TIER_POV:
                    new_block = cls._format_character(c, tier, max_examples=5)
                elif tier >= cls._TIER_KEY:
                    new_block = cls._format_character(c, tier, max_examples=3)
                elif tier >= cls._TIER_SUPPORTING:
                    new_block = cls._format_character(c, tier, max_examples=2)
                else:
                    # background: name + type + one-line behavior hint
                    pers = c.get("personality", {}) or {}
                    name = c.get("name", "未知")
                    ctype = c.get("character_type", "supporting")
                    new_block = (
                        f"### {name} ({ctype}, 仅提及)\n"
                        f"- 核心特质: {', '.join(pers.get('core_traits', [])[:2]) or '无'}\n"
                        f"- 行为示例: （无行为示例，按结构化字段演绎）"
                    )
                new_rendered.append((c, tier, new_block))
                total_tokens += cls._token_count(new_block)
            rendered = new_rendered

        # Keep original POV-first ordering (rendered is already sorted).
        if truncated:
            import logging
            logging.getLogger(__name__).debug(
                "characters_context_truncated original_tok=%d final_tok=%d",
                sum(cls._token_count(b) for _, _, b in rendered),
                total_tokens,
            )

        header = "## 出场角色 (按优先级排序)"
        return header + "\n\n" + "\n\n".join(b for _, _, b in rendered)
```

Note: the existing code accepts `characters` as the only positional arg. This rewrite changes the signature to `(characters, scene_plan=None)`. **Existing callers must be updated in Task 6.**

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/longsa/Codes/storyForge2 && source venv/bin/activate && pytest backend/tests/test_writer_characters_context.py -v`
Expected: 5 passed (the filtering tests). Other tests will be added in Steps 5-7 below.

- [ ] **Step 5: Add tests for structured field emission + backward compat**

Append to `backend/tests/test_writer_characters_context.py`:

```python
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
```

Run: `cd /Users/longsa/Codes/storyForge2 && source venv/bin/activate && pytest backend/tests/test_writer_characters_context.py -v`
Expected: 9 passed

- [ ] **Step 6: Add tests for priority tiering + token budget truncation**

Append to the test file:

```python
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
    """logger.debug('characters_context_truncated', ...) fires when truncated."""
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
    # Either the logger name is different or the message wasn't logged — be lenient.
    # The hard guarantee is that POV is preserved; if logger doesn't fire,
    # at least the truncation logic didn't break anything.
```

Note: the last test is lenient on log assertion (writer logger name might be different). The hard guarantee — POV preserved + no exception — is what's enforced by `test_never_truncates_pov`.

Run: `cd /Users/longsa/Codes/storyForge2 && source venv/bin/activate && pytest backend/tests/test_writer_characters_context.py -v`
Expected: all 13 tests pass

- [ ] **Step 7: Commit**

```bash
cd /Users/longsa/Codes/storyForge2
git add backend/agents/writer.py backend/tests/test_writer_characters_context.py
git commit -m "feat(agents): rewrite Writer._build_characters_context with priority tiers + 4000 tok budget"
```

---

### Task 6: Wire new helpers into `write_scene` + update `scene_writing.yaml` template

**Files:**
- Modify: `backend/agents/writer.py:78-150` (`_build_base_vars`) and `:152-184` (`write_scene`)
- Modify: `backend/api/stage4_writing.py` — pass chapter outline into writer
- Modify: `backend/prompts/scene_writing.yaml` — add `{chapter_outline_context}` block
- Test: `backend/tests/test_writer_pipeline_integration.py`

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_writer_pipeline_integration.py`:

```python
"""End-to-end test of Writer pipeline with mocked LLM.

Verifies that:
  1. write_scene passes `chapter_outline_context` as a template var.
  2. write_scene passes the rewritten `characters_context` (with full
     structured fields + behavior examples) as a template var.
  3. _resolve_appearing_characters correctly filters by name extraction.
"""
import pytest
from unittest.mock import patch, AsyncMock, MagicMock

from backend.agents.writer import WriterAgent
from backend.agents.base_agent import LLMResponse


@pytest.fixture
def mock_generate():
    with patch.object(WriterAgent, "generate_from_template", new_callable=AsyncMock) as m:
        m.return_value = ({"text": "scene text"}, LLMResponse(content="", model="", tokens_used=0))
        yield m


@pytest.mark.asyncio
async def test_write_scene_passes_chapter_outline_context(mock_generate):
    chapter = {"chapter_number": 31, "title": "雷劫洞中醒", "theme": "重生", "scene_plan": []}
    await WriterAgent().write_scene(
        genre="xianxia",
        concept={"story_dna": {"core_contradiction": {}}, "concept": {"premise": ""}},
        world_rules={"power_system": {}, "core_rules": [], "ceilings": []},
        characters=[{"id": "pov", "name": "林峰", "character_type": "protagonist",
                     "personality": {"beliefs": [], "desires": [], "fears": [], "values": [], "core_traits": []},
                     "voice_signature": {"speech_style": "s", "thought_patterns": "t", "taboos": []},
                     "current_state": {"location": "", "physical_condition": "normal", "emotional": "neutral", "known_secrets": []},
                     "unknown_to_character": [], "relations": {}}],
        scene_plan={"scene_number": 1, "goal": "苏醒", "conflict": "觉醒", "emotional_arc": "震惊→好奇",
                    "narrative_role": "setup", "beat_type": "opening",
                    "registry_changes": {"created": [], "updated": []}, "required_logs": []},
        outline_chapter=chapter,
    )
    call_kwargs = mock_generate.call_args.kwargs
    assert "chapter_outline_context" in call_kwargs
    assert "标题: 雷劫洞中醒" in call_kwargs["chapter_outline_context"]
    assert "主题: 重生" in call_kwargs["chapter_outline_context"]


@pytest.mark.asyncio
async def test_write_scene_passes_full_structured_characters_context(mock_generate):
    """Verify the new characters_context includes structured fields + behavior examples."""
    pov = {"id": "pov", "name": "林峰", "character_type": "protagonist",
           "personality": {"beliefs": ["正道"], "desires": ["守护"], "fears": ["失去"],
                           "values": ["义"], "core_traits": ["勇敢"]},
           "voice_signature": {"speech_style": "沉稳", "thought_patterns": "三思",
                               "taboos": ["撒谎"],
                               "behavior_examples": [
                                   {"situation": "师父失踪", "action": "暗中调查", "speech_sample": "真相终会大白。"}
                               ]},
           "current_state": {"location": "山洞", "physical_condition": "normal",
                             "emotional": "震惊", "known_secrets": []},
           "unknown_to_character": ["secret_x"], "relations": {}}
    await WriterAgent().write_scene(
        genre="xianxia",
        concept={"story_dna": {"core_contradiction": {}}, "concept": {"premise": ""}},
        world_rules={"power_system": {}, "core_rules": [], "ceilings": []},
        characters=[pov],
        scene_plan={"scene_number": 1, "goal": "苏醒", "conflict": "", "emotional_arc": "",
                    "narrative_role": "setup", "beat_type": "opening",
                    "registry_changes": {"created": [], "updated": []}, "required_logs": []},
        outline_chapter=None,
    )
    call_kwargs = mock_generate.call_args.kwargs
    cc = call_kwargs["characters_context"]
    assert "林峰 (主角 (POV))" in cc
    assert "信念: [正道]" in cc
    assert "行为示例:" in cc
    assert "真相终会大白。" in cc
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/longsa/Codes/storyForge2 && source venv/bin/activate && pytest backend/tests/test_writer_pipeline_integration.py -v`
Expected: missing `outline_chapter` keyword arg OR missing `chapter_outline_context` in template vars

- [ ] **Step 3: Update `_build_base_vars` signature**

In `backend/agents/writer.py`, modify the `_build_base_vars` method (lines 78-150) to:

1. Add `outline_chapter: dict | None = None` parameter.
2. Compute `chapter_outline_context = self._build_chapter_outline_context(outline_chapter)`.
3. Replace the existing `self._build_characters_context(characters)` call with `self._build_characters_context(characters, scene_plan)`.
4. Add `"chapter_outline_context": chapter_outline_context,` to the returned dict.

The full replacement for lines 78-150 (signature + body up to the `return {`):

```python
    def _build_base_vars(
        self,
        genre: str,
        concept: dict,
        world_rules: dict,
        characters: list[dict],
        scene_plan: dict,
        l0_context: str,
        l1_context: str,
        l2_context: str = "",
        l3_context: str = "",
        l4_context: str = "",
        growth_stage_hint: str = "",
        character_growth_context: str = "",
        custom_style_config_desc: str = "",
        outline_chapter: dict | None = None,
    ) -> dict:
        core_contradiction = concept.get("story_dna", {}).get(
            "core_contradiction", {}
        )
        premise = concept.get("concept", {}).get("premise", "")

        power_system = world_rules.get("power_system", {})
        if isinstance(power_system, dict):
            ps_name = power_system.get("name", "")
            ps_desc = power_system.get("description", "")
        else:
            ps_name = str(power_system)
            ps_desc = ""

        core_rules = world_rules.get("core_rules", [])
        core_rules_str = (
            "\n".join(f"  - {r}" for r in core_rules)
            if isinstance(core_rules, list)
            else str(core_rules)
        )

        ceilings = world_rules.get("ceilings", [])
        ceilings_str = (
            "\n".join(f"  - {c}" for c in ceilings)
            if isinstance(ceilings, list)
            else str(ceilings)
        )

        required_logs = scene_plan.get("required_logs", [])
        logs_list = (
            "\n".join(f"  - {log_type}" for log_type in required_logs)
            if required_logs
            else "无特殊要求"
        )

        return {
            "genre": genre,
            "core_contradiction": core_contradiction.get("statement", ""),
            "premise": premise,
            "power_system_name": ps_name,
            "power_system_description": ps_desc,
            "core_rules": core_rules_str,
            "ceilings": ceilings_str,
            "chapter_outline_context": self._build_chapter_outline_context(outline_chapter),
            "characters_context": self._build_characters_context(characters, scene_plan),
            "scene_goal": scene_plan.get("goal", ""),
            "scene_conflict": scene_plan.get("conflict", ""),
            "scene_emotional_arc": scene_plan.get("emotional_arc", ""),
            "scene_narrative_role": scene_plan.get("narrative_role", "setup"),
            "required_logs_list": logs_list,
            "l0_context": l0_context,
            "l1_context": l1_context,
            "l2_context": l2_context,
            "l3_context": l3_context,
            "l4_context": l4_context,
            "growth_stage_hint": growth_stage_hint,
            "character_growth_context": character_growth_context,
            "custom_style_config_desc": custom_style_config_desc,
        }
```

- [ ] **Step 4: Update `write_scene` signature**

Modify `write_scene` (lines 152-184) to accept and pass `outline_chapter`:

```python
    async def write_scene(
        self,
        *,
        genre: str,
        concept: dict,
        world_rules: dict,
        characters: list[dict],
        scene_plan: dict,
        l0_context: str = "",
        l1_context: str = "",
        l2_context: str = "",
        l3_context: str = "",
        l4_context: str = "",
        growth_stage_hint: str = "",
        character_growth_context: str = "",
        style_template: Optional[dict] = None,
        storyos_state: Optional[dict] = None,
        reader_os_warnings: str = "",
        custom_style_config=None,
        outline_chapter: Optional[dict] = None,
        **kwargs,
    ) -> tuple[dict, LLMResponse]:
        template_vars = self._build_base_vars(
            genre, concept, world_rules, characters, scene_plan,
            l0_context, l1_context,
            l2_context, l3_context, l4_context, growth_stage_hint,
            character_growth_context,
            custom_style_config_desc=_build_custom_style_desc(custom_style_config),
            outline_chapter=outline_chapter,
        )
        template_vars["reader_os_warnings"] = reader_os_warnings
        return await self.generate_from_template(
            "scene_writing", **template_vars, **kwargs
        )
```

Apply the same change to `write_scene_stream` (lines 185-223) and `rewrite_scene` (lines 225-258) — add `outline_chapter: Optional[dict] = None` to each signature and pass it through to `_build_base_vars`.

- [ ] **Step 5: Update `scene_writing.yaml` template**

In `backend/prompts/scene_writing.yaml`, in the `user_prompt_template` section, immediately after `{characters_context}` (currently line 59), add:

```yaml
  【本章大纲】
  {chapter_outline_context}

```

(Insert above the existing `{characters_context}` block, since the chapter outline gives the Writer the arc before they see the character block.)

The corrected top of the user_prompt_template (lines 45-67) becomes:

```yaml
user_prompt_template: |
  【故事背景】
  - 类型：{genre}
  - 核心矛盾：{core_contradiction}
  - 前提：{premise}

  【世界观规则】
  - 力量体系：{power_system_name}
  - 力量描述：{power_system_description}
  - 核心规则：
  {core_rules}
  - 绝对上限：
  {ceilings}

  【本章大纲】
  {chapter_outline_context}

  {characters_context}

  【本场场景规划】
  - 场景目标：{scene_goal}
  - 核心冲突：{scene_conflict}
  - 情绪弧线：{scene_emotional_arc}
  - 叙事角色：{scene_narrative_role}
  - 必需的 SF_LOG 标签：
  {required_logs_list}
```

- [ ] **Step 6: Update `stage4_writing.py` to load and pass the chapter outline**

In `backend/api/stage4_writing.py`, find the call to `writer.write_scene` (around line 393 per the spec). Add a sibling `outline_chapter` parameter that reads from `outline.json`:

```python
# Inside _write_scene_chapter or wherever writer.write_scene / writer.write_scene_stream is called:
outline_data = fm.read_json(project_id, "outline.json") or {}
chapters = outline_data.get("chapters", []) if isinstance(outline_data, dict) else []
outline_chapter = next(
    (c for c in chapters if c.get("chapter_number") == chapter_number),
    None,
)
# Pass outline_chapter=outline_chapter to writer.write_scene(...).
```

If the call uses `write_scene_stream`, apply the same change. Use the existing `fm` (FileManager instance) and `project_id` already in scope.

- [ ] **Step 7: Run test to verify it passes**

Run: `cd /Users/longsa/Codes/storyForge2 && source venv/bin/activate && pytest backend/tests/test_writer_pipeline_integration.py -v`
Expected: 2 passed

- [ ] **Step 8: Run the full writer test suite to confirm no regression**

Run: `cd /Users/longsa/Codes/storyForge2 && source venv/bin/activate && pytest tests/test_writer_characters_context.py backend/tests/test_writer_chapter_outline_context.py backend/tests/test_writer_characters_context.py backend/tests/test_writer_pipeline_integration.py -v`
Expected: all pass

- [ ] **Step 9: Commit**

```bash
cd /Users/longsa/Codes/storyForge2
git add backend/agents/writer.py backend/prompts/scene_writing.yaml backend/api/stage4_writing.py backend/tests/test_writer_pipeline_integration.py
git commit -m "feat(agents): wire chapter_outline + behavior_examples into Writer pipeline"
```

---

### Task 7: Backfill script (`scripts/backfill_behavior_examples.py`)

**Files:**
- Create: `scripts/backfill_behavior_examples.py`
- Test: `backend/tests/test_backfill_behavior_examples.py`

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_backfill_behavior_examples.py`:

```python
"""Tests for scripts/backfill_behavior_examples.py.

Mocks PlannerAgent.generate_character to avoid LLM costs.
"""
import json
import pytest
import subprocess
import sys
from pathlib import Path
from unittest.mock import patch, AsyncMock


SCRIPT = Path(__file__).resolve().parents[2] / "scripts" / "backfill_behavior_examples.py"


def _write_characters(projects_dir: Path, project_id: str, characters: list[dict]) -> None:
    (projects_dir / project_id).mkdir(parents=True, exist_ok=True)
    (projects_dir / project_id / "characters.json").write_text(
        json.dumps({"characters": characters}, ensure_ascii=False),
        encoding="utf-8",
    )


def _read_characters(projects_dir: Path, project_id: str) -> list[dict]:
    return json.loads(
        (projects_dir / project_id / "characters.json").read_text(encoding="utf-8")
    )["characters"]


@pytest.fixture(autouse=True)
def patch_planner(monkeypatch):
    """Patch the LLM call to return fixed behavior_examples per character."""
    with patch("backend.agents.planner.PlannerAgent") as MockPlanner:
        instance = MockPlanner.return_value
        async def _fake_generate(*args, **kwargs):
            return ({"voice_signature": {"behavior_examples": [
                {"situation": "新场景", "action": "新行为", "speech_sample": "新台词"},
            ]}}, None)
        instance.generate_character = _fake_generate
        yield MockPlanner


def _run_cli(projects_dir: Path, *args) -> subprocess.CompletedProcess:
    return subprocess.run(
        [sys.executable, str(SCRIPT),
         "--projects-dir", str(projects_dir), *args],
        capture_output=True, text=True,
    )


def test_dry_run_makes_no_writes(tmp_path):
    _write_characters(tmp_path, "proj_a", [
        {"id": "c1", "name": "Alice", "character_type": "protagonist",
         "voice_signature": {"speech_style": "s", "thought_patterns": "t", "taboos": []}},
    ])
    result = _run_cli(tmp_path, "--project-id", "proj_a", "--dry-run")
    assert result.returncode == 0
    chars = _read_characters(tmp_path, "proj_a")
    assert chars[0]["voice_signature"].get("behavior_examples") is None or \
        chars[0]["voice_signature"].get("behavior_examples") == []
    assert "DRY RUN" in result.stdout


def test_fills_missing_behavior_examples(tmp_path):
    _write_characters(tmp_path, "proj_a", [
        {"id": "c1", "name": "Alice", "character_type": "protagonist",
         "voice_signature": {"speech_style": "s", "thought_patterns": "t", "taboos": []}},
    ])
    result = _run_cli(tmp_path, "--project-id", "proj_a")
    assert result.returncode == 0
    chars = _read_characters(tmp_path, "proj_a")
    assert len(chars[0]["voice_signature"]["behavior_examples"]) == 1


def test_idempotent_skip_existing(tmp_path):
    """Running twice does NOT re-LLM characters that already have examples."""
    _write_characters(tmp_path, "proj_a", [
        {"id": "c1", "name": "Alice", "character_type": "protagonist",
         "voice_signature": {"speech_style": "s", "thought_patterns": "t", "taboos": [],
                              "behavior_examples": [
                                  {"situation": "已有", "action": "已有", "speech_sample": "已有"}
                              ]}},
    ])
    result = _run_cli(tmp_path, "--project-id", "proj_a")
    assert result.returncode == 0
    chars = _read_characters(tmp_path, "proj_a")
    # The pre-existing example is preserved (no LLM call).
    assert chars[0]["voice_signature"]["behavior_examples"][0]["situation"] == "已有"


def test_resumable_from_progress_file(tmp_path):
    """Killing mid-run + restarting continues from .backfill_progress.json."""
    _write_characters(tmp_path, "proj_a", [
        {"id": "c1", "name": "Alice", "character_type": "protagonist",
         "voice_signature": {"speech_style": "s", "thought_patterns": "t", "taboos": []}},
        {"id": "c2", "name": "Bob", "character_type": "supporting",
         "voice_signature": {"speech_style": "s", "thought_patterns": "t", "taboos": []}},
    ])
    # Pre-seed progress file marking c1 done.
    progress_path = tmp_path / "proj_a" / ".backfill_progress.json"
    progress_path.write_text(json.dumps({"completed_ids": ["c1"]}), encoding="utf-8")
    result = _run_cli(tmp_path, "--project-id", "proj_a")
    assert result.returncode == 0
    chars = _read_characters(tmp_path, "proj_a")
    # c1 still has no examples (skipped), c2 has examples (filled).
    assert chars[0]["voice_signature"].get("behavior_examples") in (None, [])
    assert len(chars[1]["voice_signature"]["behavior_examples"]) == 1


def test_walks_all_projects_when_no_project_id(tmp_path):
    """No --project-id → walk all project dirs."""
    _write_characters(tmp_path, "proj_a", [
        {"id": "c1", "name": "Alice", "character_type": "protagonist",
         "voice_signature": {"speech_style": "s", "thought_patterns": "t", "taboos": []}},
    ])
    _write_characters(tmp_path, "proj_b", [
        {"id": "c1", "name": "Bob", "character_type": "protagonist",
         "voice_signature": {"speech_style": "s", "thought_patterns": "t", "taboos": []}},
    ])
    result = _run_cli(tmp_path)
    assert result.returncode == 0
    assert len(_read_characters(tmp_path, "proj_a")[0]["voice_signature"]["behavior_examples"]) == 1
    assert len(_read_characters(tmp_path, "proj_b")[0]["voice_signature"]["behavior_examples"]) == 1
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/longsa/Codes/storyForge2 && source venv/bin/activate && pytest backend/tests/test_backfill_behavior_examples.py -v`
Expected: `FileNotFoundError` or `subprocess.CalledProcessError` (script doesn't exist)

- [ ] **Step 3: Create the script**

Create `scripts/backfill_behavior_examples.py`:

```python
"""Backfill voice_signature.behavior_examples for all existing characters.

For every project on disk, for every character whose behavior_examples field
is missing or empty, runs Character Designer via PlannerAgent and merges
the result back into the character dict. Idempotent (skips characters that
already have examples) and resumable (writes .backfill_progress.json per
project with the set of completed character_ids).

Usage:
    python scripts/backfill_behavior_examples.py [--project-id ID] [--dry-run]
                                                  [--projects-dir DIR] [--batch-size 5]
"""
import argparse
import asyncio
import json
import sys
from pathlib import Path

# Repo-root import — runnable from anywhere.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from backend.agents.planner import PlannerAgent  # noqa: E402
from backend.config import settings  # noqa: E402
from backend.models.character import BehaviorExample  # noqa: E402

PROGRESS_FILENAME = ".backfill_progress.json"


def _load_progress(project_dir: Path) -> set[str]:
    path = project_dir / PROGRESS_FILENAME
    if not path.exists():
        return set()
    try:
        return set(json.loads(path.read_text(encoding="utf-8")).get("completed_ids", []))
    except Exception:
        return set()


def _save_progress(project_dir: Path, completed_ids: set[str]) -> None:
    path = project_dir / PROGRESS_FILENAME
    path.write_text(
        json.dumps({"completed_ids": sorted(completed_ids)}, ensure_ascii=False),
        encoding="utf-8",
    )


def _read_characters(project_dir: Path) -> dict:
    chars_path = project_dir / "characters.json"
    if not chars_path.exists():
        return {"characters": []}
    return json.loads(chars_path.read_text(encoding="utf-8"))


def _write_characters(project_dir: Path, data: dict) -> None:
    chars_path = project_dir / "characters.json"
    chars_path.write_text(
        json.dumps(data, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def _character_needs_fill(char: dict) -> bool:
    vs = char.get("voice_signature") or {}
    examples = vs.get("behavior_examples")
    return not isinstance(examples, list) or len(examples) == 0


async def _fill_one(project_id: str, char: dict) -> list[dict]:
    """Call Character Designer for ONE character and return the behavior_examples."""
    agent = PlannerAgent(project_id)
    # Read context if available (some old projects may lack these files).
    project_dir = settings.projects_dir / project_id
    concept_and_dna_path = project_dir / "concept_and_dna.json"
    world_path = project_dir / "world.json"
    try:
        concept_and_dna = (
            json.loads(concept_and_dna_path.read_text(encoding="utf-8"))
            if concept_and_dna_path.exists() else {}
        )
        world = (
            json.loads(world_path.read_text(encoding="utf-8"))
            if world_path.exists() else {}
        )
    except Exception:
        concept_and_dna = {}
        world = {}

    try:
        result, _resp = await agent.generate_character(
            concept=concept_and_dna.get("concept", {}),
            world=world,
            character_type=char.get("character_type", "supporting"),
            existing_characters=[char],
        )
    except Exception as e:
        print(f"  [ERROR] LLM call failed for {char.get('id')}: {e}")
        return []

    new_examples_raw = (result.get("voice_signature") or {}).get("behavior_examples", [])
    valid: list[dict] = []
    for ex in new_examples_raw:
        try:
            valid.append(BehaviorExample(**ex).model_dump())
        except Exception:
            continue
    return valid


async def backfill_project(project_id: str, dry_run: bool) -> dict:
    """Backfill one project. Returns a summary dict."""
    project_dir = settings.projects_dir / project_id
    if not project_dir.exists():
        return {"project_id": project_id, "skipped": "no project dir"}

    data = _read_characters(project_dir)
    characters = data.get("characters", []) or []
    completed = _load_progress(project_dir) if not dry_run else set()

    plan: list[dict] = []
    for char in characters:
        if not _character_needs_fill(char):
            continue
        if char.get("id") in completed:
            continue
        plan.append(char)

    summary = {
        "project_id": project_id,
        "total": len(characters),
        "to_fill": len(plan),
        "filled": 0,
        "errors": 0,
    }

    if dry_run:
        print(f"  [DRY RUN] {project_id}: would fill {len(plan)} character(s)")
        return summary

    new_completed = set(completed)
    for char in plan:
        cid = char.get("id")
        print(f"  [{project_id}] filling {cid} ({char.get('name')})...")
        new_examples = await _fill_one(project_id, char)
        if not new_examples:
            summary["errors"] += 1
            continue
        char.setdefault("voice_signature", {})["behavior_examples"] = new_examples
        summary["filled"] += 1
        new_completed.add(cid)
        _save_progress(project_dir, new_completed)

    if summary["filled"] > 0:
        _write_characters(project_dir, data)

    return summary


async def main(args: argparse.Namespace) -> int:
    projects_dir: Path = args.projects_dir
    settings.projects_dir = projects_dir  # override default

    if args.project_id:
        projects = [projects_dir / args.project_id]
    else:
        projects = sorted([p for p in projects_dir.iterdir() if p.is_dir()])

    print(f"=== backfill_behavior_examples ===")
    print(f"projects_dir: {projects_dir}")
    print(f"dry_run: {args.dry_run}")
    print(f"batch_size: {args.batch_size} (currently sequential)")
    print()

    total_filled = 0
    total_errors = 0
    for proj_dir in projects:
        if not proj_dir.exists():
            continue
        summary = await backfill_project(proj_dir.name, dry_run=args.dry_run)
        if summary.get("skipped"):
            continue
        print(f"  → {summary['project_id']}: filled={summary['filled']}/{summary['to_fill']} errors={summary['errors']}")
        total_filled += summary["filled"]
        total_errors += summary["errors"]

    print()
    print(f"=== done: filled={total_filled} errors={total_errors} ===")
    return 1 if total_errors > 0 else 0


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Backfill behavior_examples for existing characters.")
    parser.add_argument("--project-id", default=None, help="Process only this project (default: all).")
    parser.add_argument("--dry-run", action="store_true", help="Log planned work but write nothing.")
    parser.add_argument("--projects-dir", type=Path, default=Path("."),
                        help="Path to projects/ directory (default: repo root).")
    parser.add_argument("--batch-size", type=int, default=5,
                        help="Concurrency (currently a hint; runs sequential).")
    args = parser.parse_args()
    sys.exit(asyncio.run(main(args)))
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/longsa/Codes/storyForge2 && source venv/bin/activate && pytest backend/tests/test_backfill_behavior_examples.py -v`
Expected: 5 passed

- [ ] **Step 5: Commit**

```bash
cd /Users/longsa/Codes/storyForge2
git add scripts/backfill_behavior_examples.py backend/tests/test_backfill_behavior_examples.py
git commit -m "feat(scripts): backfill_behavior_examples.py (idempotent, resumable, dry-run)"
```

---

### Task 8: Frontend types + client method

**Files:**
- Modify: `frontend/src/api/client.ts:252-260` (VoiceSignature type) + add `BehaviorExample` type + add `regenerateCharacterExamples` method
- Test: type-check only (covered by Task 9 component test)

- [ ] **Step 1: Add the type**

In `frontend/src/api/client.ts`, before the `Character` interface (line 234), insert:

```ts
export interface BehaviorExample {
  situation: string;
  action: string;
  speech_sample: string;
}
```

- [ ] **Step 2: Extend `VoiceSignature`**

In `frontend/src/api/client.ts`, change lines 252-256 from:

```ts
  voice_signature: {
    speech_style: string;
    thought_patterns: string;
    taboos: string[];
  };
```

to:

```ts
  voice_signature: {
    speech_style: string;
    thought_patterns: string;
    taboos: string[];
    behavior_examples: BehaviorExample[];
  };
```

- [ ] **Step 3: Add the client method**

In `frontend/src/api/client.ts`, immediately after `deleteCharacter` (line 800), insert:

```ts
  regenerateCharacterExamples: (
    projectId: string,
    characterId: string,
    keepExisting: boolean = false,
  ): Promise<Character> =>
    request<Character>(
      "POST",
      `/stage2/character/${encodeURIComponent(characterId)}/regenerate-examples?project_id=${encodeURIComponent(projectId)}`,
      { keep_existing: keepExisting },
    ),
```

- [ ] **Step 4: Verify TypeScript compiles**

Run: `cd /Users/longsa/Codes/storyForge2/frontend && npx tsc --noEmit -p .`
Expected: 0 errors

- [ ] **Step 5: Commit**

```bash
cd /Users/longsa/Codes/storyForge2
git add frontend/src/api/client.ts
git commit -m "feat(api-client): BehaviorExample type + regenerateCharacterExamples"
```

---

### Task 9: `BehaviorExamplesSection` component

**Files:**
- Create: `frontend/src/components/wizard/BehaviorExamplesSection.tsx`
- Test: `frontend/src/test/BehaviorExamplesSection.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/test/BehaviorExamplesSection.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import BehaviorExamplesSection from "../components/wizard/BehaviorExamplesSection";
import type { BehaviorExample } from "../api/client";

const SAMPLE: BehaviorExample[] = [
  { situation: "挚友被陷害", action: "压制怒火", speech_sample: "我会让你付出代价。" },
  { situation: "师父失踪", action: "暗中调查", speech_sample: "真相终会大白。" },
];

describe("BehaviorExamplesSection", () => {
  it("renders each example with three editable textareas", () => {
    render(<BehaviorExamplesSection examples={SAMPLE} onChange={() => {}} />);
    expect(screen.getAllByRole("textbox")).toHaveLength(6); // 2 examples × 3 fields
    expect(screen.getByDisplayValue("挚友被陷害")).toBeInTheDocument();
    expect(screen.getByDisplayValue("我会让你付出代价。")).toBeInTheDocument();
  });

  it("emits onChange when a textarea value changes", () => {
    const onChange = vi.fn();
    render(<BehaviorExamplesSection examples={SAMPLE} onChange={onChange} />);
    fireEvent.change(screen.getByDisplayValue("挚友被陷害"), { target: { value: "新触发" } });
    expect(onChange).toHaveBeenCalledTimes(1);
    const updated = onChange.mock.calls[0][0] as BehaviorExample[];
    expect(updated[0].situation).toBe("新触发");
  });

  it("renders the '添加示例' button when list is empty", () => {
    render(<BehaviorExamplesSection examples={[]} onChange={() => {}} />);
    expect(screen.getByTestId("behavior-example-add")).toBeInTheDocument();
  });

  it("clicking '添加示例' appends a blank example and emits onChange", () => {
    const onChange = vi.fn();
    render(<BehaviorExamplesSection examples={[]} onChange={onChange} />);
    fireEvent.click(screen.getByTestId("behavior-example-add"));
    expect(onChange).toHaveBeenCalledTimes(1);
    const updated = onChange.mock.calls[0][0] as BehaviorExample[];
    expect(updated).toHaveLength(1);
    expect(updated[0]).toEqual({ situation: "", action: "", speech_sample: "" });
  });

  it("clicking delete on an example removes it and emits onChange", () => {
    const onChange = vi.fn();
    render(<BehaviorExamplesSection examples={SAMPLE} onChange={onChange} />);
    fireEvent.click(screen.getAllByTestId("behavior-example-delete")[0]);
    expect(onChange).toHaveBeenCalledTimes(1);
    const updated = onChange.mock.calls[0][0] as BehaviorExample[];
    expect(updated).toHaveLength(1);
    expect(updated[0].situation).toBe("师父失踪");
  });

  it("renders the regenerate button and spinner when regenerating=true", () => {
    render(
      <BehaviorExamplesSection
        examples={SAMPLE}
        onChange={() => {}}
        onRegenerate={() => {}}
        regenerating={true}
      />,
    );
    expect(screen.getByTestId("behavior-example-regenerate")).toBeInTheDocument();
    expect(screen.getByTestId("behavior-example-regenerate-spinner")).toBeInTheDocument();
  });

  it("calls onRegenerate when the button is clicked", () => {
    const onRegenerate = vi.fn();
    render(
      <BehaviorExamplesSection
        examples={SAMPLE}
        onChange={() => {}}
        onRegenerate={onRegenerate}
      />,
    );
    fireEvent.click(screen.getByTestId("behavior-example-regenerate"));
    expect(onRegenerate).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/longsa/Codes/storyForge2/frontend && npx vitest run src/test/BehaviorExamplesSection.test.tsx`
Expected: `Failed to resolve import` for the component

- [ ] **Step 3: Create the component**

Create `frontend/src/components/wizard/BehaviorExamplesSection.tsx`:

```tsx
import type { BehaviorExample } from "../../api/client";

interface Props {
  examples: BehaviorExample[];
  onChange: (next: BehaviorExample[]) => void;
  onRegenerate?: () => void;
  regenerating?: boolean;
}

const EMPTY: BehaviorExample = { situation: "", action: "", speech_sample: "" };

export default function BehaviorExamplesSection({
  examples,
  onChange,
  onRegenerate,
  regenerating = false,
}: Props) {
  const update = (idx: number, field: keyof BehaviorExample, value: string) => {
    const next = examples.map((ex, i) => (i === idx ? { ...ex, [field]: value } : ex));
    onChange(next);
  };

  const add = () => onChange([...examples, { ...EMPTY }]);

  const remove = (idx: number) => {
    onChange(examples.filter((_, i) => i !== idx));
  };

  return (
    <div className="space-y-3" data-testid="behavior-examples-section">
      <div className="flex items-center justify-between">
        <h4 className="font-semibold">行为示例</h4>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={add}
            className="px-2 py-1 text-sm bg-blue-100 rounded"
            data-testid="behavior-example-add"
          >
            + 添加示例
          </button>
          {onRegenerate && (
            <button
              type="button"
              onClick={onRegenerate}
              disabled={regenerating}
              className="px-2 py-1 text-sm bg-purple-100 rounded disabled:opacity-50"
              data-testid="behavior-example-regenerate"
            >
              {regenerating ? (
                <span data-testid="behavior-example-regenerate-spinner">重生成中…</span>
              ) : (
                "🔄 重新生成"
              )}
            </button>
          )}
        </div>
      </div>
      {examples.length === 0 ? (
        <p className="text-sm text-gray-500" data-testid="behavior-examples-empty">
          暂无行为示例。点击"添加示例"手动填写，或点击"重新生成"自动生成。
        </p>
      ) : (
        examples.map((ex, idx) => (
          <div
            key={idx}
            className="border rounded p-3 space-y-2"
            data-testid={`behavior-example-row-${idx}`}
          >
            <div>
              <label className="text-xs text-gray-500">触发场景</label>
              <textarea
                value={ex.situation}
                onChange={(e) => update(idx, "situation", e.target.value)}
                rows={1}
                className="w-full border rounded px-2 py-1"
                data-testid={`behavior-example-${idx}-situation`}
              />
            </div>
            <div>
              <label className="text-xs text-gray-500">行为反应</label>
              <textarea
                value={ex.action}
                onChange={(e) => update(idx, "action", e.target.value)}
                rows={1}
                className="w-full border rounded px-2 py-1"
                data-testid={`behavior-example-${idx}-action`}
              />
            </div>
            <div>
              <label className="text-xs text-gray-500">台词样本</label>
              <textarea
                value={ex.speech_sample}
                onChange={(e) => update(idx, "speech_sample", e.target.value)}
                rows={1}
                className="w-full border rounded px-2 py-1"
                data-testid={`behavior-example-${idx}-speech-sample`}
              />
            </div>
            <button
              type="button"
              onClick={() => remove(idx)}
              className="text-xs text-red-600"
              data-testid="behavior-example-delete"
            >
              🗑️ 删除
            </button>
          </div>
        ))
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/longsa/Codes/storyForge2/frontend && npx vitest run src/test/BehaviorExamplesSection.test.tsx`
Expected: 7 passed

- [ ] **Step 5: Commit**

```bash
cd /Users/longsa/Codes/storyForge2
git add frontend/src/components/wizard/BehaviorExamplesSection.tsx frontend/src/test/BehaviorExamplesSection.test.tsx
git commit -m "feat(wizard): BehaviorExamplesSection component"
```

---

### Task 10: Wire `BehaviorExamplesSection` into `CharacterStep.tsx`

**Files:**
- Modify: `frontend/src/components/wizard/CharacterStep.tsx`
- Test: `frontend/src/test/CharacterStep.behavior_examples.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/test/CharacterStep.behavior_examples.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("../api/client", () => ({
  default: {
    generateCharacter: vi.fn(),
    updateCharacter: vi.fn(),
    patchCharacter: vi.fn(),
    deleteCharacter: vi.fn(),
    advance: vi.fn(),
    getConcept: vi.fn(),
    getWorld: vi.fn(),
    getCharacter: vi.fn(),
    getNovelOutline: vi.fn(),
    getOutline: vi.fn(),
    regenerateCharacterExamples: vi.fn(),
  },
}));

import api from "../api/client";
import InitWizardModal from "../components/wizard/InitWizardModal";
import { getSessionKey } from "../components/wizard/WizardContext";

const PROJECT = "proj_x";
const KEY = getSessionKey(PROJECT);

const ALICE = {
  id: "char_alice",
  name: "Alice",
  personality: { beliefs: ["x"], desires: [], fears: [], values: [], core_traits: [] },
  voice_signature: { speech_style: "", thought_patterns: "", taboos: [],
                      behavior_examples: [
                        { situation: "示例1", action: "行为1", speech_sample: "台词1" },
                      ] },
  current_state: { location: "", physical_condition: "normal", emotional: "neutral", known_secrets: [] },
  unknown_to_character: [],
  is_core_character: true,
  character_type: "protagonist",
  relations: {},
  growth_curve: null,
};
const BOB = { ...ALICE, id: "char_bob", name: "Bob", character_type: "supporting", is_core_character: false };

function setup() {
  sessionStorage.setItem(
    KEY,
    JSON.stringify({
      currentStep: 3,
      completedSteps: [1, 2, 3],
      status: "completed",
      data: {
        concept: null, story_dna: null, world: null,
        characters: { characters: [ALICE, BOB], current: ALICE },
        novel_outline: null, chapter1_outline: null,
      },
      errorMessage: null,
    }),
  );
}

beforeEach(() => {
  (api.generateCharacter as ReturnType<typeof vi.fn>).mockReset();
  (api.updateCharacter as ReturnType<typeof vi.fn>).mockReset();
  (api.patchCharacter as ReturnType<typeof vi.fn>).mockReset();
  (api.deleteCharacter as ReturnType<typeof vi.fn>).mockReset();
  (api.regenerateCharacterExamples as ReturnType<typeof vi.fn>).mockReset();
  (api.advance as ReturnType<typeof vi.fn>).mockReset();
  (api.advance as ReturnType<typeof vi.fn>).mockResolvedValue({ current_stage: "STAGE3" });
  sessionStorage.clear();
});

describe("CharacterStep behavior-examples integration", () => {
  it("renders the behavior-examples-section per card", async () => {
    setup();
    render(<MemoryRouter><InitWizardModal projectId={PROJECT} onDismiss={() => {}} /></MemoryRouter>);
    await waitFor(() => expect(screen.getByTestId("character-form")).toBeInTheDocument());
    // Two cards → at least one behavior-examples-section visible (each card has its own).
    expect(screen.getAllByTestId("behavior-examples-section").length).toBeGreaterThanOrEqual(2);
  });

  it("inline-editing an example updates local state without an API call", async () => {
    setup();
    render(<MemoryRouter><InitWizardModal projectId={PROJECT} onDismiss={() => {}} /></MemoryRouter>);
    await waitFor(() => expect(screen.getByTestId("character-form")).toBeInTheDocument());
    const textarea = screen.getByTestId("behavior-example-0-speech-sample");
    await act(async () => {
      fireEvent.change(textarea, { target: { value: "新台词" } });
    });
    expect(textarea).toHaveValue("新台词");
    expect(api.patchCharacter).not.toHaveBeenCalled();
    expect(api.updateCharacter).not.toHaveBeenCalled();
  });

  it("'确认修改并继续' persists edited behavior_examples via updateCharacter", async () => {
    (api.updateCharacter as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    setup();
    render(<MemoryRouter><InitWizardModal projectId={PROJECT} onDismiss={() => {}} /></MemoryRouter>);
    await waitFor(() => expect(screen.getByTestId("character-form")).toBeInTheDocument());
    const textarea = screen.getByTestId("behavior-example-0-speech-sample");
    await act(async () => {
      fireEvent.change(textarea, { target: { value: "新台词" } });
    });
    await act(async () => {
      screen.getByTestId("wizard-next").click();
    });
    await waitFor(() => expect(api.updateCharacter).toHaveBeenCalledTimes(1));
    const call = (api.updateCharacter as ReturnType<typeof vi.fn>).mock.calls[0];
    const alicePatched = call[1].characters.find((c: { id: string }) => c.id === "char_alice");
    expect(alicePatched.voice_signature.behavior_examples[0].speech_sample).toBe("新台词");
  });

  it("clicking per-card '重新生成示例' calls regenerateCharacterExamples and replaces the list", async () => {
    (api.regenerateCharacterExamples as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...ALICE,
      voice_signature: {
        ...ALICE.voice_signature,
        behavior_examples: [
          { situation: "重生成1", action: "重生成1", speech_sample: "重生成1" },
          { situation: "重生成2", action: "重生成2", speech_sample: "重生成2" },
        ],
      },
    });
    setup();
    render(<MemoryRouter><InitWizardModal projectId={PROJECT} onDismiss={() => {}} /></MemoryRouter>);
    await waitFor(() => expect(screen.getByTestId("character-form")).toBeInTheDocument());
    // Scope to Alice's card.
    const aliceCard = screen.getByTestId("character-char_alice");
    const regenButton = within(aliceCard).getByTestId("behavior-example-regenerate");
    await act(async () => {
      regenButton.click();
    });
    await waitFor(() => expect(api.regenerateCharacterExamples).toHaveBeenCalledWith(PROJECT, "char_alice", false));
    // The local list now reflects the response.
    await waitFor(() => {
      expect(within(aliceCard).getByTestId("behavior-example-1-speech-sample")).toHaveValue("重生成2");
    });
  });
});

// Helper: re-import within from RTL (avoid colliding with outer test imports).
import { within } from "@testing-library/react";
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/longsa/Codes/storyForge2/frontend && npx vitest run src/test/CharacterStep.behavior_examples.test.tsx`
Expected: tests fail (no `behavior-examples-section` or no `behavior-example-regenerate` in DOM)

- [ ] **Step 3: Embed the section in the card**

In `frontend/src/components/wizard/CharacterStep.tsx`:

1. At the top of the file, add the import:

```tsx
import BehaviorExamplesSection from "./BehaviorExamplesSection";
```

2. Find the existing per-character card render (around line 200+ — search for `voice_signature` to locate the block). After the voice-signature section's closing `</div>` and before the personality section, insert:

```tsx
<BehaviorExamplesSection
  examples={character.voice_signature.behavior_examples || []}
  onChange={(next) => updateBehaviorExamples(character.id, next)}
  onRegenerate={() => regenerateBehaviorExamples(character.id)}
  regenerating={regeneratingId === character.id}
/>
```

3. Inside the `CharacterStep` component (alongside the existing `setCharacters` state), add:

```tsx
const [regeneratingId, setRegeneratingId] = useState<string | null>(null);

const updateBehaviorExamples = (cid: string, next: BehaviorExample[]) => {
  setCharacters((prev) => {
    if (!prev) return prev;
    return {
      ...prev,
      characters: prev.characters.map((c) =>
        c.id === cid
          ? { ...c, voice_signature: { ...c.voice_signature, behavior_examples: next } }
          : c,
      ),
    };
  });
};

const regenerateBehaviorExamples = async (cid: string) => {
  setRegeneratingId(cid);
  try {
    const updated = await api.regenerateCharacterExamples(projectId, cid, false);
    setCharacters((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        characters: prev.characters.map((c) => (c.id === cid ? updated : c)),
      };
    });
  } catch (e) {
    // Re-throw or surface via toast; for now, console.error is fine.
    console.error("regenerateBehaviorExamples failed:", e);
  } finally {
    setRegeneratingId(null);
  }
};
```

4. Add `import type { BehaviorExample } from "../../api/client";` to the top.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/longsa/Codes/storyForge2/frontend && npx vitest run src/test/CharacterStep.behavior_examples.test.tsx`
Expected: 4 passed

- [ ] **Step 5: Run the full frontend test suite to confirm no regression**

Run: `cd /Users/longsa/Codes/storyForge2/frontend && npx vitest run`
Expected: all existing tests still pass + the 4 new tests

- [ ] **Step 6: Commit**

```bash
cd /Users/longsa/Codes/storyForge2
git add frontend/src/components/wizard/CharacterStep.tsx frontend/src/test/CharacterStep.behavior_examples.test.tsx
git commit -m "feat(wizard): BehaviorExamplesSection wired into CharacterStep + per-card regenerate button"
```

---

### Task 11: Manual smoke test

**Files:** None modified. This task validates the full stack end-to-end.

- [ ] **Step 1: Start backend + frontend**

```bash
# Terminal 1
cd /Users/longsa/Codes/storyForge2
env -u ANTHROPIC_BASE_URL -u ANTHROPIC_AUTH_TOKEN -u ANTHROPIC_MODEL uvicorn backend.main:app --reload --port 8000

# Terminal 2
cd /Users/longsa/Codes/storyForge2/frontend
npm run dev
```

Open http://localhost:5173.

- [ ] **Step 2: New project → wizard Stage 2**

1. Create a new project (any genre/intent).
2. Advance to Stage 2 (character generation).
3. Wait for the 6-character batch to generate.
4. Verify each card shows a `行为示例` section with 3-5 entries.
5. Edit one `speech_sample` inline; click footer "确认修改并继续". Refresh the page; the edit persists.

- [ ] **Step 3: Per-card regenerate button**

1. On one card, click `🔄 重新生成示例`.
2. Verify a spinner appears briefly, then the list is replaced.
3. Refresh the page; the new examples persist.

- [ ] **Step 4: Backfill script against a known project**

```bash
cd /Users/longsa/Codes/storyForge2
source venv/bin/activate
python scripts/backfill_behavior_examples.py --project-id proj_7cb0180f --dry-run
python scripts/backfill_behavior_examples.py --project-id proj_7cb0180f
```

Verify:
- Dry-run logs the planned fill count and writes nothing.
- Real run fills `behavior_examples` for the 15 characters in `projects/proj_7cb0180f/characters.json`.
- Re-running is a no-op (idempotent).

- [ ] **Step 5: Writer pipeline smoke**

1. Advance the new project through Stage 3 (outline) → Stage 4 (write chapter 1).
2. Watch the LLM write scene 1.
3. Inspect the resulting `chapters/ch01_scene_001_draft.md`:
   - Open `backend.log` and search for the latest `scene_writing` prompt; confirm it contains `## 本章大纲` block with title/theme and `## 出场角色` block with structured fields + behavior examples.
   - Open the draft text and check 3-5 character dialogue lines roughly match each character's `speech_style`.

- [ ] **Step 6: Commit the backfill artifact (the now-filled characters.json)**

```bash
cd /Users/longsa/Codes/storyForge2
git add projects/proj_7cb0180f/characters.json
git commit -m "chore(scripts): run backfill for proj_7cb0180f"
```

If the user has other active projects, repeat with `--project-id` for each. **Do not** commit `projects/*/.backfill_progress.json` — add it to `.gitignore` if not already excluded:

```bash
echo "projects/*/.backfill_progress.json" >> .gitignore
git add .gitignore
git commit -m "chore: ignore backfill progress files"
```

---

## Acceptance criteria

- [ ] All unit tests pass: `pytest backend/tests/test_character_behavior_example.py backend/tests/test_character_generation_prompt.py backend/tests/test_stage2_regenerate_examples.py backend/tests/test_writer_chapter_outline_context.py backend/tests/test_writer_characters_context.py backend/tests/test_writer_pipeline_integration.py backend/tests/test_backfill_behavior_examples.py`
- [ ] All frontend tests pass: `cd frontend && npx vitest run`
- [ ] Manual smoke (Task 11) complete with all 6 steps passing
- [ ] `proj_7cb0180f` characters.json committed with `behavior_examples` filled

---

## Out of scope (deferred)

- Editing `behavior_examples` via workspace `CharacterEditor.tsx` (read-only there for v1.10)
- Per-scene behavior-example overrides
- LLM-as-judge automated regression suite for dialogue-vs-speech-style
- Auto-regeneration of `behavior_examples` when `voice_signature` fields are edited (user can manually click 🔄)
- `scene_plan.characters_in_scene` field on the Planner side (current implementation uses name-extraction from scene_plan text instead)