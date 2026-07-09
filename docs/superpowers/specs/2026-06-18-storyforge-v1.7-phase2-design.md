# StoryForge v1.7 Phase 2 — Creative Canvas + Branch Simulation Backend Design

> **Date:** 2026-06-18 | **Status:** Approved | **Based on:** storyForge-design-v1.7-TRD.md §4.2, §4.9.1, §5.1-5.2

## 1. Objective

Implement Phase 2 backend (T2.1-T2.4): complete CreativeOS engine LLM stubs, add Creative Director agent, build Creative Canvas API (6 endpoints), and Branch Simulator + API (2 endpoints). Frontend deferred.

## 2. Architecture

```
FastAPI Router
├── creative_canvas.py (new, 6 endpoints)
└── stage3_outline.py (modify, +2 endpoints)
        │
   ┌────▼────────┐     ┌──────────────┐
   │  Creative    │     │    Branch     │
   │  Director    │     │   Simulator   │
   │  (Agent)     │     │ (conductor/)  │
   └─────┬────────┘     └──────┬────────┘
         │ suggest/evaluate    │ Phase 1: ImpactAnalyzer
         │ (只给建议，不执行)    │ Phase 2: LLM inference
         │                     │
   ┌─────▼─────────────────────▼──────────┐
   │         CreativeOS Engines            │
   │  MutationEngine / ContradictionEngine │
   │  WhatIfEngine / GenreFusionEngine     │
   │  NoveltyEvaluator / IdeaPool/TropePool│
   │  (Phase 2: complete LLM stubs)        │
   └───────────────────────────────────────┘
```

**Key decisions:**
- Engine holds ModelRouter directly, calls LLM without Agent intermediary
- Creative Director agent follows BaseAgent pattern, returns suggestions only (never executes engine ops)
- API layer is thin orchestration: call engine → score → ask agent for suggestion → assemble response
- Canvas state stored as `canvas_state.json` in `<project_dir>/creative_os/` alongside Phase 1 files

## 3. Engine Stub Completion

Complete 5 Phase 1 `NotImplementedError` stubs by wiring each engine's ModelRouter to its Prompt YAML (already created).

| Engine | Method(s) | Prompt YAML | Tier |
|---|---|---|---|
| MutationEngine | `mutate()`, `fuse()` | `mutation_operation.yaml` | Tier 1 |
| ContradictionEngine | `expand()` | `contradiction_expand.yaml` | Tier 1 |
| WhatIfEngine | `expand_node()`, `precompute_leaves()`, `regenerate_node()` | `whatif_expand.yaml` | Tier 1/3 |
| GenreFusionEngine | `analyze_fusion()` | `genre_fusion.yaml` | Tier 1 |

All engines call `self._router.execute(agent_name="creative_director", task_name=..., messages=[...], json_mode=True)`.

## 4. Creative Director Agent

**File:** `backend/agents/creative_director.py` (new)
**Pattern:** extends `BaseAgent`, `agent_name = "creative_director"`

3 methods, all LLM-only, return suggestions — never execute engine operations:

| Method | Tier | Prompt (new) | Returns |
|---|---|---|---|
| `suggest_direction(current_node, canvas_state)` | Tier 1 | `creative_director_direction.yaml` | Chinese suggestion text |
| `recommend_mutation(node)` | Tier 3 | `creative_director_mutation.yaml` | Recommended MutationOp + reason |
| `evaluate_path(path_nodes)` | Tier 1 | `creative_director_path.yaml` | Qualitative path assessment text |

**3 new Prompt files:** `backend/prompts/creative/creative_director_{direction,mutation,path}.yaml`

**Boundary with Engines:** Agent gives suggestions; engines execute. API layer orchestrates: execute → score → suggest → respond.

## 5. Branch Simulator

**File:** `backend/conductor/branch_simulator.py` (new)
**Data models:** `backend/models/branch_simulation.py` (new)

Two-phase analysis:
- **Phase 1 (deterministic, zero LLM):** Reuses v1.6 `ImpactAnalyzer` for chapter range, affected characters/foreshadowings, growth curve shifts, reader metrics projection
- **Phase 2 (LLM inference, Tier 2):** 3 inference items via `prompts/branch_simulation_llm.yaml` (new):

