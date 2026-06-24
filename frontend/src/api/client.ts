const API_BASE = "/api";
const TIMEOUT_MS = 600_000;

class ApiError extends Error {
  code: string;
  detail: Record<string, unknown>;

  constructor(code: string, message: string, detail: Record<string, unknown> = {}) {
    super(message);
    this.code = code;
    this.detail = detail;
    this.name = "ApiError";
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
  } catch (e) {
    clearTimeout(timer);
    if (e instanceof DOMException && e.name === "AbortError") {
      throw new ApiError("TIMEOUT", "请求超时", {});
    }
    throw new ApiError("NETWORK_ERROR", "网络请求失败", {});
  } finally {
    clearTimeout(timer);
  }

  let json: Record<string, unknown>;
  try {
    json = await res.json();
  } catch {
    throw new ApiError(
      "PARSE_ERROR",
      `服务器返回无效响应 (${res.status})`,
      {}
    );
  }

  // FastAPI wraps HTTPException detail: {"detail": {"error": true, "code": "X", ...}}
  const detailObj = json.detail as Record<string, unknown> | undefined;
  const topError = json.error;
  const nestedError = detailObj && typeof detailObj === "object" ? detailObj.error : undefined;
  if (topError || nestedError) {
    const payload = nestedError ? detailObj! : json;
    throw new ApiError(
      (payload.code as string) || "UNKNOWN",
      (payload.message as string) || "未知错误",
      (payload.detail as Record<string, unknown>) || {}
    );
  }

  return (json.detail as T) ?? (json as T);
}

// --- Type definitions (mirror Pydantic models) ---

export interface ProjectSummary {
  id: string;
  title: string;
  genre: string;
  current_stage: string;
  created_at: string;
  min_words: number;
}

export interface Project {
  id: string;
  title: string;
  genre: string;
  min_words: number;
  initial_intent: { free_text: string; inspiration_source?: string };
  current_stage: string;
  stage_history: Array<{ from: string; to: string; timestamp: string }>;
  created_at: string;
}

export interface Concept {
  title: string;
  genre: string;
  premise: string;
  tone: string;
  theme: string;
  target_audience: string;
  style_template: string;
}

export interface StoryDNA {
  core_contradiction: {
    statement: string;
    side_a: string;
    side_b: string;
  };
  value_stack: Array<{ value_a: string; value_b: string }>;
}

export interface ConceptResponse {
  concept: Concept;
  story_dna: StoryDNA;
}

export interface WorldRulesSummary {
  name: string;
  ceilings: string[];
  core_rules: string[];
}

export interface World {
  era: string;
  geography: string;
  power_system: {
    name: string;
    description: string;
    stages: string[];
    core_rules: string[];
    ceilings: string[];
    cost_system?: string;
  };
  factions: Array<{ name: string; type: string; goal: string; relations: string }>;
  core_rules: string[];
}

export type GrowthEventType =
  | "betrayal_experienced"
  | "death_of_loved_one"
  | "world_truth_revealed"
  | "personal_identity_crisis"
  | "irreversible_loss"
  | "moral_awakening"
  | "accumulated_evidence"
  | "relationship_transformation";

export interface GrowthStage {
  stage_number: number;
  stage_name: string;
  trigger_event_type: GrowthEventType;
  trigger_event_description: string;
  character_change: string;
  target_chapter_range: string;
  bound_chapter: number | null;
}

export interface GrowthCurve {
  curve_description: string;
  stages: GrowthStage[];
}

export interface Character {
  id: string;
  name: string;
  is_core_character: boolean;
  character_type: "protagonist" | "antagonist" | "supporting" | "mentor";
  personality: {
    beliefs: string[];
    desires: string[];
    fears: string[];
    values: string[];
    core_traits: string[];
  };
  current_state: {
    location: string;
    physical_condition: string;
    emotional: string;
    known_secrets: string[];
  };
  voice_signature: {
    speech_style: string;
    thought_patterns: string;
    taboos: string[];
  };
  unknown_to_character: string[];
  relations: Record<string, { status: string; history: Array<Record<string, unknown>>; last_update_chapter: number }>;
  growth_curve: GrowthCurve | null;
}

export interface CharacterSet {
  characters: Character[];
  current: Character;
}

