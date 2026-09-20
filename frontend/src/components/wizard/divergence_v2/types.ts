// 创意发散 v2 类型定义(snake_case 转换在 api/client.ts 完成)
// 2026-09-19:砍掉 S3 自适应发散 + S4 LLM 合成两阶段,4 阶段 → 2 阶段。

export type Dimension =
  | "ontology"
  | "energetics"
  | "power_structure"
  | "protagonist_engine"
  | "narrative_physics";

export type Operator = "distort" | "break" | "blend" | "chain";

export interface RawIntent {
  prompt: string;
  genre_primary: string;
  tone: string;
  style: string;
}

export interface Unit {
  id: string;
  dimension: Dimension;
  unit_name: string;
  description: string;
  follow_up_count: number;
  is_irreducible: boolean;
  // 自适应追问模式下由 LLM 写入。无算子追问后保持 undefined。
  // 旧 state 加载时这些字段不存在,前端用可选链 fallback。
  main_operator?: Operator | null;
  aux_operator?: Operator | null;
  chain_reaction?: string | null;
}

// UnitCandidate 仍保留类型(老 state 文件的 `candidates` 字段可能仍存在),
// 但 2026-09-19 后引擎不再写入。DimensionDecomposition.candidates 现在
// 永远是空数组。
export interface UnitCandidate {
  id: string;
  unit_id: string;
  unit_name: string;
  description: string;
  chain_reaction: string;
  main_operator: Operator;
  aux_operator: Operator | null;
  selection_rank: number;
}

export interface DimensionDecomposition {
  dimension: Dimension;
  insight: string;
  units: Unit[];
  candidates: UnitCandidate[];
  // dimension_status 字段保留是为了兼容老 state 文件加载:
  //   - 老 state 写过 "diverged" / "divergence_failed"(S3 阶段)
  //   - schema v3 后引擎只写 "pending" / "decomposed",前者留给空维度
  // UI 不会基于此字段分流(已没有 S3 子阶段),仅在 _rebuild 时透传。
  dimension_status: "pending" | "decomposed";
}

// schema v3(2026-09-19 砍掉 S3/S4 后):diverge_* / commit_* /
// committed_concept / novelty_scores 字段已删除;新增 committed_at 标记
// 「concept_and_dna.json 已落盘」。前端 HYDRATE 拿到 state 后用
// state.committed_at 判断 step 1 是否完成。
export interface B3State {
  schema_version: 3;
  project_id: string;
  raw_intent: RawIntent | null;
  decompose_started_at: string | null;
  decompose_completed_at: string | null;
  causal_map: string;
  top_level_summary: string;
  dimensions: DimensionDecomposition[];
  committed_at: string | null;
}

// UI 辅助类型
export type SubStage = "1" | "2";

// 与 StepIndicator.tsx 的 2 阶段保持一致(S1 灵感 → S2 拆解 → /commit 进世界)
export const SUB_STAGES: Array<{ key: SubStage; label: string }> = [
  { key: "1", label: "灵感" },
  { key: "2", label: "拆解" },
];