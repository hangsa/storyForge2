// `PromptSummary.category` (derived from YAML file directory) is retained
// on the API response for backward compatibility, but the Plaza sidebar no
// longer groups by it. New UI code should consume `stageGroups.ts` instead —
// this file is the single source of truth for "where does this prompt live
// in the user's workflow".

import type { PromptSummary } from "../../../api/promptPlaza";

/** Stage key → 显示标签。顺序无关,只在 PROMPT_STAGE_ORDER 决定位置时才显形。 */
export const PROMPT_STAGE_LABELS: Record<string, string> = {
  divergence: "创意发散",
  concept: "概念 DNA",
  world: "世界观",
  character: "角色设计",
  plot: "剧情画布",
  outline: "全文大纲",
  chapter: "章节大纲",
  chapter_writing: "章节写作",
  review: "审校与诊断",
  style: "风格",
  other: "其他",
};

/** 固定的分组顺序 — 侧栏从上到下的渲染顺序。 */
export const PROMPT_STAGE_ORDER: string[] = [
  "divergence",
  "concept",
  "world",
  "character",
  "plot",
  "outline",
  "chapter",
  "chapter_writing",
  "review",
  "style",
  "other",
];

/** 从 Plaza UI 隐藏的内置提示词。后端 YAML 仍存在供 load_prompt_effective 兜底:
 * load_prompt_effective 按 bare stem 加载 YAML 不受影响;Hide 是纯 UI 行为,
 * groupByStage 在渲染侧过滤,stageOf / load_prompt_effective 仍按真实 stage 工作。
 */
export const HIDDEN_BUILTIN_PROMPTS: ReadonlyArray<string> = [];

/**
 * 当前没有工作流调用的提示词 — 落在「其他」兜底组。
 *
 * 每条注释解释「为什么不在主流程里」以及「什么时候该回到主流程」。
 * 添加新提示词到此处时:**必须** 写清楚它属于哪个未来阶段,以及
 * 触发条件是什么 — 否则会被 canary 测试认为是意外遗漏。
 */
export const EXPECTED_ORPHAN_PROMPTS: ReadonlyArray<{
  name: string;
  reason: string;
}> = [
  // —— 早期 4 步创意发散流程的残留 ——
  {
    name: "three_b_follow_up",
    reason: "S2 追问。Wizard (CreativeDivergenceStep) 已渲染按钮,但父组件未把 onFollowUp 传给 S2DecomposeStep;恢复时把 onFollowUp 接到 useThreeBDivergence.followUp() 即可。",
  },
  {
    name: "three_b_commit",
    reason: "S4 提交。Wizard 在推进到 stage 4 时会调 commit() (CreativeDivergenceStep.tsx:168/182/234),所以用户选择保留为「其他」而非「创意发散」— 把 commit 视作 S1–S3 的下游收束,不属发散本身。",
  },
  {
    name: "trope_extraction",
    reason: "只在旧的 /api/creative-diverge/init 路由被 fire-and-forget 触发;新 wizard 用 /api/three_b/*,前端已无人调用旧路由;Prompt Plaza 列出是因为 load_yaml_prompt 枚举 backend/prompts/。",
  },
  // —— 旧 CreativeOS 引擎使用的内联 prompt,引擎不再 load_yaml ——
  {
    name: "genre_fusion",
    reason: "GenreFusionEngine.analyze_fusion 用 task_name='fusion_analysis' 内联 prompt,从不 load_prompt_effective('genre_fusion')。",
  },
  {
    name: "contradiction_expand",
    reason: "ContradictionEngine.expand 用 task_name='mutation' 内联 prompt,从不 load YAML。",
  },
  {
    name: "whatif_expand",
    reason: "WhatIfEngine.expand_node 用 task_name='whatif_expansion'(与本 prompt 同 stem 但内联),从不 load YAML。",
  },
  {
    name: "mutation_operation",
    reason: "MutationEngine.mutate 内联 prompt,从不 load YAML。",
  },
  {
    name: "novelty_evaluation_llm",
    reason: "novelty_evaluator.py:148 有 TODO 标记,本来想用 Tier 3 LLM 跑新颖度评分,实际全部 heuristic;PromptyEvaluator.fill_trope_tags_async 用的是 trope_extraction(已在本表上方)。",
  },
  // —— CreativeDirector 三个同名方法,均内联 prompt ——
  {
    name: "creative_director_direction",
    reason: "CreativeDirector.suggest_direction 在 creative_diverge.py:931 内联构造 system_prompt/user_prompt,从未 load YAML。",
  },
  {
    name: "creative_director_mutation",
    reason: "CreativeDirector.recommend_mutation 在 creative_diverge.py:1044 内联构造,从未 load YAML。",
  },
  {
    name: "creative_director_path",
    reason: "CreativeDirector.evaluate_path 在 creative_diverge.py:1549 内联构造,从未 load YAML。",
  },
];

/** 提示词名 → 阶段 key。每个内置提示词必须命中,`other` 仅作未映射兜底。 */
export const PROMPT_NAME_TO_STAGE: Record<string, string> = {
  // 创意发散
  firstness_decompose: "divergence",
  meta_decompose: "divergence",
  adaptive_diverge: "divergence",
  // 概念 DNA
  canvas_to_concept: "concept",
  concept_generation: "concept",
  // 世界观
  world_generation: "world",
  world_power_system_rewrite: "world",
  // 角色设计
  character_generation: "character",
  growth_discuss: "character",
  // 剧情画布
  canvas_v2_next_step: "plot",
  // 全文大纲
  novel_outline_generation: "outline",
  // 章节大纲
  outline_generation: "chapter",
  // 章节写作
  scene_writing: "chapter_writing",
  scene_rewrite: "chapter_writing",
  chapter_summary: "chapter_writing",
  // 审校与诊断
  narrative_guard: "review",
  semantic_precheck: "review",
  sf_log_suggestion: "review",
  branch_simulation_llm: "review",
  // 风格
  sandbox_preview: "style",
};

/** 给定 prompt name,返回阶段 key(未命中则 `'other'`)。 */
export function stageOf(name: string): string {
  return PROMPT_NAME_TO_STAGE[name] ?? "other";
}

/** 是否在 EXPECTED_ORPHAN_PROMPTS 中被明确标记为「故意不归类」。 */
export function isExpectedOrphan(name: string): boolean {
  return EXPECTED_ORPHAN_PROMPTS.some((o) => o.name === name);
}

/**
 * 按 `PROMPT_STAGE_ORDER` 顺序把 prompts 分组;空组会被过滤掉。
 * `grouped()` 的 `[stageKey, items[]]` 顺序就是侧栏从上到下的顺序。
 */
export function groupByStage(
  prompts: PromptSummary[],
): Array<[string, PromptSummary[]]> {
  const buckets = new Map<string, PromptSummary[]>();
  for (const key of PROMPT_STAGE_ORDER) buckets.set(key, []);
  for (const p of prompts) {
    if (HIDDEN_BUILTIN_PROMPTS.includes(p.name)) continue;
    buckets.get(stageOf(p.name))!.push(p);
  }
  return Array.from(buckets.entries()).filter(([, items]) => items.length > 0);
}
