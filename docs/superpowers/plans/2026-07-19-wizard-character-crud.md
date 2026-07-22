# Wizard + Workspace Character Edit/Delete Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add inline edit + delete to the Stage 2 wizard character cards and `+ 新建角色` / delete to the workspace CharacterEditor, backed by two new REST endpoints (`PATCH` / `DELETE /stage2/character/{cid}`) that keep `projects/{id}/characters.json` consistent with bidirectional relation cleanup on delete.

**Architecture:** Backend adds `CharacterPatch` Pydantic model + two thin handlers that read-modify-write `characters.json` via the existing atomic `FileManager.write_json`. Frontend extracts a shared `CharacterEditForm` component (used by both wizard and workspace) plus a `CharacterRelationsEditor` sub-component for the relations dict. Save semantics: field-blur → debounced 500ms → PATCH. Delete: confirmation modal → DELETE → local state removal. "重新生成" gets a confirmation modal wrapper.

**Tech Stack:** Python 3.9 + FastAPI + pytest, React 18 + TypeScript + Vite + Vitest + React Testing Library. Existing `FileManager.write_json` (atomic tmp-file replace). No new shared dependencies.

**Reference spec:** `docs/superpowers/specs/2026-07-19-wizard-character-crud-design.md`

---

## File structure

**New files:**
- `tests/test_stage2_character_crud.py` — backend endpoint tests (PATCH + DELETE + cascade)
- `frontend/src/components/wizard/CharacterEditForm.tsx` — shared inline-edit form
- `frontend/src/components/wizard/CharacterRelationsEditor.tsx` — relations sub-form
- `frontend/src/test/CharacterEditForm.test.tsx` — form unit tests
- `frontend/src/test/CharacterStep.edit_delete.test.tsx` — wizard integration tests (kept separate from existing `CharacterStep.test.tsx` to avoid touching the 1k+ line existing file)

**Modified — backend:**
- `backend/models/character.py` — add `CharacterPatch`
- `backend/api/stage2_world_char.py` — add `PATCH` and `DELETE` handlers + 404 envelope

**Modified — frontend:**
- `frontend/src/api/client.ts` — add `patchCharacter` and `deleteCharacter` methods
- `frontend/src/components/wizard/CharacterStep.tsx` — inline edit mode + delete + regenerate confirmation
- `frontend/src/components/workspace/editors/CharacterEditor.tsx` — add `+ 新建角色` + per-card 🗑️; remove old boundary comments

---

## Task 1: Backend `CharacterPatch` model + PATCH endpoint

**Files:**
- Modify: `backend/models/character.py:1-87` (append `CharacterPatch`)
- Modify: `backend/api/stage2_world_char.py:1-13` (imports) and after line 272 (append PATCH handler)
- Test: `tests/test_stage2_character_crud.py` (new file)

- [ ] **Step 1: Write failing tests for PATCH**

Create `tests/test_stage2_character_crud.py` with this content:

```python
"""Tests for PATCH/DELETE /stage2/character/{cid} — partial update + delete with
bidirectional relation cleanup. Backbone of wizard character edit/delete."""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from backend.main import app
from backend.config import settings
from backend.utils.file_manager import FileManager


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture
def project_with_characters(tmp_path, monkeypatch):
    """Create a project with two characters (one with a relation pointing at the other)."""
    monkeypatch.setattr(settings, "projects_dir", tmp_path)
    fm = FileManager(tmp_path)
    pid = "test_proj"
    fm.ensure_project_dir(pid)
    fm.write_json(pid, "characters.json", {
        "characters": [
            {
                "id": "char_alice",
                "name": "Alice",
                "personality": {"beliefs": ["x"], "desires": [], "fears": [], "values": [], "core_traits": []},
                "voice_signature": {"speech_style": "", "thought_patterns": "", "taboos": []},
                "current_state": {"location": "", "physical_condition": "normal", "emotional": "neutral", "known_secrets": []},
                "unknown_to_character": [],
                "is_core_character": True,
                "character_type": "protagonist",
                "relations": {"char_bob": {"status": "ally", "history": [], "last_update_chapter": 0}},
            },
            {
                "id": "char_bob",
                "name": "Bob",
                "personality": {"beliefs": [], "desires": [], "fears": [], "values": [], "core_traits": []},
                "voice_signature": {"speech_style": "", "thought_patterns": "", "taboos": []},
                "current_state": {"location": "", "physical_condition": "normal", "emotional": "neutral", "known_secrets": []},
                "unknown_to_character": [],
                "is_core_character": False,
                "character_type": "supporting",
                "relations": {},
            },
        ],
    })
    return pid, fm


def test_patch_single_field_updates_only_that_field(client, project_with_characters):
    pid, _ = project_with_characters
    r = client.patch(f"/api/stage2/character/char_alice?project_id={pid}", json={"name": "Alicia"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["detail"]["name"] == "Alicia"
    assert body["detail"]["id"] == "char_alice"
    # Other fields preserved
    assert body["detail"]["character_type"] == "protagonist"
    assert body["detail"]["is_core_character"] is True


def test_patch_nested_field_merges_into_personality(client, project_with_characters):
    pid, _ = project_with_characters
    r = client.patch(f"/api/stage2/character/char_alice?project_id={pid}",
                     json={"personality": {"beliefs": ["new"], "core_traits": ["brave"]}})
    assert r.status_code == 200, r.text
    body = r.json()
    # Both old + new personality fields coexist
    p = body["detail"]["personality"]
    assert "new" in p["beliefs"]
    assert "brave" in p["core_traits"]
    assert p["desires"] == []  # untouched


def test_patch_unknown_id_returns_404(client, project_with_characters):
    pid, _ = project_with_characters
    r = client.patch(f"/api/stage2/character/no_such?project_id={pid}", json={"name": "x"})
    assert r.status_code == 404
    body = r.json()
    assert body["detail"]["code"] == "NOT_FOUND"


def test_patch_invalid_character_type_returns_422(client, project_with_characters):
    pid, _ = project_with_characters
    r = client.patch(f"/api/stage2/character/char_alice?project_id={pid}",
                     json={"character_type": "bogus"})
    assert r.status_code == 422


def test_delete_removes_character_from_file(client, project_with_characters):
    pid, fm = project_with_characters
    r = client.delete(f"/api/stage2/character/char_bob?project_id={pid}")
    assert r.status_code == 200
    assert r.json()["detail"]["deleted_id"] == "char_bob"
    # File on disk no longer contains char_bob
    on_disk = fm.read_json(pid, "characters.json")
    assert on_disk is not None
    ids = [c["id"] for c in on_disk["characters"]]
    assert "char_bob" not in ids
    assert "char_alice" in ids


def test_delete_cascades_inbound_relations(client, project_with_characters):
    pid, fm = project_with_characters
    # alice has a relation pointing at bob; delete bob
    r = client.delete(f"/api/stage2/character/char_bob?project_id={pid}")
    assert r.status_code == 200
    assert r.json()["detail"]["cascaded_relation_removals"] == 1
    on_disk = fm.read_json(pid, "characters.json")
    alice = next(c for c in on_disk["characters"] if c["id"] == "char_alice")
    assert "char_bob" not in alice["relations"]


def test_delete_no_cascade_when_no_inbound_relations(client, project_with_characters):
    pid, _ = project_with_characters
    # alice has a relation pointing at bob, but bob has none inbound.
    # Delete alice: alice's outgoing relations to bob are dropped (counted as cascade)
    # — but the test asserts alice with NO relations → 0 cascade
    # Actually alice DOES have a relation to bob; reverse: deleting bob → 1 cascade
    # To test 0 cascade we need a character with no inbound. Use a third character.
    fm = FileManager(settings.projects_dir)
    fm.write_json(pid, "characters.json", {
        "characters": [
            {"id": "lonely", "name": "Lonely", "personality": {"beliefs": [], "desires": [], "fears": [], "values": [], "core_traits": []},
             "voice_signature": {"speech_style": "", "thought_patterns": "", "taboos": []},
             "current_state": {"location": "", "physical_condition": "normal", "emotional": "neutral", "known_secrets": []},
             "unknown_to_character": [], "is_core_character": False, "character_type": "supporting", "relations": {}},
        ],
    })
    r = client.delete(f"/api/stage2/character/lonely?project_id={pid}")
    assert r.status_code == 200
    assert r.json()["detail"]["cascaded_relation_removals"] == 0


def test_delete_unknown_id_returns_404(client, project_with_characters):
    pid, _ = project_with_characters
    r = client.delete(f"/api/stage2/character/no_such?project_id={pid}")
    assert r.status_code == 404
    assert r.json()["detail"]["code"] == "NOT_FOUND"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/longsa/Codes/storyForge2 && source venv/bin/activate && pytest tests/test_stage2_character_crud.py -v`
