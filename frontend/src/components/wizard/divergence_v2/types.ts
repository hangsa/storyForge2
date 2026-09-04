export type Operator = "breaking" | "bending" | "blending";

export const OPERATORS: Operator[] = ["breaking", "bending", "blending"];

export const OPERATOR_LABELS: Record<Operator, string> = {
  breaking: "打破",
  bending: "扭曲",
  blending: "融合",
};

export const OPERATOR_ICONS: Record<Operator, string> = {
  breaking: "🔨",
  bending: "〰️",
  blending: "🌀",
};

export interface RawIntent {
  prompt: string;
  genre_primary: string;
  genre_secondary: string | null;
}

export interface Candidate {
  id: string;
  operator: Operator;
  sub_dimension: string;
  sub_dimension_index: number;
  premise_one_line: string;
  rationale: string;
  novelty_hook: string;
  recognition_score: number;
  strangeness_score: number;
  regenerated_count: number;
}

export interface DeepenedCandidate {
  id: string;
  source_candidate_id: string;
  source_operator: Operator;
  applied_operator: Operator;
  applied_sub_dimension: string;
  applied_sub_dimension_index: number;
  premise_one_line: string;
  rationale: string;
  novelty_hook: string;
  recognition_score: number;
  strangeness_score: number;
  deepen_count: number;
}

export interface ConceptAndDna {
  one_line: string;
  expanded: string;
  core_tension: string;
  tone: string;
  logline: string;
}

export interface NoveltyScores {
  market_saturation: number;
  trope_similarity: number;
  contradiction_depth: number;
  discussion_potential: number;
  composite: number;
  grade: string;
}

// NOTE: backend `ThreeBEngine.diverge()` (see backend/creative_os/three_b_engine.py
// line ~207) returns `{candidates, by_operator}` only — there is no `elapsed_ms`
// field. The plan's earlier draft included one; we deliberately drop it so the
// type matches the wire contract.
export interface DivergeResponse {
  candidates: Candidate[];
  by_operator: Record<Operator, Candidate[]>;
}

export interface DeepenResponse {
  deepened: DeepenedCandidate;
}

export interface CommitResponse {
  concept_and_dna: ConceptAndDna;
  novelty_scores: NoveltyScores;
  message: string;
}

export type SubStage = "1" | "2" | "3";

export const SUB_STAGES: Array<{ key: SubStage; label: string }> = [
  { key: "1", label: "输入灵感" },
  { key: "2", label: "3B 发散" },
  { key: "3", label: "深化提交" },
];