export interface ScenePlan {
  scene_number: number;
  goal: string;
  conflict: string;
  emotional_arc: string;
  narrative_role: "setup" | "mini_payoff" | "cliffhanger" | "major_reveal";
  beat_type: string;
  registry_changes: {
    created: Array<{ type: string; id_pattern: string; description: string }>;
    updated: Array<{ asset_id: string; field: string; new_value: string }>;
  };
  required_logs: string[];
}

export interface Outline {
  chapters: Array<{
    chapter_number: number;
    title: string;
    scene_plan: ScenePlan[];
  }>;
}

export interface ParsedLog {
  type: string;
  params: Record<string, string>;
  raw_text: string;
}

export interface CheckResult {
  check_id: number;
  name: string;
  passed: boolean;
  detail?: string;
}

export interface FactGuardResult {
  all_passed: boolean;
  checks: CheckResult[];
  coherence_score: number;
}

export interface RegistryUpdateReport {
  created: string[];
  updated: string[];
}

export interface WriteSceneResponse {
  status: "passed" | "retry" | "circuit_breaker_triggered";
  scene_number: number;
  draft_text?: string;
  parsed_logs?: ParsedLog[];
  fact_guard_results?: FactGuardResult;
  registry_updates?: RegistryUpdateReport;
  retry_count?: number;
  retry_hints?: string[];
  persistent_failures?: CheckResult[];
  compatibility_note?: string;
  user_options?: string[];
}

export interface ProjectStatus {
  project_id: string;
  current_stage: string;
  title: string;
  created_at: string;
}

export interface ProgressFile {
  project_id: string;
  current_stage: string;
  current_chapter: number;
  total_chapters: number;
  chapters: Array<{
    chapter_number: number;
    status: string;
    total_scenes?: number;
    scenes: Array<{
      scene_number: number;
      status: string;
      retry_count: number;
      coherence_score: number;
    }>;
  }>;
  circuit_breaker_events: Array<Record<string, unknown>>;
}

export interface AdvanceResponse {
  current_stage: string;
  preconditions: Record<string, boolean>;
}

export interface DiagnosisIssue {
  id: string;
  priority: "P0" | "P1" | "P2";
  category: string;
  chapter: number;
  description: string;
  suggestion: string;
  asset_id: string;
  status: "open" | "resolved" | "accepted";
}

export interface DiagnosisReport {
  project_id: string;
  total_chapters: number;
  issues: DiagnosisIssue[];
  summary: { p0_count: number; p1_count: number; p2_count: number };
}

// --- v1.6 Settings types ---

export interface GenreThresholds {
  genre: string;
  defaults: Record<string, number | { threshold: number; decay: number }>;
  overrides: Record<string, any>;
  fallback_genre?: string;
}

export interface ModelTierConfig {
  description: string;
  models: Array<{ id: string; provider: string; cost_per_1k_input: number; cost_per_1k_output: number; max_tokens: number }>;
  default: string | null;
  retry_on_failure: boolean;
  max_retries: number;
  fallback: string | null;
}

export interface ModelConfig {
  tiers: Record<string, ModelTierConfig>;
  agent_mapping: Record<string, Record<string, { tier: string; model?: string; fallback?: string }>>;
}

// --- v1.6 Chapter Review types ---

export interface ChapterReviewData {
  chapter_number: number;
  timestamp: string;
  coherence_score: number;
  coherence_comment: string;
  reader_os: {
    addiction: number;
    fatigue: number;
    curiosity: number;
    tension: number;
    satisfaction: number;
    frustration: number;
    discussion: number;
  };
  narrative_assets: Record<string, number>;
  narrative_guard_warnings: Array<{ drift_type: string; character: string; severity?: string; description?: string }>;
  fact_guard_summary: { passed: number; failed: number; total: number; pass_rate: number };
  writing_formula_compliance: Array<{ metric: string; expected: any; actual: any; passed: boolean }>;
  style_guard_violations: Array<Record<string, any>>;
  discussion_topics: string[];
  decision: "approved" | "revise" | null;
  decision_feedback: string | null;
}

export interface ChapterReviewList {
  chapters: number[];
}

export interface RegistryAsset {
  id: string;
  status: string;
  description?: string;
  owner?: string;
  target?: string;
  intensity?: string;
  type?: string;
  created_chapter?: number;
  [key: string]: unknown;
}

export interface RegistryResponse {
  type: string;
  count: number;
  items: RegistryAsset[];
}

// --- v1.6 Impact Analysis / Rollback types ---

export interface ImpactEntry {
  chapter_number: number;
  scene_numbers: number[];
  priority: "P0" | "P1" | "P2";
  reason: string;
  affected_assets: string[];
}