Expected: all 8 tests fail with `405 Method Not Allowed` (PATCH/DELETE not registered) or `404 Not Found`.

- [ ] **Step 3: Add `CharacterPatch` model**

In `backend/models/character.py`, append after the existing `CharacterSet` class (line 87):

```python
from typing import Optional  # already imported above, no change needed


class CharacterPatch(BaseModel):
    """Partial-update payload for PATCH /stage2/character/{cid}.
    All fields optional; only those present are written to disk."""
    name: Optional[str] = None
    character_type: Optional[str] = None
    is_core_character: Optional[bool] = None
    personality: Optional[Personality] = None
    voice_signature: Optional[VoiceSignature] = None
    current_state: Optional[CharacterCurrentState] = None
    unknown_to_character: Optional[list[str]] = None
    relations: Optional[dict[str, RelationStatus]] = None
```

- [ ] **Step 4: Implement PATCH handler**

In `backend/api/stage2_world_char.py`, add the `CharacterPatch` import at the top:

```python
from backend.models.character import Character as CharacterModel, CharacterPatch
```

Then append two new handlers after the existing `update_character` function (after line 272):

```python
_NOT_FOUND = lambda msg: HTTPException(  # noqa: E731
    status_code=404,
    detail={"error": True, "code": "NOT_FOUND", "message": msg, "detail": {}},
)


@router.patch("/character/{character_id}")
async def patch_character(character_id: str, project_id: str = Query(...), payload: CharacterPatch = None):
    """Partial-update one character. Only fields present in `payload` are written;
    other fields are preserved. Returns the updated character dict."""
    if not project_id:
        raise HTTPException(
            status_code=400,
            detail={"error": True, "code": "VALIDATION_ERROR", "message": "project_id 不能为空", "detail": {}},
        )
    if payload is None:
        raise HTTPException(
            status_code=400,
            detail={"error": True, "code": "VALIDATION_ERROR", "message": "请求体不能为空", "detail": {}},
        )

    data = fm.read_json(project_id, "characters.json") or {}
    characters = data.get("characters", [])
    target = next((c for c in characters if c.get("id") == character_id), None)
    if target is None:
        raise _NOT_FOUND(f"角色不存在: {character_id}")

    # Merge payload fields (only those not None). Nested dicts replace wholesale —
    # acceptable since the front-end always sends the full nested object.
    patch_dict = payload.model_dump(exclude_none=True)
    for key, value in patch_dict.items():
        target[key] = value

    fm.write_json(project_id, "characters.json", data)

    return {
        "error": False,
        "code": "OK",
        "message": "角色已更新",
        "detail": target,
    }


@router.delete("/character/{character_id}")
async def delete_character(character_id: str, project_id: str = Query(...)):
    """Delete one character and clean up inbound `relations` references in
    every other character. Returns `cascaded_relation_removals` count."""
    if not project_id:
        raise HTTPException(
            status_code=400,
            detail={"error": True, "code": "VALIDATION_ERROR", "message": "project_id 不能为空", "detail": {}},
        )

    data = fm.read_json(project_id, "characters.json") or {}
    characters = data.get("characters", [])
    target_idx = next(
        (i for i, c in enumerate(characters) if c.get("id") == character_id),
        None,
    )
    if target_idx is None:
        raise _NOT_FOUND(f"角色不存在: {character_id}")

    # Cascade: remove character_id from every other character's relations dict.
    cascaded = 0
    for c in characters:
        if c.get("id") == character_id:
            continue
        relations = c.get("relations") or {}
        if character_id in relations:
            del relations[character_id]
            c["relations"] = relations
            cascaded += 1

    characters.pop(target_idx)
    data["characters"] = characters
    fm.write_json(project_id, "characters.json", data)

    return {
        "error": False,
        "code": "OK",
        "message": "角色已删除",
        "detail": {"deleted_id": character_id, "cascaded_relation_removals": cascaded},
    }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd /Users/longsa/Codes/storyForge2 && source venv/bin/activate && pytest tests/test_stage2_character_crud.py -v`
Expected: all 8 tests pass.

- [ ] **Step 6: Commit**

```bash
cd /Users/longsa/Codes/storyForge2
git add backend/models/character.py backend/api/stage2_world_char.py tests/test_stage2_character_crud.py
git commit -m "feat(api): PATCH/DELETE /stage2/character/{cid} with relation cascade"
```

---

## Task 2: API client methods `patchCharacter` + `deleteCharacter`

**Files:**
- Modify: `frontend/src/api/client.ts:759-772` (after `updateCharacter`)

- [ ] **Step 1: Add the two client methods**

In `frontend/src/api/client.ts`, immediately after the existing `updateCharacter` method (after line 772), insert:

```typescript
  patchCharacter: (
    projectId: string,
    characterId: string,
    patch: Partial<Character>,
  ): Promise<Character> =>
    request<Character>(
      "PATCH",
      `/stage2/character/${encodeURIComponent(characterId)}?project_id=${encodeURIComponent(projectId)}`,
      patch,
    ),

  deleteCharacter: (
    projectId: string,
    characterId: string,
  ): Promise<{ deleted_id: string; cascaded_relation_removals: number }> =>
    request<{ deleted_id: string; cascaded_relation_removals: number }>(
      "DELETE",
      `/stage2/character/${encodeURIComponent(characterId)}?project_id=${encodeURIComponent(projectId)}`,
    ),
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd /Users/longsa/Codes/storyForge2/frontend && npx tsc --noEmit 2>&1 | head -30`
Expected: no errors related to `client.ts`. (Other pre-existing errors in the repo are OK.)

- [ ] **Step 3: Commit**

```bash
cd /Users/longsa/Codes/storyForge2
git add frontend/src/api/client.ts
git commit -m "feat(api-client): patchCharacter + deleteCharacter"
```

---

## Task 3: Shared `CharacterEditForm` component

**Files:**
- Create: `frontend/src/components/wizard/CharacterEditForm.tsx`
- Test: `frontend/src/test/CharacterEditForm.test.tsx`

- [ ] **Step 1: Write failing test for chip-array add/remove**

