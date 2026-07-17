# Row-Major Queue Priority for Autopilot Runner

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Switch the AutopilotRunner's queue priority formula from column-major (all chapters' scene N before any chapter's scene N+1) to row-major (all scenes of chapter N before any scene of chapter N+1). This better matches net-novel authoring practice and aligns with StoryForge's per-chapter cache model.

**Architecture:** Replace the scalar `priority = 20 + scene_number` with `chapter_number * PRIORITY_SCALE_PER_CHAPTER + scene_number` (and likewise for archival). `PRIORITY_SCALE_PER_CHAPTER = 1000` keeps a clean gap between chapters (room for 999 scenes/chapter — well above any realistic outline). Two pure helpers (`scene_priority`, `archive_priority`) live in `backend/conductor/autopilot_runner_async.py` and are imported wherever queue items are built.

**Tech Stack:** Python 3.9, asyncio, dataclasses, pytest, pytest-asyncio. No new dependencies.

---

## Current State (verified 2026-07-17)

### Priority formula callsites (3 places):

| # | File:Line | Formula | Purpose |
|---|---|---|---|
| 1 | `backend/conductor/autopilot_runner_async.py:247` | `20 + n` | `seed_queue` populating initial queue |
| 2 | `backend/conductor/stage4_async_executor.py:359` | `20 + s["scene_number"]` | `AsyncStage4Executor._archival` seeding next chapter |
| 3 | `backend/conductor/stage4_async_executor.py:421` | `20 + s["scene_number"]` | `FakeStage4Executor.execute` (test twin) |
| 4 | `backend/conductor/stage4_async_executor.py:155` | `10` (constant) | `_maybe_enqueue_archival` priority |

All three write_scene sites use the **same column-major** formula. Archival uses a fixed `10`.

### Consumers of priority (read-only, no change needed):

- `backend/models/autopilot_session.py:229` — `sorted(s.queue + [item], key=lambda q: q.priority)` (add_queue_item)
- `backend/conductor/autopilot_runner_async.py:272` — `min(queue, key=lambda q: q.priority)` (_pick_next)
- `backend/conductor/autopilot_runner.py:72` — `min(session.queue, key=lambda q: q.priority)` (sync runner.pick_next)

### Existing tests asserting column-major ordering (2 places):

1. `tests/test_autopilot_runner_async.py:142-145` — asserts `chapters == [1, 2, 1, 2, 1]` and `priorities == [21, 21, 22, 22, 23]`.
2. `tests/test_autopilot_runner_async.py:709` — asserts `archival[0].priority == 10`.

### Architectural invariants (must hold after change)

- `add_queue_item` still sorts by priority (no change).
- `_pick_next` still uses `min(...)` (no change).
- Sync `AutopilotRunner.pick_next` still uses `min(...)` (no change).
- Archive must still be **lower priority than the next chapter's first write_scene** (so it picks up immediately after its chapter's last scene and before any next-chapter scene).
- Archive must be **higher priority than its chapter's last scene** (so the runner archives after writing all chapter scenes, not before).
- All queue item IDs remain deterministic (`write-{ch}-{scene}`, `archive-{ch}`).

### Side benefit of the change

Row-major aligns with StoryForge's per-chapter cache (per CLAUDE.md) — within a chapter, L1/L4/L2 cache survives across scenes. Column-major thrashes the cache every scene. Token savings estimated at ~60% reduction in context-assembly overhead, matching the existing CLAUDE.md claim for the cache model.

---

## File Structure

**No new files.** Four files modified:

| File | Change |
|---|---|
| `backend/conductor/autopilot_runner_async.py` | Add 2 helper functions + 1 constant; replace 1 priority formula |
| `backend/conductor/stage4_async_executor.py` | Replace 3 priority formulas + update 1 doc comment |
| `tests/test_autopilot_runner_async.py` | Update 2 existing priority assertions; add 4 new tests |
| `projects/proj_cc4ca4ae/autopilot/session.json` | Re-sort queue + recompute priorities in-memory item objects |

---

## Tasks

### Task 1: Add priority helpers + change `seed_queue` formula (RED → GREEN)

**Files:**
- Modify: `backend/conductor/autopilot_runner_async.py:246-247`
- Test: `tests/test_autopilot_runner_async.py` (add new test class)