export interface ImpactReport {
  project_id: string;
  modified_files: string[];
  entries: ImpactEntry[];
  summary: { P0: number; P1: number; P2: number };
}

export interface RollbackResult {
  status: "confirmed" | "cancelled";
  baseline_updated: boolean;
}

export type BranchStatus = "active" | "dimmed";

// --- v1.7 Creative Canvas types ---

export interface CanvasNode {
  id: string;
  depth: number;
  parent_id: string | null;
  content: string;
  novelty_score: number;
  trope_tags: string[];
  saturation_warning: string | null;
  children_ids: string[];
  is_expanded: boolean;
  branch_status: BranchStatus;
  mutation_context?: {
    operation: string;
    source_trope_id: string;
    core_premise: string;
    core_conflict: string;
    novelty_hook: string;
    self_consistency_check: string;
  } | null;
}

export interface CanvasEdge {
  from: string;
  to: string;
}

export interface CanvasStateData {
  schema_version?: number;
  root_node_id: string | null;
  nodes: Record<string, CanvasNode>;
  edges: CanvasEdge[];
  selected_path: string[];
  branch_choices?: Record<string, string>;
  created_at?: string;
  updated_at?: string;
  committed_at?: string;
  committed_concept_ref?: string;
}

export interface CanvasNodeDict {
  [nodeId: string]: CanvasNode;
}

export interface NoveltyScoreDetail {
  total: number;
  market_saturation_score: number;
  trope_similarity_score: number;
  contradiction_depth_score: number;
  discussion_potential_score: number;
  grade: string;
}

export interface CanvasExpandResponse {
  nodes: CanvasNodeDict;
  scores: Record<string, NoveltyScoreDetail>;
  suggestion: string;
}

export interface CanvasInitRequest {
  premise: string;
}

export interface CanvasSelectResponse {
  selected_path: string[];
  evaluation: string;
}

// --- v1.7 Branch Simulation types ---

export interface LLMInferenceItem {
  content: string;
  confidence: "medium" | "low";
}

export interface BranchSimulationReport {
  branch_point_description: string;
  affected_chapter_range: [number, number];
  affected_characters: string[];
  affected_foreshadowings: string[];
  growth_curve_shifts: Record<string, number>;
  reader_metrics_projection: Record<string, string>;
  tension_curve_projection: LLMInferenceItem | null;
  foreshadowing_risk_assessment: LLMInferenceItem | null;
  alternative_suggestions: LLMInferenceItem | null;
  created_at: string;
  tokens_used_total: number;
}

export interface SimulationRequest {
  description: string;
}

export interface SimulationHistoryItem {
  id: string;
  description: string;
  created_at: string;
}

// --- API functions ---