Create `frontend/src/test/CharacterEditForm.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("../api/client", () => ({
  default: {
    patchCharacter: vi.fn(),
  },
}));

import api from "../api/client";
import CharacterEditForm from "../components/wizard/CharacterEditForm";

const ALICE = {
  id: "char_alice",
  name: "Alice",
  personality: {
    beliefs: ["honor"],
    desires: ["truth"],
    fears: ["loss"],
    values: ["justice"],
    core_traits: ["brave"],
  },
  voice_signature: { speech_style: "calm", thought_patterns: "observes", taboos: ["lie"] },
  current_state: { location: "tavern", physical_condition: "normal", emotional: "neutral", known_secrets: [] },
  unknown_to_character: ["secret_x"],
  is_core_character: true,
  character_type: "protagonist",
  relations: {},
};

beforeEach(() => {
  (api.patchCharacter as ReturnType<typeof vi.fn>).mockReset();
  (api.patchCharacter as ReturnType<typeof vi.fn>).mockResolvedValue(ALICE);
});

describe("CharacterEditForm", () => {
  it("renders all sections with current values", () => {
    render(
      <MemoryRouter>
        <CharacterEditForm
          projectId="p1"
          character={ALICE}
          allCharacters={[ALICE]}
          onComplete={vi.fn()}
          onCancel={vi.fn()}
        />
      </MemoryRouter>,
    );
    expect(screen.getByDisplayValue("Alice")).toBeInTheDocument();
    expect(screen.getByDisplayValue("honor")).toBeInTheDocument();
    expect(screen.getByDisplayValue("calm")).toBeInTheDocument();
  });

  it("fires patchCharacter on name blur with new value", async () => {
    render(
      <MemoryRouter>
        <CharacterEditForm projectId="p1" character={ALICE} allCharacters={[ALICE]} onComplete={vi.fn()} onCancel={vi.fn()} />
      </MemoryRouter>,
    );
    const input = screen.getByDisplayValue("Alice");
    fireEvent.change(input, { target: { value: "Alicia" } });
    fireEvent.blur(input);
    await waitFor(() => {
      expect(api.patchCharacter).toHaveBeenCalledWith("p1", "char_alice", expect.objectContaining({ name: "Alicia" }));
    });
  });

  it("adds a chip on Enter in a chip-array input", async () => {
    render(
      <MemoryRouter>
        <CharacterEditForm projectId="p1" character={ALICE} allCharacters={[ALICE]} onComplete={vi.fn()} onCancel={vi.fn()} />
      </MemoryRouter>,
    );
    // beliefs chip input — first textbox after the beliefs label
    const beliefsInput = screen.getByPlaceholderText(/信念/);
    fireEvent.change(beliefsInput, { target: { value: "new_belief" } });
    fireEvent.keyDown(beliefsInput, { key: "Enter", code: "Enter" });
    await waitFor(() => {
      expect(api.patchCharacter).toHaveBeenCalledWith(
        "p1",
        "char_alice",
        expect.objectContaining({ personality: expect.objectContaining({ beliefs: expect.arrayContaining(["new_belief"]) }) }),
      );
    });
  });

  it("shows error badge when patchCharacter rejects", async () => {
    (api.patchCharacter as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("网络错误"));
    render(
      <MemoryRouter>
        <CharacterEditForm projectId="p1" character={ALICE} allCharacters={[ALICE]} onComplete={vi.fn()} onCancel={vi.fn()} />
      </MemoryRouter>,
    );
    const input = screen.getByDisplayValue("Alice");
    fireEvent.change(input, { target: { value: "X" } });
    fireEvent.blur(input);
    await waitFor(() => {
      expect(screen.getByText(/保存失败/)).toBeInTheDocument();
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/longsa/Codes/storyForge2/frontend && npx vitest run src/test/CharacterEditForm.test.tsx`
Expected: FAIL with "Cannot find module '../components/wizard/CharacterEditForm'".

- [ ] **Step 3: Implement `CharacterEditForm`**

Create `frontend/src/components/wizard/CharacterEditForm.tsx`:

