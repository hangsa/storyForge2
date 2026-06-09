# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

StoryForge is an AI-powered Creative Narrative Operating System for generating Chinese web novels (网文). It orchestrates multiple LLM agents through a deterministic state-machine backbone to produce long-form fiction with high creativity, narrative tension, and character consistency.

**Core principle:** Deterministic code controls the skeleton; LLMs fill the flesh. Consistency checks, state tracking, and reader metrics are all formula/rule-based — never LLM-blindsided.

**Current phase:** Pre-implementation design. All architecture is documented in `docs/storyForge-implementation-v1.0.md`. No code has been written yet.

**Language:** Python. **Storage:** JSON for project data, YAML for prompts/config. **Vector DB:** Qdrant + BM25 hybrid search with BAAI/bge-m3 embeddings.

## Architecture

Three independent capability chains:

| Goal | Chain | Systems |
|---|---|---|
| Creative divergence | Creative Chain | CreativeOS + Creative Director Agent |
| Narrative reversals & hooks | Narrative Chain | StoryOS + ReaderOS + Scene Engine + Style Engine |
| Character/plot consistency | Consistency Chain | MemoryOS + State Machines |

### System Components

- **Conductor** — Master orchestrator: phase state machine, human-in-the-loop gating, inter-OS signal arbitration (6 priority levels), checkpoint/resume, circuit breaker (max 3 retries then force-pass with compatibility note)
- **CreativeOS** — Idea Pool, Trope Pool (with market_saturation scoring), Mutation Engine (4 ops: Inversion/Fusion/Escalation/Subversion), Contradiction Engine (5 templates), WhatIf Engine (recursive tree, depth=3 breadth=4 → max 84 nodes), Genre Fusion Engine (structural fusion with genre distance BFS), Novelty Evaluator (4 deterministic dimensions)
- **StoryOS** — 7 narrative asset registries (Conflict, Promise, Mystery, Twist, Reveal, Goal, Expectation) with cross-registry foreign keys and transactional cascade updates
- **MemoryOS** — 5-tier memory: L0 Runtime (500 tokens, always in context), L1 Hot (last 5 chapters + periodic detail re-extraction every 5 chapters), L2 Warm (chapter summaries + timeline + relationship graph, ~8K tokens), L3 Cold (Qdrant + BM25 hybrid search with RRF fusion), L4 Narrative (sync'd with StoryOS, ~3K tokens). Retrieval priority: L0 → L1 → L4 → L2 → L3
- **ReaderOS** — 7 reader-state metrics (Curiosity, Tension, Satisfaction, Frustration, Fatigue, Addiction, Discussion Potential) — all formula-computed, zero LLM calls
- **Scene Engine** — Scene Schema 2.0, beat patterns, SF_LOG tag specification
- **Style Engine** — 3-layer: L1 genre templates (YAML), L2 writing formulas (sentence/dialog quantitative rules), L3 constraint layer (character + genre taboo pattern matching, all regex)
- **Agent Layer** — 6 agents: Conductor, Creative Director, Planner, Writer, Reviewer (3 guard layers), StoryOS Agent

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

**Cross-registry cascade rules:** Mystery→revealed cascades to Reveal→revealed; Reveal→revealed cascades to Expectation→fulfilled; Twist→revealed cascades to Expectation→ready_to_fulfill; Reveal→revealed cascades to Conflict→escalated.

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
| Tier 3 (auxiliary) | L1 detail re-extraction, NoveltyEvaluator tag extraction, StyleExtractor classification | Claude Haiku |
| Tier 0 (deterministic) | Fact Guard, Style Guard, StoryOS Agent, ReaderOS, TensionCurve, Plot State Machine | No LLM |

## Token Budget

Per chapter (~3 scenes): ~117.5K tokens. Per volume (20 chapters): ~2.35M tokens.
Breakdown: 3× Scene Writing (81K) + 3× Narrative Guard (27K) + 1× Character State Machine (9K) + L1 re-extraction amortized (0.5K).

## Context Caching

Per-chapter cache (survives across scenes in the same chapter): L1 Hot, L4 Narrative, L2 Warm summaries. Per-scene refresh (no caching): Character State Machine (scene writing may change character location/state within the chapter). Chapter switch clears all cache. Saves ~60% context assembly overhead.

## Checkpoint & Resume

Scene-level granularity in `.storyforge_checkpoint.json`. Snapshots: L0 Runtime, all StoryOS Registries, all Character States, ReaderOS state. Written after each scene completes (overwrite mode). Recovery replays from the recorded `pipeline_stage`.

## Novelty Evaluator — 4 Dimensions

1. **market_saturation** (30% weight) — LLM extracts trope tags → match in Trope Pool → score = (1 - min_saturation) × 100
2. **trope_similarity** (25%) — bge-m3 embedding → cosine similarity against Trope Pool vector index → score = (1 - max_similarity) × 100
3. **contradiction_depth** (25%) — regex match against 5 contradiction templates with weighted scoring; compound contradictions get 1.3× bonus
4. **discussion_potential** (20%) — keyword-based controversy + identity conflict scoring, minus predictability penalty

## Project Structure (Planned)

```
storyforge/
├── conductor/          # state_machine, gate_controller, signal_arbiter, circuit_breaker, checkpoint
├── creative_os/        # idea_pool, trope_pool, mutation_engine, contradiction_engine, whatif_engine, genre_fusion_engine, novelty_evaluator, story_dna
├── story_os/           # registries/ (7 files), registry_transaction, tension_curve, storyos
├── memory_os/          # l0_runtime, l1_hot, l2_warm, l3_cold/ (chunker, embedder, bm25_index, hybrid_search), l4_narrative, context_cache
├── reader_os/          # state, calculator, warnings
├── scene_engine/       # schema, beat_pattern, log_spec
├── style_engine/       # genre_templates/ (yaml), writing_formulas, constraint_layer, style_extractor
├── consistency/        # character_state_machine, plot_state_machine
├── agents/             # base_agent, creative_director, planner, writer, reviewer, storyos_agent
├── prompts/            # creative/, planning/, writing/, review/, consistency/
├── cost/               # token_budget, model_router, llm_usage.jsonl
├── config/             # expert_config.yaml, model_tiers.yaml
└── projects/{id}/      # story_dna.json, novel_blueprint.json, storyos/*.json, memory/, consistency/, chapters/, checkpoint
```

## Development Roadmap

3 phases from `docs/storyForge-implementation-v1.0.md`:

- **Phase 1 (4 weeks):** Minimum loop — Planner → Writer (with log tags) → Reviewer (with circuit breaker) → StoryOS update (regex parsing). One chapter end-to-end. Acceptance: Fact Guard catches ≥1 consistency error, circuit breaker degrades on 3rd retry, StoryOS zero-LLM update.
- **Phase 2 (8 weeks):** Full narrative engine — all 7 registries + cross-refs + cascade, Tension Curve, ReaderOS (7 metrics, zero LLM), MemoryOS L3, Plot State Machine. Acceptance: complete 20-chapter volume, tension warning triggers, cascade works correctly.
- **Phase 3 (12 weeks):** Creative engine — all CreativeOS engines, Story DNA, Novelty Evaluator (deterministic), Style Engine full integration, model tier routing, token budget tracking. Acceptance: auto-generate Story DNA from one-line intent, Novelty ≥ 75, token cost within budget.