export const api = {
  listProjects: () =>
    request<ProjectSummary[]>("GET", "/project/list"),

  deleteProject: (projectId: string) =>
    request<{ project_id: string }>("DELETE", `/project/${encodeURIComponent(projectId)}`),

  createProject: (data: { intent: string; genre: string; min_words: number; title?: string }) =>
    request<Project>("POST", "/project/create", data),

  getProjectStatus: (id: string) =>
    request<ProjectStatus>("GET", `/project/${id}/status`),

  advance: (projectId: string, targetStage: string) =>
    request<AdvanceResponse>("POST", "/conductor/advance", { project_id: projectId, target_stage: targetStage }),

  generateConcept: (projectId: string) =>
    request<ConceptResponse>("POST", "/stage1/generate", { project_id: projectId }),

  getConcept: (projectId: string) =>
    request<ConceptResponse>("GET", `/stage1/concept?project_id=${encodeURIComponent(projectId)}`),

  updateConcept: (projectId: string, concept: Concept, storyDna: StoryDNA) =>
    request<void>("PUT", "/stage1/concept", { project_id: projectId, concept, story_dna: storyDna }),

  generateWorld: (projectId: string) =>
    request<World>("POST", "/stage2/generate-world", { project_id: projectId }),

  getWorld: (projectId: string) =>
    request<World>("GET", `/stage2/world?project_id=${encodeURIComponent(projectId)}`),

  generateCharacter: (projectId: string, characterType?: string) =>
    request<CharacterSet>("POST", "/stage2/generate-character", { project_id: projectId, character_type: characterType || "protagonist" }),

  getCharacter: (projectId: string, characterIndex?: number) =>
    request<CharacterSet>(
      "GET",
      `/stage2/character?project_id=${encodeURIComponent(projectId)}${characterIndex !== undefined ? `&character_index=${characterIndex}` : ""}`
    ),

  updateWorld: (projectId: string, world: World) =>
    request<void>("PUT", "/stage2/world", { project_id: projectId, world }),

  updateCharacter: (projectId: string, characterData: CharacterSet) =>
    request<void>("PUT", "/stage2/character", { project_id: projectId, characters: characterData.characters }),

  generateOutline: (projectId: string, chapterNumber?: number) =>
    request<Outline>("POST", "/stage3/generate", { project_id: projectId, chapter_number: chapterNumber ?? 1 }),

  getOutline: (projectId: string) =>
    request<Outline>("GET", `/stage3/outline?project_id=${encodeURIComponent(projectId)}`),

  updateOutline: (projectId: string, outline: Outline) =>
    request<void>("PUT", "/stage3/outline", { project_id: projectId, outline }),

  getScenePlan: (projectId: string, sceneNum: number) =>
    request<ScenePlan>("GET", `/stage4/scene-plan/${sceneNum}?project_id=${projectId}`),

  writeScene: (data: { project_id: string; chapter_number: number; scene_number: number }) =>
    request<WriteSceneResponse>("POST", "/stage4/write-scene", data),

  forcePass: (data: { project_id: string; scene_number: number }) =>
    request<void>("POST", "/stage4/force-pass", data),

  skipScene: (data: { project_id: string; scene_number: number }) =>
    request<void>("POST", "/stage4/skip-scene", data),

  getStage4Progress: (projectId: string) =>
    request<ProgressFile>("GET", `/stage4/progress?project_id=${projectId}`),

  getSceneDraft: (projectId: string, chapterNumber: number, sceneNumber: number) =>
    request<{
      draft_text: string; chapter_number: number; scene_number: number;
      parsed_logs: ParsedLog[]; fact_guard_results: { all_passed: boolean; checks: CheckResult[] } | null;
      coherence_score: number;
    }>(
      "GET", `/stage4/scene-draft?project_id=${projectId}&chapter_number=${chapterNumber}&scene_number=${sceneNumber}`
    ),

  updateSceneDraft: (data: { project_id: string; chapter_number: number; scene_number: number; draft_text: string }) =>
    request<{ chapter_number: number; scene_number: number }>(
      "PUT", "/stage4/scene-draft", data
    ),

  advanceChapter: (projectId: string) =>
    request<{ status: string; from_chapter: number; to_chapter: number; reader_os_snapshot: Record<string, unknown>; l2_summary: Record<string, unknown> }>(
      "POST", "/stage4/advance-chapter", { project_id: projectId }
    ),

  getRegistry: (projectId: string, registryType: string) =>
    request<RegistryResponse>("GET", `/storyos/${registryType}?project_id=${projectId}`),

  // STAGE 5 — Diagnosis
  runDiagnosis: (projectId: string) =>
    request<DiagnosisReport>("POST", "/stage5/diagnose", { project_id: projectId }),

  getDiagnosis: (projectId: string) =>
    request<DiagnosisReport>("GET", `/stage5/diagnosis?project_id=${projectId}`),

  resolveIssue: (projectId: string, issueId: string, action: "resolve" | "skip") =>
    request<{ issue_id: string; status: string }>("POST", `/stage5/resolve/${issueId}`, { project_id: projectId, action }),

  // STAGE 6 — Export
  exportNovel: (projectId: string, options: { strip_sf_logs?: boolean; add_toc?: boolean; include_title_page?: boolean }) =>
    request<{ preview: string; total_chars: number; file_path: string }>("POST", "/stage6/export", { project_id: projectId, options }),

  // Style Extractor
  extractStyle: (projectId: string, referenceText: string) =>
    request<Record<string, unknown>>("POST", "/style/extract", { project_id: projectId, reference_text: referenceText }),

  // v1.6 Settings
  getThresholds: (projectId: string) =>
    request<GenreThresholds>("GET", `/settings/thresholds?project_id=${encodeURIComponent(projectId)}`),

  updateThresholds: (projectId: string, overrides: Record<string, any>) =>
    request<{ status: string }>("PUT", "/settings/thresholds", { project_id: projectId, overrides }),

  getModelConfig: () =>
    request<ModelConfig>("GET", "/settings/model-config"),

  reloadConfig: () =>
    request<{ status: string }>("POST", "/settings/reload-config"),

  // v1.6 Chapter Review
  listChapterReviews: (projectId: string) =>
    request<ChapterReviewList>("GET", `/stage4/chapter-reviews?project_id=${encodeURIComponent(projectId)}`),

  getChapterReview: (projectId: string, chapter: number) =>
    request<ChapterReviewData>("GET", `/stage4/chapter-review?project_id=${encodeURIComponent(projectId)}&chapter=${chapter}`),

  setChapterDecision: (projectId: string, chapterNumber: number, decision: "approved" | "revise", feedback?: string) =>
    request<{ status: string }>("POST", "/stage4/chapter-review/decide", {
      project_id: projectId, chapter_number: chapterNumber, decision, feedback: feedback || "",
    }),

  // v1.6 Impact Analysis / Rollback
  analyzeImpact: (projectId: string, modifiedFiles?: string[]) =>
    request<ImpactReport>("POST", "/conductor/analyze-impact", {
      project_id: projectId, modified_files: modifiedFiles,
    }),

  executeRollback: (projectId: string, action: "confirm" | "cancel") =>
    request<RollbackResult>("POST", "/conductor/execute-rollback", {
      project_id: projectId, action,
    }),

  // --- v1.7 Creative Canvas ---
  getCanvasState: (projectId: string) =>
    request<CanvasStateData>("GET", `/v1/projects/${encodeURIComponent(projectId)}/creative/canvas/state`),

  initCanvas: (projectId: string, premise: string) =>
    request<CanvasStateData>("POST", `/v1/projects/${encodeURIComponent(projectId)}/creative/canvas/init`, { premise }),

  expandNode: (projectId: string, nodeId: string) =>
    request<CanvasExpandResponse>("POST", `/v1/projects/${encodeURIComponent(projectId)}/creative/canvas/expand`, { node_id: nodeId }),

  evaluateNode: (projectId: string, nodeId: string) =>
    request<NoveltyScoreDetail>("POST", `/v1/projects/${encodeURIComponent(projectId)}/creative/canvas/evaluate`, { node_id: nodeId }),

  selectPath: (projectId: string, pathNodeIds: string[]) =>
    request<CanvasSelectResponse>("POST", `/v1/projects/${encodeURIComponent(projectId)}/creative/canvas/select`, { path_node_ids: pathNodeIds }),

  resetCanvas: (projectId: string) =>
    request<{
      root_node_id: string | null;
      nodes: Record<string, never>;
      edges: never[];
      selected_path: never[];
    }>("DELETE", `/v1/projects/${encodeURIComponent(projectId)}/creative/canvas/state`),

  getMutationSuggestion: (projectId: string, nodeId: string) =>
    request<{ recommendation: string }>(
      "POST",
      `/v1/projects/${encodeURIComponent(projectId)}/creative/canvas/mutate`,
      { node_id: nodeId }
    ),

  applyMutation: (projectId: string, nodeId: string, operation: string) =>
    request<{
      new_node: CanvasNode;
      mutation_result: {
        operation: string;
        source_trope_id: string;
        core_premise: string;
        core_conflict: string;
        novelty_hook: string;
        self_consistency_check: string;
        tokens_used: number;
      };
      dimmed_count: number;
    }>(
      "POST",
      `/v1/projects/${encodeURIComponent(projectId)}/creative/canvas/apply-mutation`,
      { node_id: nodeId, operation }
    ),

  chooseBranch: (projectId: string, parentNodeId: string, chosenChildId: string) =>
    request<{
      selected_path: string[];
      branch_choices: Record<string, string>;
      chosen_node: CanvasNode;
      dimmed_count: number;
    }>(
      "POST",
      `/v1/projects/${encodeURIComponent(projectId)}/creative/canvas/choose-branch`,
      { parent_node_id: parentNodeId, chosen_child_id: chosenChildId }
    ),

  commitCanvas: (projectId: string) =>
    request<ConceptResponse & { committed_at: string }>(
      "POST",
      `/v1/projects/${encodeURIComponent(projectId)}/creative/canvas/commit`,
      {}
    ),

  // --- v1.7 Branch Simulation ---
  runSimulation: (projectId: string, description: string) =>
    request<BranchSimulationReport>("POST", `/v1/projects/${encodeURIComponent(projectId)}/branches/simulate`, { description }),

  getSimulationHistory: (projectId: string) =>
    request<SimulationHistoryItem[]>("GET", `/v1/projects/${encodeURIComponent(projectId)}/branches/history`),
};

export { ApiError };
export default api;