```tsx
import { useEffect, useRef, useState } from "react";
import api, { Character } from "../../api/client";
import CharacterRelationsEditor from "./CharacterRelationsEditor";

interface Props {
  projectId: string;
  character: Character;
  allCharacters: Character[];
  onComplete: (updated: Character) => void;
  onCancel: (discarded: boolean) => void;
}

const ROLE_LABELS: Record<Character["character_type"], string> = {
  protagonist: "主角",
  antagonist: "反派",
  supporting: "配角",
  mentor: "导师",
};

type SaveStatus = "idle" | "saving" | "error";

const debounce = (ms: number) => {
  let t: ReturnType<typeof setTimeout> | null = null;
  return (fn: () => void) => {
    if (t) clearTimeout(t);
    t = setTimeout(fn, ms);
  };
};

export default function CharacterEditForm({ projectId, character, allCharacters, onComplete, onCancel }: Props) {
  const [local, setLocal] = useState<Character>(character);
  const [status, setStatus] = useState<SaveStatus>("idle");
  const dirtyRef = useRef(false);
  const debouncedRef = useRef(debounce(500));
  // Reset local copy if the parent passes a different character (e.g., sibling edit).
  useEffect(() => { setLocal(character); }, [character.id]);

  const patchField = async (patch: Partial<Character>) => {
    dirtyRef.current = true;
    setStatus("saving");
    try {
      const updated = await api.patchCharacter(projectId, character.id, patch);
      setLocal((prev) => ({ ...prev, ...updated }));
      setStatus("idle");
    } catch {
      setStatus("error");
    }
  };

  const queuePatch = (patch: Partial<Character>) => {
    setLocal((prev) => ({ ...prev, ...patch }));
    debouncedRef.current(() => { void patchField(patch); });
  };

  const handleBlurField = <K extends keyof Character>(key: K, value: Character[K]) => {
    if (local[key] === value) return;
    queuePatch({ [key]: value } as Partial<Character>);
  };

  const handleBlurNested = (patch: Partial<Character>) => {
    queuePatch(patch);
  };

  const handleCancel = () => {
    if (dirtyRef.current) {
      const ok = window.confirm("丢弃未保存的修改？");
      if (!ok) return;
    }
    onCancel(true);
  };

  // Chip-array helpers — used for all 5 personality + taboos + unknown + known_secrets
  const ChipArray = ({
    label,
    arr,
    onChange,
    placeholder,
  }: {
    label: string;
    arr: string[];
    onChange: (next: string[]) => void;
    placeholder?: string;
  }) => {
    const [draft, setDraft] = useState("");
    return (
      <div>
        <label className="block font-label-mono text-system-log/80 mb-1 text-[10px]">{label}</label>
        <div className="flex flex-wrap gap-1 mb-1">
          {arr.map((chip, i) => (
            <span
              key={i}
              className="inline-flex items-center gap-1 px-2 py-0.5 bg-surface-container-low rounded text-[11px] font-body-narrative text-primary"
            >
              {chip}
              <button
                type="button"
                onClick={() => onChange(arr.filter((_, j) => j !== i))}
                className="text-system-log/60 hover:text-error"
                aria-label="删除"
              >×</button>
            </span>
          ))}
        </div>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && draft.trim()) {
              e.preventDefault();
              onChange([...arr, draft.trim()]);
              setDraft("");
            }
          }}
          placeholder={placeholder ?? "回车添加"}
          className="w-full bg-surface-container border border-outline-variant rounded px-2 py-1 text-xs text-primary focus:outline-none focus:border-primary-container"
        />
      </div>
    );
  };

  return (
    <div data-testid={`character-${character.id}-edit-form`} className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="font-label-mono text-system-log text-[10px]">
          {status === "saving" && "保存中…"}
          {status === "idle" && dirtyRef.current && "已同步"}
          {status === "error" && <span className="text-error">保存失败 (重试请再次编辑)</span>}
        </div>
      </div>

      {/* 基础信息 */}
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="block font-label-mono text-system-log mb-1 text-xs">姓名</label>
          <input
            data-testid={`character-${character.id}-name`}
            value={local.name}
            onChange={(e) => setLocal({ ...local, name: e.target.value })}
            onBlur={(e) => handleBlurField("name", e.target.value)}
            className="w-full bg-surface-container border border-outline-variant rounded px-2 py-1 text-xs text-primary focus:outline-none focus:border-primary-container"
          />
        </div>
        <div>
          <label className="block font-label-mono text-system-log mb-1 text-xs">角色类型</label>
          <select
            data-testid={`character-${character.id}-type`}
            value={local.character_type}
            onChange={(e) => {
              const v = e.target.value as Character["character_type"];
              setLocal({ ...local, character_type: v });
              handleBlurField("character_type", v);
            }}
            className="w-full bg-surface-container border border-outline-variant rounded px-2 py-1 text-xs text-primary focus:outline-none focus:border-primary-container"
          >
            {Object.entries(ROLE_LABELS).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </div>
      </div>
      <label className="flex items-center gap-2 font-body-ui text-xs text-primary">
        <input
          type="checkbox"
          checked={local.is_core_character}
          onChange={(e) => {
            setLocal({ ...local, is_core_character: e.target.checked });
            handleBlurField("is_core_character", e.target.checked);
          }}
        />
        核心角色
      </label>

      {/* 人格层 */}
      <div className="space-y-1">
        <div className="font-label-mono text-system-log text-[10px] uppercase tracking-wider">人格层</div>
        <div className="grid grid-cols-2 gap-2">
          {(["beliefs", "desires", "fears", "values", "core_traits"] as const).map((k) => (
            <ChipArray
              key={k}
              label={{ beliefs: "信念", desires: "欲望", fears: "恐惧", values: "价值观", core_traits: "核心特质" }[k]}
              arr={local.personality?.[k] ?? []}
              placeholder={`${labelOf(k)} - 回车添加`}
              onChange={(next) => {
                const nextPersonality = { ...(local.personality ?? {}), [k]: next };
                setLocal({ ...local, personality: nextPersonality });
                handleBlurNested({ personality: nextPersonality });
              }}
            />
          ))}
        </div>
      </div>

      {/* 声音签名 */}
      <div className="space-y-1">
        <div className="font-label-mono text-system-log text-[10px] uppercase tracking-wider">声音签名</div>
        <label className="block font-label-mono text-system-log/80 mb-1 text-[10px]">说话风格</label>
        <textarea
          value={local.voice_signature?.speech_style ?? ""}
          onChange={(e) => setLocal({ ...local, voice_signature: { ...(local.voice_signature ?? { speech_style: "", thought_patterns: "", taboos: [] }), speech_style: e.target.value } })}
          onBlur={(e) => {
            const next = { ...(local.voice_signature ?? { speech_style: "", thought_patterns: "", taboos: [] }), speech_style: e.target.value };
            handleBlurNested({ voice_signature: next });
          }}
          className="w-full bg-surface-container border border-outline-variant rounded px-2 py-1 text-xs text-primary focus:outline-none focus:border-primary-container"
          rows={2}
        />
        <label className="block font-label-mono text-system-log/80 mb-1 text-[10px]">内心活动</label>
        <textarea
          value={local.voice_signature?.thought_patterns ?? ""}
          onChange={(e) => setLocal({ ...local, voice_signature: { ...(local.voice_signature ?? { speech_style: "", thought_patterns: "", taboos: [] }), thought_patterns: e.target.value } })}
          onBlur={(e) => {
            const next = { ...(local.voice_signature ?? { speech_style: "", thought_patterns: "", taboos: [] }), thought_patterns: e.target.value };
            handleBlurNested({ voice_signature: next });
          }}
          className="w-full bg-surface-container border border-outline-variant rounded px-2 py-1 text-xs text-primary focus:outline-none focus:border-primary-container"
          rows={2}
        />
        <ChipArray
          label="禁忌"
          arr={local.voice_signature?.taboos ?? []}
          onChange={(next) => {
            const nextVoice = { ...(local.voice_signature ?? { speech_style: "", thought_patterns: "", taboos: [] }), taboos: next };
            setLocal({ ...local, voice_signature: nextVoice });
            handleBlurNested({ voice_signature: nextVoice });
          }}
        />
      </div>

      {/* 当前状态 */}
      <div className="space-y-1">
        <div className="font-label-mono text-system-log text-[10px] uppercase tracking-wider">当前状态</div>
        <label className="block font-label-mono text-system-log/80 mb-1 text-[10px]">位置</label>
        <input
          value={local.current_state?.location ?? ""}
          onChange={(e) => setLocal({ ...local, current_state: { ...(local.current_state ?? { location: "", physical_condition: "normal", emotional: "neutral", known_secrets: [] }), location: e.target.value } })}
          onBlur={(e) => {
            const next = { ...(local.current_state ?? { location: "", physical_condition: "normal", emotional: "neutral", known_secrets: [] }), location: e.target.value };
            handleBlurNested({ current_state: next });
          }}
          className="w-full bg-surface-container border border-outline-variant rounded px-2 py-1 text-xs text-primary focus:outline-none focus:border-primary-container"
        />
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block font-label-mono text-system-log/80 mb-1 text-[10px]">身体状况</label>
            <input
              value={local.current_state?.physical_condition ?? "normal"}
              onChange={(e) => setLocal({ ...local, current_state: { ...(local.current_state ?? { location: "", physical_condition: "normal", emotional: "neutral", known_secrets: [] }), physical_condition: e.target.value } })}
              onBlur={(e) => {
                const next = { ...(local.current_state ?? { location: "", physical_condition: "normal", emotional: "neutral", known_secrets: [] }), physical_condition: e.target.value };
                handleBlurNested({ current_state: next });
              }}
              className="w-full bg-surface-container border border-outline-variant rounded px-2 py-1 text-xs text-primary focus:outline-none focus:border-primary-container"
            />
          </div>
          <div>
            <label className="block font-label-mono text-system-log/80 mb-1 text-[10px]">情绪</label>
            <input
              value={local.current_state?.emotional ?? "neutral"}
              onChange={(e) => setLocal({ ...local, current_state: { ...(local.current_state ?? { location: "", physical_condition: "normal", emotional: "neutral", known_secrets: [] }), emotional: e.target.value } })}
              onBlur={(e) => {
                const next = { ...(local.current_state ?? { location: "", physical_condition: "normal", emotional: "neutral", known_secrets: [] }), emotional: e.target.value };
                handleBlurNested({ current_state: next });
              }}
              className="w-full bg-surface-container border border-outline-variant rounded px-2 py-1 text-xs text-primary focus:outline-none focus:border-primary-container"
            />
          </div>
        </div>
        <ChipArray
          label="已知秘密"
          arr={local.current_state?.known_secrets ?? []}
          onChange={(next) => {
            const nextState = { ...(local.current_state ?? { location: "", physical_condition: "normal", emotional: "neutral", known_secrets: [] }), known_secrets: next };
            setLocal({ ...local, current_state: nextState });
            handleBlurNested({ current_state: nextState });
          }}
        />
      </div>

      {/* 角色不知道的事 */}
      <div className="space-y-1">
        <div className="font-label-mono text-system-log text-[10px] uppercase tracking-wider">角色不知道的事</div>
        <ChipArray
          label="未知 (unknown_to_character)"
          arr={local.unknown_to_character ?? []}
          onChange={(next) => {
            setLocal({ ...local, unknown_to_character: next });
            handleBlurNested({ unknown_to_character: next });
          }}
        />
      </div>

      {/* 角色关系 */}
      <div className="space-y-1">
        <div className="font-label-mono text-system-log text-[10px] uppercase tracking-wider">角色关系</div>
        <CharacterRelationsEditor
          relations={local.relations ?? {}}
          allCharacters={allCharacters}
          selfId={character.id}
          onChange={(next) => {
            setLocal({ ...local, relations: next });
            handleBlurNested({ relations: next });
          }}
        />
      </div>

      <div className="flex justify-end gap-2 pt-2 border-t border-outline-variant">
        <button
          type="button"
          onClick={handleCancel}
          className="px-3 py-1 text-xs bg-surface-container text-system-log rounded-lg hover:bg-surface-container-low"
        >取消</button>
        <button
          type="button"
          onClick={() => onComplete(local)}
          className="px-4 py-1 text-xs bg-tertiary-container text-surface-container-low rounded-lg hover:opacity-90"
        >完成</button>
      </div>
    </div>
  );
}

function labelOf(k: "beliefs" | "desires" | "fears" | "values" | "core_traits"): string {
  return { beliefs: "信念", desires: "欲望", fears: "恐惧", values: "价值观", core_traits: "核心特质" }[k];
}
```

- [ ] **Step 4: Stub out `CharacterRelationsEditor` so the import resolves**

Create `frontend/src/components/wizard/CharacterRelationsEditor.tsx` (placeholder; fleshed out in Task 4):

```tsx
import { Character, RelationStatus } from "../../api/client";

interface Props {
  relations: Record<string, RelationStatus>;
  allCharacters: Character[];
  selfId: string;
  onChange: (next: Record<string, RelationStatus>) => void;
}

export default function CharacterRelationsEditor({ relations }: Props) {
  return (
    <div data-testid="relations-editor-placeholder" className="text-system-log/50 text-xs">
      关系编辑器（Task 4 实现）
      <ul>{Object.keys(relations).map((k) => <li key={k}>{k}</li>)}</ul>
    </div>
  );
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd /Users/longsa/Codes/storyForge2/frontend && npx vitest run src/test/CharacterEditForm.test.tsx`
Expected: 4 of 4 pass. (The "renders all sections" test will still pass since the stub renders keys; the chip-add test uses the `beliefs` placeholder.)

- [ ] **Step 6: Commit**

```bash
cd /Users/longsa/Codes/storyForge2
git add frontend/src/components/wizard/CharacterEditForm.tsx frontend/src/components/wizard/CharacterRelationsEditor.tsx frontend/src/test/CharacterEditForm.test.tsx
git commit -m "feat(wizard): CharacterEditForm + stubbed CharacterRelationsEditor"
```

---

## Task 4: `CharacterRelationsEditor` sub-component

**Files:**
- Modify: `frontend/src/components/wizard/CharacterRelationsEditor.tsx` (replace placeholder)
- Modify: `frontend/src/test/CharacterEditForm.test.tsx` (add 2 cases for relations)

- [ ] **Step 1: Append 2 failing tests to the existing file**

In `frontend/src/test/CharacterEditForm.test.tsx`, add these tests inside the existing `describe("CharacterEditForm", ...)` block:

