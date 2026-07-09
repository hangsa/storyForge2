# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

StoryForge is an AI-powered Creative Narrative Operating System for generating Chinese web novels (网文). It orchestrates multiple LLM agents through a deterministic state-machine backbone to produce long-form fiction with high creativity, narrative tension, and character consistency.

**Core principle:** Deterministic code controls the skeleton; LLMs fill the flesh. Consistency checks, state tracking, and reader metrics are all formula/rule-based — never LLM-blindsided.

**Current phase:** v1.7 active. Backend, frontend, and test scaffolding are in place. The authoritative spec is `docs/design/storyForge-design-v1.7.md` (with `storyForge-design-v1.7-TRD.md` for technical details). Version history lives under `docs/design/`.

**Stack:** Python (FastAPI) backend · React 18 + Vite + Tailwind frontend · JSON for project data · YAML for prompts/config · Qdrant + BM25 hybrid search with bge-m3 embeddings (L3 cold memory, optional).

## Architecture

Three independent capability chains:

| Goal | Chain | Systems |
|---|---|---|
| Creative divergence | Creative Chain | CreativeOS + Creative Director Agent |
| Narrative reversals & hooks | Narrative Chain | StoryOS + ReaderOS + Scene Engine + Style Engine |
| Character/plot consistency | Consistency Chain | MemoryOS + State Machines |

### System Components