| Inference | Confidence |
|---|---|
| tension_curve_projection | 🟡 medium |
| foreshadowing_risk_assessment | 🟡 medium |
| alternative_suggestions | 🟠 low |

**Data models:**
- `LLMInference`: content, confidence ("medium"/"low"), model, tokens_used
- `BranchSimulationReport`: deterministic fields + 3 LLMInference items + metadata

**Storage:** `<project_dir>/branches/{timestamp}_{id}.json`

## 6. API Design

### 6.1 Creative Canvas API (`backend/api/creative_canvas.py`, new)

Prefix: `/api/v1/projects/{project_id}/creative/canvas`

| Method | Endpoint | Request | Response | Engines | Agent |
|---|---|---|---|---|---|
| POST | `/expand` | `{node_id, tier?}` | `{nodes, scores, suggestion}` | WhatIfEngine + NoveltyEvaluator | suggest_direction |
| POST | `/mutate` | `{node_id, operation}` | `{node, score, recommendation}` | MutationEngine + NoveltyEvaluator | recommend_mutation |
| POST | `/merge` | `{node_id_a, node_id_b}` | `{node, score}` | MutationEngine.fuse + NoveltyEvaluator | — |
| POST | `/evaluate` | `{node_id}` | `{score}` | NoveltyEvaluator | — |
| POST | `/select` | `{path_node_ids}` | `{story_dna, path_evaluation}` | NoveltyEvaluator | evaluate_path |
| GET | `/state` | — | `{nodes, edges, selected_path}` | — (read file) | — |

### 6.2 Branch Simulation API (`backend/api/stage3_outline.py`, modify)

Prefix: `/api/v1/projects/{project_id}/branches`

| Method | Endpoint | Request | Response |
|---|---|---|---|
| POST | `/simulate` | `{description: str}` | `BranchSimulationReport` |
| GET | `/history` | — | `[{id, description, created_at}]` |

### 6.3 Canvas State Storage

`<project_dir>/creative_os/canvas_state.json`:
```json
{
  "root_node_id": "wi_001_00",
  "nodes": { ... },
  "edges": [{"from": "...", "to": "..."}],
  "selected_path": ["wi_001_00", ...],
  "created_at": "...",
  "updated_at": "..."
}
```

### 6.4 Conventions

All endpoints follow v1.6 patterns: async, unified error format `{error, code, message, detail}`, FileManager for I/O.

## 7. New Prompt Files (4 total)

```
backend/prompts/creative/
├── creative_director_direction.yaml   # suggest_direction
├── creative_director_mutation.yaml    # recommend_mutation
└── creative_director_path.yaml        # evaluate_path

backend/prompts/
└── branch_simulation_llm.yaml         # BranchSimulator LLM inference
```

## 8. New File Inventory

```
backend/
├── agents/
│   └── creative_director.py              # New: Creative Director agent
├── conductor/
│   └── branch_simulator.py               # New: Branch Simulator
├── api/
│   ├── creative_canvas.py                # New: 6 canvas endpoints
│   └── stage3_outline.py                 # Modify: +2 branch endpoints
├── models/
│   ├── branch_simulation.py              # New: LLMInference + BranchSimulationReport
│   └── __init__.py                       # Modify: add new model exports
├── prompts/
│   ├── creative/
│   │   ├── creative_director_direction.yaml   # New
│   │   ├── creative_director_mutation.yaml    # New
│   │   └── creative_director_path.yaml        # New
│   └── branch_simulation_llm.yaml             # New
└── creative_os/
    ├── mutation_engine.py                # Modify: complete mutate/fuse stubs
    ├── contradiction_engine.py           # Modify: complete expand stub
    ├── whatif_engine.py                  # Modify: complete expand/precompute/regenerate
    └── genre_fusion_engine.py            # Modify: complete analyze_fusion stub
```

## 9. Out of Scope

- Frontend (React Flow, Recharts, CreativeCanvasPage, etc.)
- Character Designer agent (T4.3)
- Semantic precheck (T3.1-T3.4)
- Exemption manager (T3.5-T3.8)
- SF Log suggestion engine (T3.9-T3.10)
- Style sandbox (T4.1-T4.2)
- Growth workshop (T4.3-T4.8)
- Inspiration router (T4.9-T4.10)