```tsx
  it("relations editor: adding a relation patches the relations dict", async () => {
    const BOB = { ...ALICE, id: "char_bob", name: "Bob" };
    render(
      <MemoryRouter>
        <CharacterEditForm projectId="p1" character={ALICE} allCharacters={[ALICE, BOB]} onComplete={vi.fn()} onCancel={vi.fn()} />
      </MemoryRouter>,
    );
    // Open the relations sub-editor and add a relation
    const addBtn = screen.getByTestId("relations-add-button");
    fireEvent.click(addBtn);
    // Select Bob in the popover
    const select = screen.getByTestId("relations-target-select");
    fireEvent.change(select, { target: { value: "char_bob" } });
    const statusInput = screen.getByTestId("relations-new-status");
    fireEvent.change(statusInput, { target: { value: "ally" } });
    fireEvent.click(screen.getByTestId("relations-confirm-add"));
    await waitFor(() => {
      const calls = (api.patchCharacter as ReturnType<typeof vi.fn>).mock.calls;
      const hasRelationCall = calls.some(([_pid, _cid, patch]) =>
        patch.relations && Object.keys(patch.relations).includes("char_bob")
      );
      expect(hasRelationCall).toBe(true);
    });
  });

  it("relations editor: removing a relation patches the relations dict", async () => {
    const ALICE_WITH_REL = { ...ALICE, relations: { char_bob: { status: "ally", history: [], last_update_chapter: 0 } } };
    const BOB = { ...ALICE, id: "char_bob", name: "Bob" };
    render(
      <MemoryRouter>
        <CharacterEditForm projectId="p1" character={ALICE_WITH_REL} allCharacters={[ALICE_WITH_REL, BOB]} onComplete={vi.fn()} onCancel={vi.fn()} />
      </MemoryRouter>,
    );
    const removeBtn = screen.getByTestId("relations-remove-char_bob");
    fireEvent.click(removeBtn);
    await waitFor(() => {
      const calls = (api.patchCharacter as ReturnType<typeof vi.fn>).mock.calls;
      const hasRemoveCall = calls.some(([_pid, _cid, patch]) =>
        patch.relations && !("char_bob" in patch.relations)
      );
      expect(hasRemoveCall).toBe(true);
    });
  });
```

- [ ] **Step 2: Run tests to verify the 2 new ones fail**

Run: `cd /Users/longsa/Codes/storyForge2/frontend && npx vitest run src/test/CharacterEditForm.test.tsx`
Expected: the 2 new tests fail with "Unable to find element by data-testid".

- [ ] **Step 3: Implement `CharacterRelationsEditor`**

Replace `frontend/src/components/wizard/CharacterRelationsEditor.tsx` entirely:

```tsx
import { useState } from "react";
import { Character, RelationStatus } from "../../api/client";

interface Props {
  relations: Record<string, RelationStatus>;
  allCharacters: Character[];
  selfId: string;
  onChange: (next: Record<string, RelationStatus>) => void;
}

const STATUS_OPTIONS = ["neutral", "ally", "enemy", "family", "rival", "mentor"];

export default function CharacterRelationsEditor({ relations, allCharacters, selfId, onChange }: Props) {
  const [adding, setAdding] = useState(false);
  const [targetId, setTargetId] = useState("");
  const [status, setStatus] = useState("neutral");

  const candidates = allCharacters.filter((c) => c.id !== selfId && !(c.id in relations));

  const addRelation = () => {
    if (!targetId) return;
    onChange({ ...relations, [targetId]: { status, history: [], last_update_chapter: 0 } });
    setTargetId("");
    setStatus("neutral");
    setAdding(false);
  };

  const removeRelation = (id: string) => {
    const next = { ...relations };
    delete next[id];
    onChange(next);
  };

  const updateStatus = (id: string, newStatus: string) => {
    onChange({ ...relations, [id]: { ...relations[id], status: newStatus } });
  };

  return (
    <div data-testid="character-relations-editor" className="space-y-2">
      <ul className="space-y-1">
        {Object.entries(relations).map(([targetId_, rel]) => {
          const target = allCharacters.find((c) => c.id === targetId_);
          return (
            <li
              key={targetId_}
              className="flex items-center justify-between gap-2 p-1.5 bg-surface-container-low rounded"
            >
              <span className="font-label-mono text-primary text-xs truncate flex-1">
                {target?.name || targetId_}
              </span>
              <select
                value={rel.status}
                onChange={(e) => updateStatus(targetId_, e.target.value)}
                className="text-[11px] bg-surface-container border border-outline-variant rounded px-1 py-0.5"
              >
                {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
              <button
                type="button"
                data-testid={`relations-remove-${targetId_}`}
                onClick={() => removeRelation(targetId_)}
                className="text-system-log/60 hover:text-error text-xs"
                aria-label="删除关系"
              >×</button>
            </li>
          );
        })}
      </ul>

      {adding ? (
        <div className="flex items-center gap-2 p-1.5 bg-surface-container-low rounded">
          <select
            data-testid="relations-target-select"
            value={targetId}
            onChange={(e) => setTargetId(e.target.value)}
            className="flex-1 text-xs bg-surface-container border border-outline-variant rounded px-1 py-0.5"
          >
            <option value="">— 选择角色 —</option>
            {candidates.map((c) => <option key={c.id} value={c.id}>{c.name || c.id}</option>)}
          </select>
          <select
            data-testid="relations-new-status"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="text-xs bg-surface-container border border-outline-variant rounded px-1 py-0.5"
          >
            {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <button
            type="button"
            data-testid="relations-confirm-add"
            onClick={addRelation}
            disabled={!targetId}
            className="px-2 py-0.5 text-xs bg-tertiary-container text-surface-container-low rounded disabled:opacity-40"
          >添加</button>
          <button
            type="button"
            onClick={() => { setAdding(false); setTargetId(""); }}
            className="px-2 py-0.5 text-xs bg-surface-container text-system-log rounded"
          >取消</button>
        </div>
      ) : (
        <button
          type="button"
          data-testid="relations-add-button"
          onClick={() => setAdding(true)}
          disabled={candidates.length === 0}
          className="px-2 py-1 text-xs text-system-log/70 border border-dashed border-outline-variant rounded hover:text-primary-container hover:border-primary-container/50 disabled:opacity-40"
        >+ 添加关系</button>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify all pass**

Run: `cd /Users/longsa/Codes/storyForge2/frontend && npx vitest run src/test/CharacterEditForm.test.tsx`
Expected: 6 of 6 pass.

- [ ] **Step 5: Commit**

```bash
cd /Users/longsa/Codes/storyForge2
git add frontend/src/components/wizard/CharacterRelationsEditor.tsx frontend/src/test/CharacterEditForm.test.tsx
git commit -m "feat(wizard): CharacterRelationsEditor — add/remove/status relations"
```

---

## Task 5: Wire wizard `CharacterStep.tsx` — inline edit + delete + regenerate confirmation

**Files:**
- Modify: `frontend/src/components/wizard/CharacterStep.tsx` (per-card edit/delete buttons + confirmation modal + regenerate confirmation)
- Test: `frontend/src/test/CharacterStep.edit_delete.test.tsx` (new)

- [ ] **Step 1: Write failing tests**

Create `frontend/src/test/CharacterStep.edit_delete.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
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
  voice_signature: { speech_style: "", thought_patterns: "", taboos: [] },
  current_state: { location: "", physical_condition: "normal", emotional: "neutral", known_secrets: [] },
  unknown_to_character: [],
  is_core_character: true,
  character_type: "protagonist",
  relations: { char_bob: { status: "ally", history: [], last_update_chapter: 0 } },
};
const BOB = { ...ALICE, id: "char_bob", name: "Bob", character_type: "supporting", is_core_character: false, relations: {} };