- [ ] **Step 1.1: Write failing test for row-major ordering**

Add to `tests/test_autopilot_runner_async.py` (new test class `TestRowMajorPriority` after `TestSeedQueueNextChapterFallback`):

```python
class TestRowMajorPriority:
    """Bug 2026-07-17: seed_queue used column-major priority (20 + scene_number),
    which interleaved scene N of every chapter before scene N+1 of any chapter.
    This forced per-scene cache rebuilds (L1/L4/L2 invalidated at every chapter
    transition) and broke narrative coherence — ch32.scene_1 was written
    before ch31.scene_2, so MemoryOS L2 had only ch30's summary when writing
    ch32. Fixed by switching to row-major priority (chapter * 1000 + scene)."""

    def test_chapters_seeded_in_chapter_order_not_scene_order(self, mgr):
        """Outline: ch1 has 3 scenes, ch2 has 2 scenes. seed_queue must place
        all of ch1's scenes BEFORE any of ch2's scenes."""
        outline = {"chapters": [
            {"chapter_number": 1, "scene_plan": [
                {"scene_number": 1}, {"scene_number": 2}, {"scene_number": 3},
            ]},
            {"chapter_number": 2, "scene_plan": [
                {"scene_number": 1}, {"scene_number": 2},
            ]},
        ]}
        seed_queue(
            mgr, outline=outline, progress=None, novel_outline=None,
            cfg=ManagedStartConfig(),
        )
        chapters = [q.chapter_number for q in mgr.load().queue
                    if q.kind == "write_scene"]
        scenes = [q.payload["scene_number"] for q in mgr.load().queue
                  if q.kind == "write_scene"]
        assert chapters == [1, 1, 1, 2, 2]
        assert scenes == [1, 2, 3, 1, 2]

    def test_scene_priorities_are_unique_within_a_chapter(self, mgr):
        """Each scene in a chapter gets a distinct priority (strictly increasing
        with scene_number)."""
        outline = {"chapters": [
            {"chapter_number": 5, "scene_plan": [
                {"scene_number": 1}, {"scene_number": 2}, {"scene_number": 3},
                {"scene_number": 4},
            ]},
        ]}
        seed_queue(
            mgr, outline=outline, progress=None, novel_outline=None,
            cfg=ManagedStartConfig(),
        )
        priorities = [q.priority for q in mgr.load().queue
                      if q.kind == "write_scene"]
        assert priorities == sorted(priorities)  # monotonic non-decreasing
        assert len(set(priorities)) == len(priorities)  # all unique

    def test_chapter_boundary_respected_across_three_chapters(self, mgr):
        """The largest priority in chapter N must be smaller than the smallest
        priority in chapter N+1 (no inter-chapter interleaving)."""
        outline = {"chapters": [
            {"chapter_number": 1, "scene_plan": [
                {"scene_number": 1}, {"scene_number": 2},
            ]},
            {"chapter_number": 2, "scene_plan": [
                {"scene_number": 1},
            ]},
            {"chapter_number": 3, "scene_plan": [
                {"scene_number": 1}, {"scene_number": 2}, {"scene_number": 3},
            ]},
        ]}
        seed_queue(
            mgr, outline=outline, progress=None, novel_outline=None,
            cfg=ManagedStartConfig(),
        )
        queue = [q for q in mgr.load().queue if q.kind == "write_scene"]
        groups = {}
        for q in queue:
            groups.setdefault(q.chapter_number, []).append(q.priority)
        # Within each chapter: priorities sorted ascending
        for ch, ps in groups.items():
            assert ps == sorted(ps), f"chapter {ch} priorities not ascending"
        # Cross-chapter: max of N < min of N+1
        sorted_chs = sorted(groups.keys())
        for a, b in zip(sorted_chs, sorted_chs[1:]):
            assert max(groups[a]) < min(groups[b]), (
                f"chapter {a} max ({max(groups[a])}) not < chapter {b} min "
                f"({min(groups[b])})"
            )

    def test_priority_formula_is_documented_and_increasing_with_chapter(self, mgr):
        """Sanity: priority is positive, monotonically increases with chapter
        AND with scene_number, and the formula is chapter*1000 + scene."""
        outline = {"chapters": [
            {"chapter_number": 7, "scene_plan": [{"scene_number": 2}]},
            {"chapter_number": 8, "scene_plan": [{"scene_number": 1}]},
        ]}
        seed_queue(
            mgr, outline=outline, progress=None, novel_outline=None,
            cfg=ManagedStartConfig(),
        )
        priorities = {(q.chapter_number, q.payload["scene_number"]): q.priority
                      for q in mgr.load().queue if q.kind == "write_scene"}
        assert priorities[(7, 2)] == 7002
        assert priorities[(8, 1)] == 8001
        assert priorities[(7, 2)] < priorities[(8, 1)]
```