- **Conductor** — Master orchestrator: 8-stage phase state machine, human-in-the-loop gating, inter-OS signal arbitration (6 priority levels), checkpoint/resume, circuit breaker (max 3 retries then force-pass with compatibility note). Owns branch simulation, impact analysis, chapter review.
- **CreativeOS** — Idea Pool, Trope Pool (with market_saturation scoring), Mutation Engine (4 ops: Inversion/Fusion/Escalation/Subversion), Contradiction Engine (5 templates), WhatIf Engine (recursive tree, depth=3 breadth=4 → max 84 nodes), Genre Fusion Engine (BFS structural fusion), Novelty Evaluator (4 dimensions).
- **StoryOS** — 7+1 narrative asset registries (Conflict, Promise, Mystery, Twist, Reveal, Goal, Expectation, Foreshadowing) with cross-registry foreign keys, transactional cascade updates (BFS), conflict detection (cycles/forbidden transitions/mutex), and atomic commit/rollback.
- **MemoryOS** — 5-tier memory: L0 Runtime (500 tokens, always in context), L1 Hot (last 5 chapters + periodic detail re-extraction every 5 chapters), L2 Warm (chapter summaries + timeline + relationship graph, ~8K tokens), L3 Cold (Qdrant + BM25 hybrid with RRF fusion), L4 Narrative (sync'd with StoryOS, ~3K tokens). Retrieval priority: L0 → L1 → L4 → L2 → L3.
- **ReaderOS** — 7 reader-state metrics (Curiosity, Tension, Satisfaction, Frustration, Fatigue, Addiction, Discussion Potential) — all formula-computed, zero LLM calls. Thresholds are genre-specific and YAML-driven (`config/genre_thresholds.yaml`).
- **Scene Engine** — Scene Schema 2.0, beat patterns, SF_LOG tag specification (11 types).
- **Style Engine** — 3 layers: L1 genre templates (YAML), L2 writing formulas (sentence/dialog quantitative rules), L3 constraint layer (character + genre taboo pattern matching, all regex). Also owns the Style Sandbox (Tier 3 preview + saved configs).
- **Growth Curve** — Auto-generation (deterministic) + outline binder + writing-context injection. **Growth Workshop** (v1.7) adds interactive stage editor, consistency checking (5 rules), agent discussion loop, and Character Designer agent.
- **Semantic Precheck** (v1.7) — Detects likely-missing SF_LOG tags before Fact Guard runs; suggestions only, never blocks.
- **Innovation Exemption** (v1.7) — Per-scene ruleset overrides with approval flow.
- **Agent Layer** — base_agent, planner, writer, reviewer (3 guard layers), storyos_agent, summary_archiver, creative_director, character_designer.

### v1.7 Status Snapshot

9 of 10 v1.7 features are implemented and tested (see `docs/design/storyForge-design-v1.7.md` §五 for AC-1~AC-10):

| AC | Feature | Status |
|---|---|---|
| AC-1, AC-2 | CreativeOS engines + Creative Canvas | ✅ |
| AC-3 | Novelty Evaluator reproducibility | ⚠️ engine present, no explicit reproducibility test |
| AC-4 | Branch Simulation with confidence tagging | ✅ |
| AC-5 | Semantic Precheck | ✅ |
| AC-6 | Style Sandbox | ✅ (`test_style_sandbox_ac6.py`) |
| AC-7 | Innovation Exemption | ✅ |
| **AC-8** | **Inspiration Router** | ❌ **not implemented** |
| AC-9 | Growth Workshop | ✅ (`test_growth_workshop_ac9.py`) |
| AC-10 | User Edit Assist | ✅ |

### Key Design: SF_LOG Tags

The Writer agent embeds structured log tags (Markdown comment syntax, invisible to readers) in generated text:

```
<!-- SF_LOG character_relation_change char_a="林峰" char_b="苏晓晓" status="裂痕" trigger="争执" -->
<!-- SF_LOG conflict_escalate id="cf_001" new_intensity="critical" trigger="发现证据" -->
<!-- SF_LOG knowledge_gain char="林峰" content="师父的秘密联络记录" source="实验室终端" -->
<!-- SF_LOG mystery_clue id="mys_003" clue="超脑认识观察者文明的符号" -->
<!-- SF_LOG twist_reveal id="tw_001" trigger="终端日志记录" -->
<!-- SF_LOG goal_milestone id="goal_002" progress="T5→T7" -->
<!-- SF_LOG registry_create type="conflict" data='{"owner":"林峰","target":"师父","type":"betrayal"}' -->
```

11 log types: `character_relation_change`, `character_emotion`, `knowledge_gain`, `conflict_escalate`, `mystery_clue`, `twist_reveal`, `expectation_fulfill`, `goal_milestone`, `registry_create`, `character_location_change`, `character_physical_change`.

The StoryOS Agent parses these deterministically with regex (zero LLM), matches them against Writer's pre-declared `registry_changes` in the Scene Schema, and applies cross-registry cascading updates via `RegistryTransactionManager`.

**Cross-registry cascade rules:** Mystery→revealed → Reveal→revealed; Reveal→revealed → Expectation→fulfilled; Twist→revealed → Expectation→ready_to_fulfill; Reveal→revealed → Conflict→escalated.

## Scene Writing Pipeline (Full Flow)

```
1. Chapter Outline (Planner)
2. Scene Planning (Writer plans 3-6 scenes, pre-declares registry_changes + required_logs)
3. Scene Writing (Writer: inject MemoryOS context L0→L1→L4→L2→L3, Character States, TensionCurve warnings, log_instructions)
4. Scene Review (Reviewer 3-layer guard):
   - Fact Guard (hard rules, 6 deterministic checks) → pass/retry(max 3)/force-pass
   - Narrative Guard (suggestions, state drift detection) → suggestions only
   - Style Guard (tags) → log only
5. Scene Refining (if Fact Guard blocked, up to 3 retries with auto-generated hints)
6. Chapter Assembly (stitch scenes, check beat density, final review)
7. StoryOS & MemoryOS Update (StoryOS Agent regex-parses logs → updates registries → cascade → MemoryOS L0/L1/L2/L3)
8. ReaderOS Update (recalculate all metrics, zero LLM)
9. Semantic Precheck (v1.7) — suggests likely-missing log tags, never blocks
```

## Fact Guard — 6 Deterministic Checks

All done in code, no LLM calls:

1. **Timeline continuity** — character locations must be reachable; same-chapter location changes need a log tag
2. **Character state consistency** — no forbidden behaviors from voice_signature; no knowledge leaks (character knows things listed in `unknown_to_character`)
3. **World rules** — power ceilings respected; if cost_required flexibility, cost must be declared via log tag
4. **Registry compliance** — pre-declared changes cannot reactivate resolved items; referenced entries must exist
5. **Required logs** — every item in `required_logs` must have a corresponding SF_LOG tag in the text
6. **Log format validation** — strict regex check for proper SF_LOG tag formatting

**Circuit breaker:** 3 retries with auto-generated hints → force-pass with compatibility note → optional human notification.

## Character State Machine — Belief Change Triggers

Belief changes are the most strictly guarded state change. Requirements:

- Must originate from `<log>` tags (never LLM inference)
- Need ≥2 independent trigger events in recent chapters (looking back 3 chapters)
- At least 1 trigger event in the current chapter
- Trigger type must be in the hardcoded whitelist (8 types): betrayal_experienced, death_of_loved_one, world_truth_revealed, personal_identity_crisis, irreversible_loss, moral_awakening, accumulated_evidence, relationship_transformation
- `accumulated_evidence` has special rules: ≥3 chapters with evidence AND ≥4 total independent pieces
- LLM extraction explicitly excludes `belief_change` type — only location/emotion/relationship/knowledge/physical changes

## Model Tier Strategy

| Tier | Use | Models |
|---|---|---|
| Tier 1 (creative core) | Scene Writing, Mutation Engine, Contradiction Engine, Creative Planning | Claude Opus 4 / DeepSeek V4 |
| Tier 2 (analysis) | Narrative Guard, Character State Machine, WhatIf Engine | Claude Sonnet 4 |
| Tier 3 (auxiliary) | L1 detail re-extraction, NoveltyEvaluator tag extraction, StyleExtractor classification, semantic precheck, style sandbox render | Claude Haiku |
| Tier 0 (deterministic) | Fact Guard, Style Guard, StoryOS Agent, ReaderOS, TensionCurve, Plot State Machine, Growth Workshop consistency | No LLM |

Routing is config-driven via `config/model_tiers.yaml` and `backend/llm/model_router.py`.

## Token Budget

Per chapter (~3 scenes): ~120K tokens (v1.7). Per volume (20 chapters): ~2.4M tokens.
v1.7 single-chapter breakdown: 3× Scene Writing (81K) + 3× Narrative Guard (27K) + 1× Character State Machine (9K) + 3× Semantic Precheck (~1.8K, Tier 3) + amortized L1 re-extraction / inspiration router / user edit assist.

## Context Caching

Per-chapter cache (survives across scenes in the same chapter): L1 Hot, L4 Narrative, L2 Warm summaries. Per-scene refresh (no caching): Character State Machine (scene writing may change character location/state within the chapter). Chapter switch clears all cache. Saves ~60% context assembly overhead.

## Checkpoint & Resume

Scene-level granularity in `.storyforge_checkpoint.json` inside each project. Snapshots: L0 Runtime, all StoryOS Registries, all Character States, ReaderOS state. Written after each scene completes (overwrite mode). Recovery replays from the recorded `pipeline_stage`.

## Novelty Evaluator — 4 Dimensions

1. **market_saturation** (30% weight) — LLM extracts trope tags → match in Trope Pool → score = (1 - min_saturation) × 100
2. **trope_similarity** (25%) — bge-m3 embedding → cosine similarity against Trope Pool vector index → score = (1 - max_similarity) × 100
3. **contradiction_depth** (25%) — regex match against 5 contradiction templates with weighted scoring; compound contradictions get 1.3× bonus
4. **discussion_potential** (20%) — keyword-based controversy + identity conflict scoring, minus predictability penalty

## Project Structure

```
storyforge/
├── backend/
│   ├── main.py                # FastAPI entry; CORS allows http://localhost:5173
│   ├── config.py              # Pydantic-settings; reads backend/.env
│   ├── agents/                # base, planner, writer, reviewer, storyos_agent, summary_archiver, creative_director, character_designer
│   ├── api/                   # FastAPI routers: project, conductor, stage1-6, storyos, style_extractor, settings_api, creative_canvas, growth_workshop, style_sandbox
│   ├── conductor/             # state_machine, circuit_breaker, checkpoint, branch_simulator, impact_analyzer, chapter_review
│   ├── creative_os/           # idea_pool, trope_pool, mutation_engine, contradiction_engine, whatif_engine, genre_fusion_engine, novelty_evaluator
│   ├── growth_curve/          # auto_generator, binder, context
│   │   └── workshop/          # consistency_checker, models  (v1.7 Growth Workshop)
│   ├── llm/                   # providers (anthropic/deepseek/minimax), model_router
│   ├── memory_os/             # l0_runtime, l1_hot, l2_warm, l3_{cold,bm25,chunker}, l4_narrative, memory_coordinator
│   ├── models/                # Pydantic models
│   ├── prompts/               # YAML prompts grouped by concern
│   ├── reader_os/             # state, calculator, thresholds
│   ├── scene_engine/          # schema, beat_patterns, log_spec
│   ├── semantic_precheck/     # v1.7 pre-Fact-Guard log suggestions
│   ├── story_os/              # registries, registry_transaction
│   ├── style_engine/          # genre_template, writing_formulas, taboo_constraints, style_extractor, sandbox_{models,renderer}
│   └── utils/
├── frontend/                  # React 18 + Vite + Tailwind; 13 pages (Init, Stage1-6, ProjectList, StoryOS, ChapterReview, CreativeCanvas, BranchSimulation, ImpactAnalysis, StyleSandbox, Settings)
│   └── src/{pages,components,hooks,api,types,utils,test}
├── config/                    # model_tiers.yaml, genre_thresholds.yaml, trope_catalog.yaml
├── data/style/                # bundled style resources
├── docs/design/               # Versioned design docs (origin → v1.7) and TRDs
├── projects/{id}/             # Per-project JSON data + chapters + memory + checkpoint
├── tests/                     # ~62 test files; backend pytest + frontend vitest
├── venv/                      # Python venv (uvicorn available at venv/bin/uvicorn)
└── llm_usage.jsonl            # Append-only LLM call log
```

## Development Environment

### Start the dev services

```bash
# Backend (port 8000). Reads backend/.env (LLM API keys); works without keys but LLM calls will fail.
source venv/bin/activate
uvicorn backend.main:app --reload --port 8000

# Frontend (port 5173). Vite proxies /api → http://localhost:8000.
cd frontend
npm run dev
```

Open http://localhost:5173. Frontend talks to backend via the Vite proxy — no CORS issues during dev.

### Run tests

```bash
# Backend
source venv/bin/activate
pytest                          # all
pytest tests/test_creative_os/  # subset
pytest -k "ac6 or ac9"          # v1.7 acceptance tests

# Frontend
cd frontend
npm test                        # vitest run
```

### LLM provider config

`backend/config.py` defaults to `deepseek` + `deepseek-chat`. Override via `backend/.env`:

```
llm_provider=deepseek
llm_model=deepseek-chat
deepseek_api_key=...
```

Other supported providers: `anthropic`, `minimax` (see `backend/llm/`). Tier-to-model mapping lives in `config/model_tiers.yaml`.