function setup(prefilledCharacters = [ALICE, BOB]) {
  sessionStorage.setItem(
    KEY,
    JSON.stringify({
      currentStep: 3,
      completedSteps: [1, 2, 3],
      status: "completed",
      data: {
        concept: null, story_dna: null, world: null,
        characters: { characters: prefilledCharacters, current: prefilledCharacters[0] },
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
  (api.advance as ReturnType<typeof vi.fn>).mockReset();
  (api.advance as ReturnType<typeof vi.fn>).mockResolvedValue({ current_stage: "STAGE3" });
  sessionStorage.clear();
});

describe("CharacterStep edit + delete", () => {
  it("renders edit and delete buttons on each card", () => {
    setup();
    render(<MemoryRouter><InitWizardModal projectId={PROJECT} onClose={() => {}} /></MemoryRouter>);
    expect(screen.getByTestId("character-edit-char_alice")).toBeInTheDocument();
    expect(screen.getByTestId("character-delete-char_alice")).toBeInTheDocument();
  });

  it("clicking edit switches the card to the edit form", async () => {
    setup();
    render(<MemoryRouter><InitWizardModal projectId={PROJECT} onClose={() => {}} /></MemoryRouter>);
    fireEvent.click(screen.getByTestId("character-edit-char_alice"));
    await waitFor(() => {
      expect(screen.getByTestId("character-char_alice-edit-form")).toBeInTheDocument();
    });
  });

  it("clicking delete opens a confirmation modal showing cascade count", () => {
    setup();
    render(<MemoryRouter><InitWizardModal projectId={PROJECT} onClose={() => {}} /></MemoryRouter>);
    fireEvent.click(screen.getByTestId("character-delete-char_bob"));
    expect(screen.getByText(/Alice/i)).toBeInTheDocument();  // alice still in list
    expect(screen.getByTestId("delete-confirm-button")).toBeInTheDocument();
  });

  it("confirming delete calls deleteCharacter and removes the card", async () => {
    (api.deleteCharacter as ReturnType<typeof vi.fn>).mockResolvedValue({ deleted_id: "char_bob", cascaded_relation_removals: 0 });
    setup();
    render(<MemoryRouter><InitWizardModal projectId={PROJECT} onClose={() => {}} /></MemoryRouter>);
    fireEvent.click(screen.getByTestId("character-delete-char_bob"));
    fireEvent.click(screen.getByTestId("delete-confirm-button"));
    await waitFor(() => {
      expect(api.deleteCharacter).toHaveBeenCalledWith(PROJECT, "char_bob");
    });
    await waitFor(() => {
      expect(screen.queryByTestId("character-char_bob")).not.toBeInTheDocument();
    });
  });

  it("cancelling delete does not call deleteCharacter", async () => {
    setup();
    render(<MemoryRouter><InitWizardModal projectId={PROJECT} onClose={() => {}} /></MemoryRouter>);
    fireEvent.click(screen.getByTestId("character-delete-char_bob"));
    fireEvent.click(screen.getByTestId("delete-cancel-button"));
    expect(api.deleteCharacter).not.toHaveBeenCalled();
    expect(screen.getByTestId("character-char_bob")).toBeInTheDocument();
  });

  it("deleting alice (with inbound relation from nobody) reports 0 cascade count", () => {
    setup();
    render(<MemoryRouter><InitWizardModal projectId={PROJECT} onClose={() => {}} /></MemoryRouter>);
    fireEvent.click(screen.getByTestId("character-delete-char_alice"));
    // Alice has a relation TO bob, but no character has a relation TO alice → 0 cascade
    expect(screen.getByText(/0.*反向关系/)).toBeInTheDocument();
  });

  it("regenerate button shows confirmation modal", () => {
    setup();
    render(<MemoryRouter><InitWizardModal projectId={PROJECT} onClose={() => {}} /></MemoryRouter>);
    fireEvent.click(screen.getByTestId("wizard-regenerate"));
    expect(screen.getByTestId("regenerate-confirm-modal")).toBeInTheDocument();
  });

  it("regenerate confirmation calls updateCharacter on confirm", async () => {
    setup();
    (api.updateCharacter as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    render(<MemoryRouter><InitWizardModal projectId={PROJECT} onClose={() => {}} /></MemoryRouter>);
    fireEvent.click(screen.getByTestId("wizard-regenerate"));
    fireEvent.click(screen.getByTestId("regenerate-confirm-button"));
    // UpdateCharacter is called as part of the regenerate flow (PUT /stage2/character)
    await waitFor(() => {
      expect(api.updateCharacter).toHaveBeenCalled();
    });
  });

  it("regenerate cancellation does not call updateCharacter", () => {
    setup();
    render(<MemoryRouter><InitWizardModal projectId={PROJECT} onClose={() => {}} /></MemoryRouter>);
    fireEvent.click(screen.getByTestId("wizard-regenerate"));
    fireEvent.click(screen.getByTestId("regenerate-cancel-button"));
    expect(api.updateCharacter).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/longsa/Codes/storyForge2/frontend && npx vitest run src/test/CharacterStep.edit_delete.test.tsx`
Expected: most tests fail (no edit/delete buttons, no modals, no cascade count).

- [ ] **Step 3: Add edit + delete buttons to each card + confirmation modals + regenerate confirmation**

Open `frontend/src/components/wizard/CharacterStep.tsx`. Make these changes:

**(a) Imports — add at top:**

```tsx
import CharacterEditForm from "./CharacterEditForm";
```

**(b) New state inside the component function body (after the existing `charactersRef` declaration):**

```tsx
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [regenerateConfirmOpen, setRegenerateConfirmOpen] = useState(false);
```

**(c) Wrap `handleBatchStart` with confirmation (replace existing handler):**

```tsx
  const requestRegenerate = () => {
    if (characters && characters.characters.length > 0) {
      setRegenerateConfirmOpen(true);
      return;
    }
    void handleBatchStart();
  };
```

Keep the original `handleBatchStart` function as-is. Update the footer effect at the bottom of the file so it registers `requestRegenerate` instead of `handleBatchStart`:

```tsx
  useEffect(() => {
    const hasChars = !!characters && characters.characters.length > 0;
    const canRegenerate =
      hasChars ||
      wizard.status === "completed" ||
      wizard.status === "error";
    wizard.setRegenerateHandler(canRegenerate ? requestRegenerate : null, busy);
    wizard.setNextHandler(hasChars ? handleNext : null, busy);
    return () => {
      wizard.setRegenerateHandler(null, false);
      wizard.setNextHandler(null, false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasCharacters, busy, wizard.status]);
```

**(d) New handlers (add after `handleNext`):**

```tsx
  const handleDeleteConfirm = async () => {
    if (!deletingId) return;
    const targetId = deletingId;
    setDeletingId(null);
    try {
      await api.deleteCharacter(projectId, targetId);
      const list = (characters?.characters ?? []).filter((c) => c.id !== targetId);
      const current = characters?.current;
      const next = {
        characters: list,
        current: current && current.id !== targetId ? current : list[0],
      };
      setCharacters(next);
      wizard.saveStep(3, { characters: next });
    } catch (e) {
      wizard.setStatus("error", e instanceof Error ? e.message : "角色删除失败");
    }
  };

  const handleRegenerateConfirm = async () => {
    setRegenerateConfirmOpen(false);
    await handleBatchStart();
  };

  const handleEditComplete = (updated: { id: string }) => {
    setEditingId(null);
    const list = (characters?.characters ?? []).map((c) => (c.id === updated.id ? { ...c, ...updated } : c));
    const next = { characters: list, current: characters?.current ?? list[0] };
    setCharacters(next);
  };

  const handleEditCancel = () => setEditingId(null);

  const inboundRelationCount = (targetId: string): number => {
    return (characters?.characters ?? []).filter(
      (c) => c.id !== targetId && c.relations && targetId in c.relations,
    ).length;
  };
```

**(e) Inside the existing `.map((c) =>` rendering each card, replace the card header `<div>` (the one with `<div className="font-display text-primary">`):**

Replace:
```tsx
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-display text-primary">{c.name || "未命名"}</div>
                    <div className="font-label-mono text-system-log text-xs">
                      {CHARACTER_TYPES.find((t) => t.value === c.character_type)?.label || c.character_type}
                      {c.is_core_character ? " · 核心角色" : ""}
                    </div>
                  </div>
                </div>
```

With:
```tsx
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-display text-primary">{c.name || "未命名"}</div>
                    <div className="font-label-mono text-system-log text-xs">
                      {CHARACTER_TYPES.find((t) => t.value === c.character_type)?.label || c.character_type}
                      {c.is_core_character ? " · 核心角色" : ""}
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      data-testid={`character-edit-${c.id}`}
                      onClick={() => setEditingId(c.id)}
                      className="p-1 text-system-log/70 hover:text-primary-container"
                      aria-label="编辑"
                    >✏️</button>
                    <button
                      type="button"
                      data-testid={`character-delete-${c.id}`}
                      onClick={() => setDeletingId(c.id)}
                      className="p-1 text-system-log/70 hover:text-error"
                      aria-label="删除"
                    >🗑️</button>
                  </div>
                </div>
```

**(f) Replace the card body — wrap the existing `.grid` in a conditional that swaps to `<CharacterEditForm>` when editing this character. Replace from `<div className="grid grid-cols-1 md:grid-cols-3 gap-3 border-t border-outline-variant pt-3">` through `</div>` (the closing of the grid div). The replacement:**

```tsx
                {editingId === c.id ? (
                  <CharacterEditForm
                    projectId={projectId}
                    character={c}
                    allCharacters={characters?.characters ?? []}
                    onComplete={handleEditComplete}
                    onCancel={() => handleEditCancel()}
                  />
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3 border-t border-outline-variant pt-3">
                    {/* (paste the entire existing 3-column grid body here unchanged) */}
                    ...the existing 人格层/声音签名/角色关系 grid stays exactly as it was...
                  </div>
                )}
```

The "paste the existing grid body" is mechanical — keep lines 224-295 of the current file verbatim inside the `else` branch.

**(g) Add the two confirmation modals at the bottom of the outer `<div data-testid="character-step">`, after the closing `)}` of `{hasCharacters && (...)}`:**

```tsx
      {/* Delete confirmation modal */}
      {deletingId && (() => {
        const target = characters?.characters.find((c) => c.id === deletingId);
        if (!target) return null;
        const cascade = inboundRelationCount(deletingId);
        return (
          <div data-testid="delete-confirm-modal" className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-surface-container p-6 rounded-lg max-w-md space-y-4">
              <h3 className="font-display text-lg text-primary">删除「{target.name || "未命名"}」？</h3>
              <p className="font-body-ui text-sm text-system-log">
                将同时清理 <strong>{cascade}</strong> 个反向关系。
              </p>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  data-testid="delete-cancel-button"
                  onClick={() => setDeletingId(null)}
                  className="px-3 py-1 text-xs bg-surface-container-low text-system-log rounded-lg"
                >取消</button>
                <button
                  type="button"
                  data-testid="delete-confirm-button"
                  onClick={() => void handleDeleteConfirm()}
                  className="px-4 py-1 text-xs bg-error text-on-error rounded-lg"
                >确认删除</button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Regenerate confirmation modal */}
      {regenerateConfirmOpen && (
        <div data-testid="regenerate-confirm-modal" className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-surface-container p-6 rounded-lg max-w-md space-y-4">
            <h3 className="font-display text-lg text-primary">重新生成所有角色？</h3>
            <p className="font-body-ui text-sm text-system-log">
              现有 <strong>{characters?.characters.length ?? 0}</strong> 个角色（包含你的编辑）将被覆盖，无法恢复。
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                data-testid="regenerate-cancel-button"
                onClick={() => setRegenerateConfirmOpen(false)}
                className="px-3 py-1 text-xs bg-surface-container-low text-system-log rounded-lg"
              >取消</button>
              <button
                type="button"
                data-testid="regenerate-confirm-button"
                onClick={() => void handleRegenerateConfirm()}
                className="px-4 py-1 text-xs bg-error text-on-error rounded-lg"
              >确认重新生成</button>
            </div>
          </div>
        </div>
      )}
```

**(h) Modify the regenerate handler signature: the existing wizard footer wiring passes the handler to `wizard.setRegenerateHandler`. Find the bottom of the file and ensure the wiring passes the right function. The change in step (c) above replaces `handleBatchStart` with `requestRegenerate` for the handler, but `handleBatchStart` is still invoked inside `requestRegenerate`. No further wiring changes needed.**

- [ ] **Step 4: Run tests to verify all 9 pass**

Run: `cd /Users/longsa/Codes/storyForge2/frontend && npx vitest run src/test/CharacterStep.edit_delete.test.tsx`
Expected: 9 of 9 pass.

- [ ] **Step 5: Run existing CharacterStep tests to verify no regression**

Run: `cd /Users/longsa/Codes/storyForge2/frontend && npx vitest run src/test/CharacterStep.test.tsx`
Expected: all existing tests still pass (the new buttons don't interfere with the existing flow).

- [ ] **Step 6: Commit**

```bash
cd /Users/longsa/Codes/storyForge2
git add frontend/src/components/wizard/CharacterStep.tsx frontend/src/test/CharacterStep.edit_delete.test.tsx
git commit -m "feat(wizard): inline edit + delete buttons + regenerate confirmation"
```

---

## Task 6: Wire workspace `CharacterEditor.tsx` — add `+ 新建角色` + per-card 🗑️

**Files:**
- Modify: `frontend/src/components/workspace/editors/CharacterEditor.tsx`
- Test: `frontend/src/test/CharacterEditor.workspace.test.tsx` (new)

- [ ] **Step 1: Write failing tests**

Create `frontend/src/test/CharacterEditor.workspace.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("../api/client", () => ({
  default: {
    generateCharacter: vi.fn(),
    deleteCharacter: vi.fn(),
    updateCharacter: vi.fn(),
  },
}));

import api from "../api/client";
import CharacterEditor from "../components/workspace/editors/CharacterEditor";

const ALICE = {
  id: "char_alice",
  name: "Alice",
  personality: { beliefs: [], desires: [], fears: [], values: [], core_traits: [] },
  voice_signature: { speech_style: "", thought_patterns: "", taboos: [] },
  current_state: { location: "", physical_condition: "normal", emotional: "neutral", known_secrets: [] },
  unknown_to_character: [],
  is_core_character: true,
  character_type: "protagonist",
  relations: {},
};

beforeEach(() => {
  (api.generateCharacter as ReturnType<typeof vi.fn>).mockReset();
  (api.deleteCharacter as ReturnType<typeof vi.fn>).mockReset();
  (api.updateCharacter as ReturnType<typeof vi.fn>).mockReset();
});

describe("CharacterEditor workspace add/delete", () => {
  it("renders + 新建角色 button", () => {
    render(
      <MemoryRouter>
        <CharacterEditor projectId="p1" data={{ characters: [ALICE] }} onSaved={() => {}} />
      </MemoryRouter>,
    );
    expect(screen.getByTestId("character-new-button")).toBeInTheDocument();
  });

  it("clicking + 新建角色 calls generateCharacter and appends the result", async () => {
    const NEW = { ...ALICE, id: "char_new", name: "Newcomer" };
    (api.generateCharacter as ReturnType<typeof vi.fn>).mockResolvedValue({
      characters: [ALICE, NEW],
      current: NEW,
    });
    render(
      <MemoryRouter>
        <CharacterEditor projectId="p1" data={{ characters: [ALICE] }} onSaved={() => {}} />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByTestId("character-new-button"));
    await waitFor(() => {
      expect(api.generateCharacter).toHaveBeenCalledWith("p1", undefined);
    });
    await waitFor(() => {
      expect(screen.getByText("Newcomer")).toBeInTheDocument();
    });
  });

  it("renders per-card 🗑️ delete button", () => {
    render(
      <MemoryRouter>
        <CharacterEditor projectId="p1" data={{ characters: [ALICE] }} onSaved={() => {}} />
      </MemoryRouter>,
    );
    expect(screen.getByTestId("character-delete-0")).toBeInTheDocument();
  });

  it("clicking delete opens confirmation modal", () => {
    render(
      <MemoryRouter>
        <CharacterEditor projectId="p1" data={{ characters: [ALICE] }} onSaved={() => {}} />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByTestId("character-delete-0"));
    expect(screen.getByTestId("delete-confirm-modal")).toBeInTheDocument();
  });

  it("confirming delete calls deleteCharacter and removes the card", async () => {
    (api.deleteCharacter as ReturnType<typeof vi.fn>).mockResolvedValue({ deleted_id: "char_alice", cascaded_relation_removals: 0 });
    render(
      <MemoryRouter>
        <CharacterEditor projectId="p1" data={{ characters: [ALICE] }} onSaved={() => {}} />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByTestId("character-delete-0"));
    fireEvent.click(screen.getByTestId("delete-confirm-button"));
    await waitFor(() => {
      expect(api.deleteCharacter).toHaveBeenCalledWith("p1", "char_alice");
    });
    await waitFor(() => {
      expect(screen.queryByText("Alice")).not.toBeInTheDocument();
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/longsa/Codes/storyForge2/frontend && npx vitest run src/test/CharacterEditor.workspace.test.tsx`
Expected: tests fail (no `character-new-button`, no `character-delete-0`, etc.).

- [ ] **Step 3: Modify `CharacterEditor.tsx`**

In `frontend/src/components/workspace/editors/CharacterEditor.tsx`, apply these edits:

**(a) Add imports at the top:**

```tsx
import { useEffect, useRef, useState } from "react";
import api, { Character, CharacterSet } from "../../../api/client";
import { useAutoHeight } from "../../../hooks/useAutoHeight";
```

(Already imports `useState`/`useRef`/`useEffect` — no change. Add a new `deletingId` state hook + handlers inside the function body.)

**(b) Remove the "intentionally out of scope" comment at lines 41-46** (delete the entire JSDoc comment).

**(c) Inside the function body, after the existing `setError` declaration, add:**

```tsx
  const [deletingId, setDeletingId] = useState<string | null>(null);
```

**(d) Add the delete handler near `handleSave`:**

```tsx
  const handleDeleteClick = (id: string) => setDeletingId(id);
  const handleDeleteConfirm = async () => {
    if (!deletingId) return;
    const target = deletingId;
    setDeletingId(null);
    try {
      await api.deleteCharacter(projectId, target);
      setSet((prev) => {
        const next = prev.characters.filter((c) => c.id !== target);
        return { ...prev, characters: next, current: next[0] ?? (null as unknown as Character) };
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "删除失败");
    }
  };

  const handleNewCharacter = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await api.generateCharacter(projectId);
      // generate-character returns the cumulative list including the new one
      const list = result.characters ?? [];
      setSet({ characters: list, current: list[0] ?? (null as unknown as Character) });
    } catch (e) {
      setError(e instanceof Error ? e.message : "新建失败");
    } finally {
      setBusy(false);
    }
  };
```

**(e) Modify the heading `<div>` (lines 102-104).** Replace:

```tsx
      <div className="font-label-mono text-system-log text-[10px] uppercase tracking-wider">
        角色 ({set.characters.length} 个 — 详细增删请到 Stage2)
      </div>
```

With:

```tsx
      <div className="flex items-center justify-between">
        <div className="font-label-mono text-system-log text-[10px] uppercase tracking-wider">
          角色 ({set.characters.length} 个)
        </div>
        <button
          type="button"
          data-testid="character-new-button"
          onClick={() => void handleNewCharacter()}
          disabled={busy}
          className="px-2 py-0.5 text-[11px] border border-dashed border-outline-variant text-system-log/70 rounded hover:text-primary-container hover:border-primary-container/50 disabled:opacity-40"
        >+ 新建角色</button>
      </div>
```

**(f) Modify each character card's `<summary>` (around line 107).** Replace:

```tsx
          <summary className="cursor-pointer px-3 py-2 font-body-ui text-sm text-primary">
            {c.name || "未命名角色"}{" "}
            <span className="text-system-log/60 text-xs">
              ({ROLE_LABELS[c.character_type] ?? c.character_type})
            </span>
          </summary>
```

With:

```tsx
          <summary className="cursor-pointer px-3 py-2 font-body-ui text-sm text-primary flex items-center justify-between">
            <span>
              {c.name || "未命名角色"}{" "}
              <span className="text-system-log/60 text-xs">
                ({ROLE_LABELS[c.character_type] ?? c.character_type})
              </span>
            </span>
            <button
              type="button"
              data-testid={`character-delete-${idx}`}
              onClick={(e) => { e.preventDefault(); handleDeleteClick(c.id); }}
              className="text-system-log/60 hover:text-error text-xs px-1"
              aria-label="删除"
            >🗑️</button>
          </summary>
```

**(g) Add the delete confirmation modal at the bottom of the returned JSX, after the existing `<footer>`:**

```tsx
      {deletingId && (
        <div data-testid="delete-confirm-modal" className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-surface-container p-6 rounded-lg max-w-md space-y-4">
            <h3 className="font-display text-lg text-primary">
              删除「{set.characters.find((c) => c.id === deletingId)?.name || "未命名"}」？
            </h3>
            <p className="font-body-ui text-sm text-system-log">
              将清理 {set.characters.filter((c) => c.id !== deletingId && c.relations && deletingId in c.relations).length} 个反向关系。
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                data-testid="delete-cancel-button"
                onClick={() => setDeletingId(null)}
                className="px-3 py-1 text-xs bg-surface-container-low text-system-log rounded-lg"
              >取消</button>
              <button
                type="button"
                data-testid="delete-confirm-button"
                onClick={() => void handleDeleteConfirm()}
                className="px-4 py-1 text-xs bg-error text-on-error rounded-lg"
              >确认删除</button>
            </div>
          </div>
        </div>
      )}
```

- [ ] **Step 4: Run tests to verify all 5 pass**

Run: `cd /Users/longsa/Codes/storyForge2/frontend && npx vitest run src/test/CharacterEditor.workspace.test.tsx`
Expected: 5 of 5 pass.

- [ ] **Step 5: Run existing CharacterStep tests + any existing CharacterEditor tests to verify no regression**

Run: `cd /Users/longsa/Codes/storyForge2/frontend && npx vitest run src/test/CharacterStep.test.tsx src/test/CharacterStep.edit_delete.test.tsx src/test/CharacterEditForm.test.tsx`
Expected: all existing tests still pass.

- [ ] **Step 6: Commit**

```bash
cd /Users/longsa/Codes/storyForge2
git add frontend/src/components/workspace/editors/CharacterEditor.tsx frontend/src/test/CharacterEditor.workspace.test.tsx
git commit -m "feat(workspace): + 新建角色 + per-card delete on CharacterEditor"
```

---

## Task 7: Integration smoke test

**Files:**
- Create: `tests/test_stage2_character_crud_integration.py` (no new test code; re-runs existing suites + new ones)

This task is verification, not new code.

- [ ] **Step 1: Run full backend test suite**

Run: `cd /Users/longsa/Codes/storyForge2 && source venv/bin/activate && pytest tests/ -q --tb=line 2>&1 | tail -15`
Expected: same pass/fail count as before this work, plus the 8 new tests in `test_stage2_character_crud.py` all passing.

- [ ] **Step 2: Run full frontend test suite**

Run: `cd /Users/longsa/Codes/storyForge2/frontend && npx vitest run 2>&1 | tail -30`
Expected: pre-existing test count + 4 new in `CharacterEditForm.test.tsx` + 9 new in `CharacterStep.edit_delete.test.tsx` + 5 new in `CharacterEditor.workspace.test.tsx`, all passing.

- [ ] **Step 3: TypeScript check**

Run: `cd /Users/longsa/Codes/storyForge2/frontend && npx tsc --noEmit 2>&1 | head -30`
Expected: no new TypeScript errors.

- [ ] **Step 4: Manual smoke (optional)**

1. Restart backend + frontend (the dev server already hot-reloaded).
2. Open a project → Stage 2 wizard
3. Edit one character's name → blur → reload page → name persists
4. Add a relation between two characters → reload → relation persists
5. Delete character A → confirm modal shows cascade count → confirm → other characters' relations to A are gone
6. Click "重新生成" → confirmation shows → cancel → no destruction
7. Advance to Stage 3 → outline uses the updated name
8. Switch to workspace → confirm CharacterEditor has `+ 新建角色` and per-card 🗑️ buttons

- [ ] **Step 5: Commit any test infra leftovers (if needed)**

If the integration smoke surfaced a missing fixture or test data file, commit it under `tests/fixtures/`. (Skip if no new files were generated.)

---

## Acceptance Criteria

- [ ] `PATCH /stage2/character/{cid}` accepts partial updates and writes atomically
- [ ] `DELETE /stage2/character/{cid}` removes the character + cascades inbound relations + reports count
- [ ] Wizard `CharacterStep` shows ✏️ + 🗑️ per card; clicking ✏️ enters inline edit mode
- [ ] Field-blur in edit form fires a debounced PATCH (500ms)
- [ ] Wizard "重新生成" requires confirmation
- [ ] Delete confirmation modal shows cascade count
- [ ] `CharacterEditForm` is reused by both wizard and workspace
- [ ] Workspace `CharacterEditor` has `+ 新建角色` (via `generateCharacter`) and per-card 🗑️
- [ ] All 22 new tests pass; no regression in existing tests