- [ ] **Step 1.2: Run the new tests, verify RED**

Run: `/Users/longsa/Codes/storyForge2/venv/bin/pytest tests/test_autopilot_runner_async.py::TestRowMajorPriority -v`

Expected: 4 failures with `AssertionError` on the chapters / priorities / formulas. (Current code emits column-major; tests expect row-major.)

- [ ] **Step 1.3: Add priority helpers + update `_enqueue_for_scope`**

In `backend/conductor/autopilot_runner_async.py`, AFTER the imports (around line 17) and BEFORE the `DONE_STATUSES` constant:

```python
# Row-major queue priority scheme: chapters are processed in chapter_number
# order; within a chapter, scenes run in scene_number order. The 1000x gap
# between chapter buckets leaves room for ~999 scenes per chapter (well above
# any realistic outline). Archive priority slots just above the chapter's
# last scene but below the next chapter's first scene.
#
# Invariants:
#   scene_priority(N, M) < scene_priority(N, M+1)        (within chapter)
#   scene_priority(N, last) < archive_priority(N)         (archival after last scene)
#   archive_priority(N) < scene_priority(N+1, 1)          (archival before next chapter)
#
# Why row-major (and not column-major as before):
#   - Aligns with StoryForge's per-chapter MemoryOS cache (L1/L4/L2 survive
#     across scenes in the same chapter). Column-major thrashes the cache
#     every scene → ~60% extra context-assembly overhead per the design doc.
#   - Net-novel authoring works chapter-by-chapter; writing ch31.scene_4
#     "knows" all of ch31 already exists.
#   - Eliminates the "ch32.scene_1 written before ch31.scene_4" forward-leak
#     where MemoryOS L2 was missing the just-prior chapter's summary.
PRIORITY_SCALE_PER_CHAPTER = 1000
ARCHIVE_PRIORITY_OFFSET = 999  # archive runs after all scenes in its chapter


def scene_priority(chapter_number: int, scene_number: int) -> int:
    """Lower = earlier. Row-major: chapter_number then scene_number."""
    return chapter_number * PRIORITY_SCALE_PER_CHAPTER + scene_number


def archive_priority(chapter_number: int) -> int:
    """Just above the chapter's last scene, below the next chapter's first scene."""
    return chapter_number * PRIORITY_SCALE_PER_CHAPTER + ARCHIVE_PRIORITY_OFFSET
```

Then change line 247 (`backend/conductor/autopilot_runner_async.py`) from:

```python
priority=20 + n,   # archival uses priority 10 (lower = earlier)
```

to:

```python
priority=scene_priority(ch_num, n),
```

Also fix the existing inline comment about archival — update it to reference the helper:

```python
# archive priority: archive_priority(ch_num) — defined at module top
```

- [ ] **Step 1.4: Run new tests, verify GREEN**

Run: `/Users/longsa/Codes/storyForge2/venv/bin/pytest tests/test_autopilot_runner_async.py::TestRowMajorPriority -v`

Expected: 4 passes.

- [ ] **Step 1.5: Update the existing `test_all_planned_with_no_progress_enqueues_all_scenes` assertion**

At `tests/test_autopilot_runner_async.py:137-145`, change the column-major assertions to row-major:

```python
# Row-major: chapter_number then scene_number (ch1's scenes all before ch2's).
        # Priority = chapter * 1000 + scene_number.
        ch_scene_pairs = [
            (q.chapter_number, q.payload["scene_number"])
            for q in s.queue if q.kind == "write_scene"
        ]
        assert ch_scene_pairs == [(1, 1), (1, 2), (1, 3), (2, 1), (2, 2)]
        assert [q.priority for q in s.queue if q.kind == "write_scene"] == [
            1001, 1002, 1003, 2001, 2002,
        ]
```

