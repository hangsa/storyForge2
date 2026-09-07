// 创意发散 v2 类型定义(snake_case 转换在 api/client.ts 完成)

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
  genre_secondary: string | null;
}

export interface Unit {
  id: string;
  dimension: Dimension;
  unit_name: string;
  description: string;
  follow_up_count: number;
  is_irreducible: boolean;
}

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
  dimension_status: "pending" | "decomposed" | "diverged" | "divergence_failed";
}

export interface CommittedConcept {
  one_line: string;
  expanded: string;
  core_tension: string;
  tone: string;
  logline: string;
  edited_by_user: boolean;
}

export interface NoveltyScores {
  market_saturation: number;
  trope_similarity: number;
  contradiction_depth: number;
  discussion_potential: number;
  composite: number;
  grade: string;
}

export interface ThreeBState {
  schema_version: 2;
  project_id: string;
  raw_intent: RawIntent | null;
  decompose_started_at: string | null;
  decompose_completed_at: string | null;
  causal_map: string;
  top_level_summary: string;
  dimensions: DimensionDecomposition[];
  diverge_started_at: string | null;
  diverge_completed_at: string | null;
  commit_started_at: string | null;
  commit_completed_at: string | null;
  committed_concept: CommittedConcept | null;
  novelty_scores: NoveltyScores | null;
}

// UI 辅助类型
export type SubStage = "1" | "2" | "3" | "4";

// 与 StepIndicator.tsx 的 4 阶段保持一致
export const SUB_STAGES: Array<{ key: SubStage; label: string }> = [
  { key: "1", label: "输入灵感" },
  { key: "2", label: "第一性拆解" },
  { key: "3", label: "自适应发散" },
  { key: "4", label: "提交" },
];