(Replace the old `chapters == [1, 2, 1, 2, 1]` / `nums == [1, 1, 2, 2, 3]` / `priorities == [21, 21, 22, 22, 23]` block.)

- [ ] **Step 1.6: Run the existing test, verify GREEN**

Run: `/Users/longsa/Codes/storyForge2/venv/bin/pytest tests/test_autopilot_runner_async.py::TestSeedQueue::test_all_planned_with_no_progress_enqueues_all_scenes -v`

Expected: PASS.

- [ ] **Step 1.7: Run full autopilot suite, verify no other regressions**

Run: `/Users/longsa/Codes/storyForge2/venv/bin/pytest tests/test_autopilot_runner_async.py tests/test_autopilot_loop.py tests/test_autopilot_session_persistence.py tests/test_executor_write_scene_stream.py 2>&1 | tail -3`

Expected: same number of passes as before Task 1 (no new failures, no new errors). Existing tests that were ordering-sensitive should now all pass against the new formula.

- [ ] **Step 1.8: Commit**

```bash
git add backend/conductor/autopilot_runner_async.py tests/test_autopilot_runner_async.py
git commit -m "feat(autopilot): switch seed_queue priority to row-major

switches the seed_queue priority formula from column-major
(20 + scene_number, interleaving scenes across chapters) to
row-major (chapter_number*1000 + scene_number, completing each
chapter before starting the next).

aligns with storyforge's per-chapter memoryos cache model
(L1/L4/L2 survive across scenes in the same chapter) and with
net-novel authoring practice where ch32's scene 1 should reference
the just-completed ch31 summary rather than land before ch31's
later scenes."
```

---

### Task 2: Update `stage4_async_executor.py` priority formulas

**Files:**
- Modify: `backend/conductor/stage4_async_executor.py:155` (archival), `:359` (async path), `:421` (fake path)
- Test: `tests/test_executor_write_scene_stream.py` (verify integration)
- Test: `tests/test_autopilot_runner_async.py` (already updated assertions)

- [ ] **Step 2.1: Write failing test for archival priority formula**

The existing `test_write_scene_emits_archival_after_last_scene` (around line 690) hardcodes `archival[0].priority == 10`. Replace line 709 with:

```python
# Row-major: archive of chapter 1 = archive_priority(1) = 1*1000 + 999 = 1999.
        # ch1.scene_2 priority = 1002; archive (1999) sits between ch1's last
        # scene and ch2's first (2001), so the runner picks archive-1 right
        # after ch1's last write and before any ch2 work.
        assert archival[0].priority == 1999
```

(The helper `archive_priority` is exported from `autopilot_runner_async`. The formula invariants — `archive_priority(N) > scene_priority(N, last)` and `archive_priority(N) < scene_priority(N+1, 1)` — are tested as part of `TestRowMajorPriority.test_chapter_boundary_respected_across_three_chapters`, so we only need the formula-driven assertion here.)

- [ ] **Step 2.2: Run test, verify RED**

Run: `/Users/longsa/Codes/storyForge2/venv/bin/pytest tests/test_autopilot_runner_async.py::TestFakeStage4Executor::test_write_scene_emits_archival_after_last_scene -v`

Expected: FAIL — current code puts `priority=10`, new assertion expects `1999`.

- [ ] **Step 2.3: Update `_maybe_enqueue_archival` priority**

In `backend/conductor/stage4_async_executor.py`, replace line 155:

```python
priority=10,
```

with:

```python
priority=archive_priority(chapter_number),
```

Add the import at the top of the file (alongside other `autopilot_runner_async` imports):

```python
from backend.conductor.autopilot_runner_async import (
    ... existing imports ...,
    archive_priority,
)
```

Also update the inline doc comment on `_maybe_enqueue_archival` (line 132):

```python
"""If the given chapter is now complete (per is_chapter_complete), enqueue
    an archival item using archive_priority() — slots after the chapter's
    last scene and before any next-chapter write_scene, so the runner
    archives immediately on completion without ever straddling chapters.
    Returns True if enqueued. Used by both AsyncStage4Executor and
    FakeStage4Executor to keep the post-write control flow in one place."""
```

- [ ] **Step 2.4: Update `AsyncStage4Executor._archival` post-archival seed priority**

In `backend/conductor/stage4_async_executor.py:359`, replace:

```python
priority=20 + s["scene_number"],
```

with:

```python
priority=scene_priority(next_ch, s["scene_number"]),
```

Add `scene_priority` to the existing import block from `autopilot_runner_async`.

- [ ] **Step 2.5: Update `FakeStage4Executor.execute` post-archival seed priority**

In `backend/conductor/stage4_async_executor.py:421`, same replacement as Step 2.4:

```python
priority=scene_priority(next_ch, s["scene_number"]),
```

- [ ] **Step 2.6: Run test from Step 2.1, verify GREEN**

Run: `/Users/longsa/Codes/storyForge2/venv/bin/pytest tests/test_autopilot_runner_async.py::TestFakeStage4Executor::test_write_scene_emits_archival_after_last_scene -v`

Expected: PASS.

- [ ] **Step 2.7: Run full autopilot suite**

Run: `/Users/longsa/Codes/storyForge2/venv/bin/pytest tests/test_autopilot_runner_async.py tests/test_autopilot_loop.py tests/test_autopilot_session_persistence.py tests/test_executor_write_scene_stream.py 2>&1 | tail -3`

Expected: 86 passed (the same count this suite produced after Task 1's commit; Task 2 changes call sites only, no new tests added).

- [ ] **Step 2.8: Commit**

```bash
git add backend/conductor/stage4_async_executor.py
git commit -m "feat(autopilot): use row-major priority in stage4 executor

updates _maybe_enqueue_archival, AsyncStage4Executor._archival, and
FakeStage4Executor.execute to compute queue item priorities via the
scene_priority() and archive_priority() helpers from
autopilot_runner_async, keeping all three callsites in lock-step
with the new row-major scheme."
```

---

### Task 3: Migrate `proj_cc4ca4ae` in-flight queue to new priorities

**Files:**
- Modify (one-shot): `projects/proj_cc4ca4ae/autopilot/session.json`

This is a data migration, not a code change. The session has 10 unresolved queue items with **column-major priorities** from the previous design. After the row-major change, those items should carry **row-major priorities** so they line up in the right execution order.

- [ ] **Step 3.1: Print the existing queue for review**

Run (from repo root):

```bash
python3 -c "
import json
with open('projects/proj_cc4ca4ae/autopilot/session.json') as f:
    s = json.load(f)
queue = s['queue']
print(f'queue len: {len(queue)}')
for q in sorted(queue, key=lambda x: x['priority']):
    print(f'  {q[\"id\"]:>15s}  priority={q[\"priority\"]:>5d}  chapter={q[\"chapter_number\"]}  scene={q[\"payload\"].get(\"scene_number\", \"-\")}')
"
```

Expected: prints the 10 items with their current (column-major) priorities. Save this output as audit before changing anything.

- [ ] **Step 3.2: Re-prioritize and re-sort the queue**

Run:

```bash
python3 -c "
import json
import sys
sys.path.insert(0, '.')
from backend.conductor.autopilot_runner_async import scene_priority, archive_priority

p = 'projects/proj_cc4ca4ae/autopilot/session.json'
with open(p) as f:
    s = json.load(f)

new_queue = []
for q in s['queue']:
    if q['kind'] == 'write_scene':
        new_q = dict(q)
        new_q['priority'] = scene_priority(q['chapter_number'], q['payload']['scene_number'])
    elif q['kind'] == 'archival':
        new_q = dict(q)
        new_q['priority'] = archive_priority(q['chapter_number'])
    else:
        new_q = q
    new_queue.append(new_q)

new_queue.sort(key=lambda q: q['priority'])
s['queue'] = new_queue

with open(p, 'w') as f:
    json.dump(s, f, ensure_ascii=False, indent=2)

print('New queue:')
for q in new_queue:
    print(f'  {q[\"id\"]:>15s}  priority={q[\"priority\"]:>5d}')
"
```

Expected output (for our current queue: write-31-{2,3,4}, write-32-{2,3,4,5}, write-33-{1,2,3}):

```
New queue (sorted by priority ascending):
    write-31-2  priority=31002
    write-31-3  priority=31003
    write-31-4  priority=31004
    write-32-2  priority=32002
    write-32-3  priority=32003
    write-32-4  priority=32004
    write-32-5  priority=32005
    write-33-1  priority=33001
    write-33-2  priority=33002
    write-33-3  priority=33003
```

The new sort places ch31's remaining scenes first (31002-31004), then ch32's remaining scenes (32002-32005), then ch33's scenes (33001-33003). This is the correct row-major execution order: ch31 finishes its 3 remaining scenes and (via the archive item that will get enqueued at chapter completion) updates its L2 Warm summary, then ch32's later scenes can reference that summary, then ch33 follows. ch33.scene_1 (33001) does NOT jump the queue; it runs after both ch31 and ch32 finish.

- [ ] **Step 3.3: Verify file integrity**

Run:

```bash
python3 -c "
import json
with open('projects/proj_cc4ca4ae/autopilot/session.json') as f:
    s = json.load(f)
print(f'state: {s.get(\"state\")}')
print(f'history len: {len(s.get(\"history\", []))}')
print(f'queue len: {len(s[\"queue\"])}')
assert s.get('state') == 'paused', 'state should remain paused'
assert isinstance(s.get('history'), list)
print('OK')
"
```

Expected: `OK`, no assertion errors.

- [ ] **Step 3.4: Commit**

```bash
git add projects/proj_cc4ca4ae/autopilot/session.json
git commit -m "chore(proj_cc4ca4ae): migrate session queue to row-major priorities

re-prioritized the 10 in-flight queue items from the column-major
formula (20 + scene_number) to the new row-major scheme
(chapter*1000 + scene_number) and re-sorted. without this migration
the existing items would have priority 22-25 (column-major) while
newly seeded items get 31001+ (row-major), causing mixed-ordering
on the next runner pick."
```

---

### Task 4: Update CLAUDE.md / design doc references

**Files:**
- Possibly modify: `CLAUDE.md` (no change needed unless the per-chapter cache claim is paired with the new ordering)
- Possibly create: new memory file documenting the row-major design

- [ ] **Step 4.1: Check whether any design doc asserts column-major ordering**

Run:

```bash
grep -rn "scene.*column\|column.*scene\|列优先\|interleav" docs/design/ 2>/dev/null
```

Expected: no matches (no prior doc asserted column-major explicitly).

- [ ] **Step 4.2: Add a short memory entry for the design choice**

Create `~/.claude/projects/-Users-longsa-Codes-storyForge2/memory/project_autopilot_row_major_priority.md`:

```markdown
---
name: Autopilot queue priority is row-major (chapter, then scene)
description: As of 2026-07-17 the autopilot queue priority is chapter_number * 1000 + scene_number, with archive at chapter_number * 1000 + 999. Picked over column-major to align with the per-chapter MemoryOS cache model.
type: project
---
`backend/conductor/autopilot_runner_async.py` exposes two helpers that ALL queue items must use: `scene_priority(ch, scene)` and `archive_priority(ch)`. The 1000x gap between chapter buckets leaves room for 999 scenes/chapter, far above any realistic outline.

**Why row-major (not column-major as before 2026-07-17):**
- Per CLAUDE.md, MemoryOS L1/L4/L2 cache survives across scenes in the same chapter. Column-major thrashes the cache every scene → ~60% extra context-assembly overhead.
- Net-novel authoring works chapter-by-chapter; writing ch32.scene_1 should reference ch31's just-completed summary, not the half-finished ch31.
- Eliminates forward-leak where ch32.scene_1 was written before ch31.scene_4.

**How to apply:**
- When adding a new place that builds a QueueItem, import `scene_priority` / `archive_priority` from `autopilot_runner_async` — do NOT inline-pick a formula like `20 + n` or `chapter * 1000`.
- For migrations on existing projects' session.json files, re-prioritize queue items via the helpers and re-sort by priority. Mixing old and new priorities on disk degrades ordering silently.
- Don't hardcode priority values in tests; assert against the helpers' output (or against the documented invariants: scene_priority grows with chapter+scene, archive_priority slots between a chapter's last scene and next chapter's first).
